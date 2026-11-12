import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { OpenCodeClient, OpenCodeHttpError } = require(resolve(root, 'out/opencode-client.js'));
const {
  canEditQueueItem,
  parseQueueItem,
  queueReadIsCurrent,
  queueSummary,
  upsertQueueItem,
  withDelivery,
  withoutItem,
} = require(resolve(root, 'out/shared/inbox.js'));

let failures = 0;

async function check(name, run) {
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

const inboxBody = {
  data: [
    {
      id: 'inb_1',
      sessionID: 'ses_1',
      time: { created: 111 },
      type: 'user',
      delivery: 'queue',
      payload: { text: 'first queued prompt', files: [{ uri: 'file:///a.ts' }] },
    },
    {
      id: 'inb_2',
      sessionID: 'ses_1',
      time: { created: 222 },
      type: 'compaction',
      delivery: 'steer',
      payload: {},
    },
    {
      id: 'inb_3',
      sessionID: 'ses_1',
      time: { created: 333 },
      type: 'move',
      delivery: 'queue',
      payload: { description: 'Move to /tmp', metadata: { secret: true } },
    },
    { id: '', type: 'user', delivery: 'queue', payload: { text: 'broken' } },
    { id: 'inb_5', sessionID: 'ses_1', type: 'unknown-kind', delivery: 'queue' },
  ],
};

/** Requests the fake server received, newest last. */
const requests = [];
let patchStatus = 204;
let deleteStatus = 204;
let emptyInbox = false;

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

    if (request.method === 'GET' && path === '/api/session/ses_1/inbox') {
      send(200, { data: emptyInbox ? [] : inboxBody.data });
      return;
    }
    if (request.method === 'PATCH' && path === '/api/session/ses_1/inbox/inb_1') {
      if (patchStatus !== 204) {
        send(patchStatus, { name: 'SessionInboxConflictError', data: { message: 'delivered' } });
        return;
      }
      send(204);
      return;
    }
    if (request.method === 'DELETE' && path === '/api/session/ses_1/inbox/inb_1') {
      if (deleteStatus !== 204) {
        send(deleteStatus, { name: 'NotFoundError', data: { message: 'delivered' } });
        return;
      }
      send(204);
      return;
    }
    if (request.method === 'POST' && path === '/api/session/ses_1/prompt') {
      send(200, { data: { id: 'inb_9' } });
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
  await check('inbox reads the session list and drops payload', async () => {
    requests.length = 0;
    const list = await client.inbox('ses_1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/api/session/ses_1/inbox');
    assert.equal(requests[0].authorization, 'Basic test-credential');
    // Entries without an id and unknown kinds are skipped, not rendered.
    assert.equal(list.length, 3);
    assert.deepEqual(list[0], {
      id: 'inb_1',
      sessionID: 'ses_1',
      created: 111,
      type: 'user',
      delivery: 'queue',
      text: 'first queued prompt',
      description: undefined,
    });
    assert.equal('payload' in list[0], false);
    assert.equal(list[1].type, 'compaction');
    assert.equal(list[1].delivery, 'steer');
    assert.equal(list[2].description, 'Move to /tmp');
  });

  await check('an empty inbox is an empty list, not an error', async () => {
    emptyInbox = true;
    assert.deepEqual(await client.inbox('ses_1'), []);
    emptyInbox = false;
  });

  await check('a session id is escaped in the inbox path', async () => {
    requests.length = 0;
    await client.inbox('ses/a b').catch(() => undefined);
    assert.equal(requests[0].path, '/api/session/ses%2Fa%20b/inbox');
  });

  await check('steer patches exactly the delivery field', async () => {
    requests.length = 0;
    const result = await client.inboxDelivery('ses_1', 'inb_1', 'steer');
    assert.equal(result, undefined);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'PATCH');
    assert.equal(requests[0].path, '/api/session/ses_1/inbox/inb_1');
    assert.deepEqual(JSON.parse(requests[0].body), { delivery: 'steer' });
  });

  await check('cancel deletes the inbox item and accepts 204', async () => {
    requests.length = 0;
    await client.inboxCancel('ses_1', 'inb_1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].path, '/api/session/ses_1/inbox/inb_1');
  });

  await check('a delivered item keeps its 409 for the "Already delivered" path', async () => {
    patchStatus = 409;
    await assert.rejects(
      () => client.inboxDelivery('ses_1', 'inb_1', 'steer'),
      (error) => {
        assert.ok(error instanceof OpenCodeHttpError);
        assert.equal(error.status, 409);
        return true;
      },
    );
    patchStatus = 204;
  });

  await check('a missing item keeps its 404 for the cancel fallback', async () => {
    deleteStatus = 404;
    await assert.rejects(
      () => client.inboxCancel('ses_1', 'inb_1'),
      (error) => {
        assert.ok(error instanceof OpenCodeHttpError);
        assert.equal(error.status, 404);
        return true;
      },
    );
    deleteStatus = 204;
  });

  await check('a queued prompt sends delivery and keeps the attachments', async () => {
    requests.length = 0;
    await client.prompt(
      'ses_1',
      'queued text',
      { files: [{ uri: 'file:///a.ts', name: 'a.ts' }] },
      { delivery: 'queue' },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/api/session/ses_1/prompt');
    assert.deepEqual(JSON.parse(requests[0].body), {
      text: 'queued text',
      files: [{ uri: 'file:///a.ts', name: 'a.ts' }],
      delivery: 'queue',
    });
  });

  await check('an idle prompt keeps its old body without a delivery field', async () => {
    requests.length = 0;
    await client.prompt('ses_1', 'idle text');
    assert.deepEqual(JSON.parse(requests[0].body), { text: 'idle text' });
  });

  await check('a steer prompt is explicit when the caller asks for it', async () => {
    requests.length = 0;
    await client.prompt('ses_1', 'steer text', undefined, { delivery: 'steer' });
    assert.deepEqual(JSON.parse(requests[0].body), { text: 'steer text', delivery: 'steer' });
  });

  await check('parseQueueItem fills the enqueued frame fallbacks', async () => {
    const item = parseQueueItem(
      { type: 'user', delivery: 'steer', payload: { text: 'from the stream', metadata: {} } },
      { id: 'inb_7', sessionID: 'ses_1', created: 444 },
    );
    assert.deepEqual(item, {
      id: 'inb_7',
      sessionID: 'ses_1',
      created: 444,
      type: 'user',
      delivery: 'steer',
      text: 'from the stream',
      description: undefined,
    });
    assert.equal(parseQueueItem(null), undefined);
    assert.equal(parseQueueItem({ id: 'x', sessionID: 's', type: 'other' }), undefined);
  });

  await check('the list helpers keep order and drop only the cancelled id', async () => {
    const list = [
      { id: 'a', sessionID: 's', created: 1, type: 'user', delivery: 'queue' },
      { id: 'b', sessionID: 's', created: 2, type: 'user', delivery: 'queue' },
    ];
    const steered = withDelivery(list, 'b', 'steer');
    assert.equal(steered[0].delivery, 'queue');
    assert.equal(steered[1].delivery, 'steer');
    assert.equal(list[1].delivery, 'queue');
    assert.deepEqual(
      withoutItem(list, 'a').map((entry) => entry.id),
      ['b'],
    );
    const upserted = upsertQueueItem(list, {
      id: 'b',
      sessionID: 's',
      created: 3,
      type: 'user',
      delivery: 'steer',
    });
    assert.equal(upserted.length, 2);
    assert.equal(upserted[1].delivery, 'steer');
  });

  await check('the strip caps at 50 rows and reports the hidden count', async () => {
    const list = Array.from({ length: 53 }, (_entry, index) => ({
      id: `i${index}`,
      sessionID: 's',
      created: index,
      type: 'user',
      delivery: 'queue',
    }));
    const summary = queueSummary(list);
    assert.equal(summary.count, 53);
    assert.equal(summary.visible.length, 50);
    assert.equal(summary.hidden, 3);
    assert.equal(queueSummary([]).hidden, 0);
  });

  // R6: an attachment-only prompt has no text to put back into the composer;
  // Edit must not turn into a silent delete.
  await check('edit is offered only for a user prompt with text', async () => {
    const base = { id: 'i', sessionID: 's', created: 1, type: 'user', delivery: 'queue' };
    assert.equal(canEditQueueItem({ ...base, text: 'hello' }), true);
    assert.equal(canEditQueueItem({ ...base, text: '  ' }), false);
    assert.equal(canEditQueueItem({ ...base, text: undefined }), false);
    assert.equal(
      canEditQueueItem({ ...base, type: 'compaction', text: 'not a prompt' }),
      false,
    );
  });

  // R1: a `GET /inbox` that started before an `enqueued`/`delivered`/`steer`
  // frame carries a stale list; the frame bumps the session epoch and the read
  // must be dropped instead of overwriting the newer mirror.
  await check('a list read is dropped after an inbox frame bumped the epoch', async () => {
    let epoch = 1;
    const readStarted = epoch;
    epoch += 1; // an inbox frame applied its change
    assert.equal(queueReadIsCurrent(readStarted, epoch), false);
    const settled = epoch;
    assert.equal(queueReadIsCurrent(settled, epoch), true);
  });
} finally {
  server.close();
}

if (failures > 0) {
  console.error(`inbox-api-check: ${failures} failure(s)`);
  process.exit(1);
}
console.log('inbox-api-check: ok');
