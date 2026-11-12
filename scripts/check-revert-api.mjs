import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { OpenCodeClient, OpenCodeHttpError } = require(resolve(root, 'out/opencode-client.js'));

let failures = 0;

async function check(name, run) {
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const stageBody = {
  data: {
    messageID: 'msg_1',
    files: [
      { file: 'src/a.ts', patch: '+a', additions: 1, deletions: 0, status: 'added' },
      { file: 'src/b.ts', patch: '-b', additions: 0, deletions: 1, status: 'modified' },
    ],
  },
};

const sessionBody = {
  data: {
    id: 'ses_1',
    time: { created: 1, updated: 2 },
    revert: {
      messageID: 'msg_2',
      files: [{ file: 'src/c.ts', patch: '+c', additions: 2, deletions: 0, status: 'added' }],
    },
  },
};

/** Requests the fake server received, newest last. */
const requests = [];
let stageStatus = 200;
let commitStatus = 204;
/** The session read reports a staged revert until a test clears it. */
let sessionHasRevert = true;

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    requests.push({ method: request.method, path, body, authorization: request.headers.authorization });

    const send = (status, payload) => {
      const text = payload === undefined ? '' : JSON.stringify(payload);
      response.writeHead(status, text.length > 0 ? { 'content-type': 'application/json' } : {});
      response.end(text);
    };

    if (request.method === 'POST' && path === '/api/session/ses_1/revert/stage') {
      if (stageStatus !== 200) {
        send(stageStatus, { name: 'SessionBusyError', data: { message: 'Session is busy' } });
        return;
      }
      send(200, stageBody);
      return;
    }
    if (request.method === 'POST' && path === '/api/session/ses_1/revert/commit') {
      if (commitStatus !== 204) {
        send(commitStatus, { name: 'UnknownError', data: { message: 'snapshot failed' } });
        return;
      }
      send(204);
      return;
    }
    if (request.method === 'DELETE' && path === '/api/session/ses_1/revert') {
      send(204);
      return;
    }
    if (request.method === 'GET' && path === '/api/session/ses_1') {
      send(200, {
        data: {
          ...sessionBody.data,
          ...(sessionHasRevert ? { revert: sessionBody.data.revert } : { revert: undefined }),
        },
      });
      return;
    }
    send(404, { name: 'NotFoundError', data: { message: `unexpected ${request.method} ${path}` } });
  });
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const client = new OpenCodeClient({
  url: `http://127.0.0.1:${address.port}`,
  credential: 'test-credential',
});

try {
  // The stage is destructive on the server: it must always ask for the files.
  await check('stage posts the boundary and files:true', async () => {
    requests.length = 0;
    const revert = await client.revertStage('ses_1', 'msg_1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/api/session/ses_1/revert/stage');
    assert.equal(requests[0].authorization, 'Basic test-credential');
    assert.deepEqual(JSON.parse(requests[0].body), { messageID: 'msg_1', files: true });
    assert.equal(revert.messageID, 'msg_1');
    assert.equal(revert.files.length, 2);
    assert.equal('patch' in revert.files[0], false);
    assert.deepEqual(revert.files[1], {
      file: 'src/b.ts',
      additions: 0,
      deletions: 1,
      status: 'modified',
      more: undefined,
    });
  });

  await check('a session id is escaped in the path', async () => {
    requests.length = 0;
    await client.revertStage('ses/a b', 'msg_1').catch(() => undefined);
    assert.equal(requests[0].path, '/api/session/ses%2Fa%20b/revert/stage');
  });

  await check('commit posts once and accepts 204', async () => {
    requests.length = 0;
    const result = await client.revertCommit('ses_1');
    assert.equal(result, undefined);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/api/session/ses_1/revert/commit');
  });

  await check('clear deletes the staged revert and accepts 204', async () => {
    requests.length = 0;
    await client.revertClear('ses_1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].path, '/api/session/ses_1/revert');
  });

  await check('session info restores the staged revert without patches', async () => {
    const session = await client.getSession('ses_1');
    assert.equal(session.revert.messageID, 'msg_2');
    assert.equal(session.revert.files.length, 1);
    assert.equal('patch' in session.revert.files[0], false);
  });

  await check('a busy stage reports 409 instead of a plain error', async () => {
    stageStatus = 409;
    await assert.rejects(
      () => client.revertStage('ses_1', 'msg_1'),
      (error) => {
        assert.ok(error instanceof OpenCodeHttpError);
        assert.equal(error.status, 409);
        assert.match(error.message, /Session is busy/);
        return true;
      },
    );
    stageStatus = 200;
  });

  await check('a failed commit keeps its 500 for the partial-change warning', async () => {
    commitStatus = 500;
    await assert.rejects(
      () => client.revertCommit('ses_1'),
      (error) => {
        assert.ok(error instanceof OpenCodeHttpError);
        assert.equal(error.status, 500);
        return true;
      },
    );
    commitStatus = 204;
  });

  // Regression for the History path: `openSession` used to trust a list entry
  // that predates the stage, and its missing `revert` cleared the staged card,
  // which unblocked Send and let the next prompt commit the revert silently.
  await check('opening a session with a stale list keeps the staged card', async () => {
    const { readRevert, revertSummary, decideRevert } = require(
      resolve(root, 'out/shared/turn-diff.js'),
    );
    const { resolveOpenSession } = require(resolve(root, 'out/session-open.js'));
    // The card the stage put into the host state.
    const staged = revertSummary(readRevert(stageBody.data), 'ses_1');
    assert.equal(staged.from, 'msg_1');
    const cards = new Map([['ses_1', staged]]);
    const apply = (session, payloadEpoch, currentEpoch) => {
      const decision = decideRevert(session.revert, session.id, payloadEpoch, currentEpoch);
      if (decision.action === 'set') {
        cards.set(session.id, decision.summary);
      } else if (decision.action === 'clear') {
        cards.delete(session.id);
      }
    };
    const cached = { id: 'ses_1', title: 'stale list entry' };

    // The cached list entry was requested before the stage: applying it must
    // not clear the card.
    apply(cached, 1, 2);
    assert.equal(cards.has('ses_1'), true);

    // `openSession` re-reads the session; the server still has the revert, and
    // the fresh payload is applied in the current epoch.
    const fresh = await client.getSession('ses_1');
    assert.equal(fresh.revert.messageID, 'msg_2');
    const resolved = await resolveOpenSession(cached, async () => fresh, 2);
    assert.equal(resolved.session, fresh);
    assert.equal(resolved.revertEpoch, 2);
    apply(resolved.session, resolved.revertEpoch, 2);
    assert.equal(cards.get('ses_1').from, 'msg_2');

    // A failed read falls back to the cached entry, which must not be applied:
    // the staged card stays as it is.
    const fallback = await resolveOpenSession(cached, async () => undefined, 2);
    assert.equal(fallback.session, cached);
    assert.equal(fallback.revertEpoch, null);

    // Without a staged revert the same fresh read is what clears the card.
    sessionHasRevert = false;
    const cleared = await client.getSession('ses_1');
    assert.equal(cleared.revert, undefined);
    apply(cleared, 2, 2);
    assert.equal(cards.has('ses_1'), false);
    sessionHasRevert = true;
  });
} finally {
  await new Promise((done) => server.close(done));
}

if (failures > 0) {
  console.error(`${failures} revert api check(s) failed`);
  process.exit(1);
}
console.log('revert api: all checks passed');
