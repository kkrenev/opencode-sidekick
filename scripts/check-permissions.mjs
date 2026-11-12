import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { OpenCodeClient, OpenCodeHttpError } = require(resolve(root, 'out/opencode-client.js'));
const {
  RESOLVED_PERMISSION_LIMIT,
  canAlwaysAllow,
  filterResolved,
  isAutoApprovable,
  isSafePermissionAction,
  mergePermissionList,
  permissionRisk,
  permissionRiskLabel,
  permissionSummary,
  readPermissionRequest,
  readSavedPermission,
  rememberResolved,
  removePermission,
  upsertPermission,
} = require(resolve(root, 'out/shared/permission.js'));
const { SETTING_DEFAULTS, strictBoolean } = require(resolve(root, 'out/shared/settings.js'));
const packageJson = require(resolve(root, 'package.json'));

let failures = 0;

async function check(name, run) {
  try {
    await run();
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Requests the fake server received, newest last. */
const requests = [];
let replyStatus = 204;
let savedStatus = 200;

const pendingRequest = {
  id: 'per_1',
  sessionID: 'ses_1',
  action: 'read',
  resources: ['src/a.ts'],
  save: ['src/a.ts'],
  source: { type: 'tool', messageID: 'msg_1', id: 'prt_1' },
  metadata: { patch: 'secret diff', files: [] },
  message: 'Read this file',
};

const savedRule = {
  id: 'psv_1',
  projectID: 'prj_1',
  action: 'read',
  resource: 'src/a.ts',
  time: { created: 10, updated: 20 },
};

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({ method: request.method, path: url.pathname, query: url.search, body });

    const send = (status, payload) => {
      const text = payload === undefined ? '' : JSON.stringify(payload);
      response.writeHead(status, text.length > 0 ? { 'content-type': 'application/json' } : {});
      response.end(text);
    };

    if (request.method === 'GET' && url.pathname === '/api/session/ses_1/permission') {
      send(200, { data: [pendingRequest, { id: '', action: 'read' }, null, 'garbage'] });
      return;
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/api/session/ses%2Fa%20b/permission'
    ) {
      send(200, { data: [] });
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/session/')) {
      if (replyStatus !== 204) {
        send(replyStatus, { name: 'PermissionNotFoundError', data: { message: 'gone' } });
        return;
      }
      send(204);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/permission/saved') {
      if (savedStatus !== 200) {
        send(savedStatus, { name: 'UnknownError', data: { message: 'list failed' } });
        return;
      }
      send(200, { data: [savedRule, { id: 'psv_bad' }] });
      return;
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/api/permission/saved/')) {
      send(204);
      return;
    }
    send(404, { name: 'NotFoundError', data: { message: `unexpected ${request.method} ${url.pathname}` } });
  });
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const client = new OpenCodeClient({
  url: `http://127.0.0.1:${address.port}`,
  credential: 'test-credential',
});

try {
  await check('pending requests are read without metadata', async () => {
    requests.length = 0;
    const list = await client.listSessionPermissions('ses_1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].path, '/api/session/ses_1/permission');
    // Malformed entries are dropped instead of crashing the panel.
    assert.equal(list.length, 1);
    const [request] = list;
    assert.equal(request.id, 'per_1');
    assert.equal(request.action, 'read');
    assert.deepEqual(request.resources, ['src/a.ts']);
    assert.deepEqual(request.save, ['src/a.ts']);
    assert.equal(request.message, 'Read this file');
    assert.deepEqual(request.source, { type: 'tool', messageID: 'msg_1', id: 'prt_1' });
    // `metadata` can carry file patches; it must never reach the snapshot.
    assert.equal('metadata' in request, false);
  });

  await check('a session id is escaped in the permission path', async () => {
    requests.length = 0;
    const list = await client.listSessionPermissions('ses/a b');
    assert.equal(requests[0].path, '/api/session/ses%2Fa%20b/permission');
    assert.deepEqual(list, []);
  });

  await check('a reply posts the decision and accepts 204', async () => {
    requests.length = 0;
    const result = await client.replyPermission('ses_1', 'per_1', 'once');
    assert.equal(result, undefined);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].path, '/api/session/ses_1/permission/per_1/reply');
    assert.deepEqual(JSON.parse(requests[0].body), { decision: 'once' });
  });

  await check('a rejection carries the optional reason', async () => {
    requests.length = 0;
    await client.replyPermission('ses_1', 'per_1', 'reject', 'not this file');
    assert.equal(requests[0].path, '/api/session/ses_1/permission/per_1/reply');
    assert.deepEqual(JSON.parse(requests[0].body), {
      decision: 'reject',
      message: 'not this file',
    });
  });

  await check('a request id is escaped in the reply path', async () => {
    requests.length = 0;
    await client.replyPermission('ses_1', 'per/1', 'always');
    assert.equal(requests[0].path, '/api/session/ses_1/permission/per%2F1/reply');
    assert.deepEqual(JSON.parse(requests[0].body), { decision: 'always' });
  });

  await check('an expired reply reports 404 instead of a plain error', async () => {
    replyStatus = 404;
    await assert.rejects(
      () => client.replyPermission('ses_1', 'per_1', 'once'),
      (error) => {
        assert.ok(error instanceof OpenCodeHttpError);
        assert.equal(error.status, 404);
        return true;
      },
    );
    replyStatus = 204;
  });

  await check('saved rules require a project id', async () => {
    // Without a project the endpoint returns every project's rules; the panel
    // must not call it at all, so the client refuses before the request.
    requests.length = 0;
    await assert.rejects(() => client.listSavedPermissions(''), /project id is required/);
    await assert.rejects(() => client.listSavedPermissions('   '), /project id is required/);
    assert.equal(requests.length, 0);
  });

  await check('the project id goes into the saved query', async () => {
    requests.length = 0;
    const rules = await client.listSavedPermissions('prj/1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, '/api/permission/saved');
    assert.equal(requests[0].query, '?projectID=prj%2F1');
    // Malformed entries are dropped, the rule keeps its creation time.
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0], {
      id: 'psv_1',
      projectID: 'prj_1',
      action: 'read',
      resource: 'src/a.ts',
      created: 10,
    });
  });

  await check('a failed saved list keeps its status', async () => {
    savedStatus = 500;
    await assert.rejects(
      () => client.listSavedPermissions('prj_1'),
      (error) => {
        assert.ok(error instanceof OpenCodeHttpError);
        assert.equal(error.status, 500);
        return true;
      },
    );
    savedStatus = 200;
  });

  await check('deleting a rule accepts 204 and escapes the id', async () => {
    requests.length = 0;
    await client.deleteSavedPermission('psv/1');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'DELETE');
    assert.equal(requests[0].path, '/api/permission/saved/psv%2F1');
  });

  await check('the risk table follows the tool family', async () => {
    assert.equal(permissionRisk('read'), 'read');
    assert.equal(permissionRisk('grep'), 'read');
    assert.equal(permissionRisk('edit'), 'write');
    assert.equal(permissionRisk('apply_patch'), 'write');
    assert.equal(permissionRisk('bash'), 'shell');
    assert.equal(permissionRisk('webfetch'), 'network');
    assert.equal(permissionRisk('websearch'), 'network');
    assert.equal(permissionRisk('external_directory'), 'external');
    assert.equal(permissionRisk('some_new_tool'), 'other');
    assert.equal(permissionRisk(undefined), 'other');
    assert.equal(permissionRiskLabel('read'), 'Read-only');
    assert.equal(permissionRiskLabel('shell'), 'Runs a command');
    assert.equal(permissionRiskLabel('external'), 'Outside the workspace');
  });

  await check('auto-approve matches the allowlist exactly', async () => {
    for (const action of ['read', 'glob', 'grep', 'list', 'find']) {
      assert.equal(isSafePermissionAction(action), true, action);
    }
    for (const action of ['Read', 'read_file', 'shell', 'edit', 'write', 'webfetch', '', undefined]) {
      assert.equal(isSafePermissionAction(action), false, String(action));
    }
    const base = { id: 'per_1', sessionID: 'ses_1', resources: [] };
    assert.equal(isAutoApprovable({ ...base, action: 'read', source: { type: 'tool' } }), true);
    // Only a tool source is auto-approved, and a safe action is still required.
    assert.equal(isAutoApprovable({ ...base, action: 'read' }), false);
    assert.equal(isAutoApprovable({ ...base, action: 'read', source: { type: 'user' } }), false);
    assert.equal(isAutoApprovable({ ...base, action: 'read', source: { type: 'plugin' } }), false);
    assert.equal(isAutoApprovable({ ...base, action: 'shell', source: { type: 'tool' } }), false);
    // Every dangerous family asks, even when the server attributes it to a tool.
    for (const action of [
      'shell',
      'edit',
      'write',
      'webfetch',
      'websearch',
      'external_directory',
      'skill',
      'subagent',
    ]) {
      assert.equal(
        isAutoApprovable({ ...base, action, source: { type: 'tool' } }),
        false,
        action,
      );
    }
  });

  await check('the auto-approve setting defaults to off in code and in the manifest', async () => {
    assert.equal(SETTING_DEFAULTS.permissionsAutoApproveSafe, false);
    const property =
      packageJson.contributes.configuration.properties[
        'opencodeSidekick.permissionsAutoApproveSafe'
      ];
    assert.ok(property, 'the setting is declared');
    assert.equal(property.type, 'boolean');
    assert.equal(property.default, false);
  });

  await check('only a real boolean turns auto-approve on', async () => {
    assert.equal(strictBoolean(true), true);
    assert.equal(strictBoolean(false), false);
    for (const value of ['true', 'yes', 1, 0, null, undefined, {}, []]) {
      assert.equal(strictBoolean(value), false, String(value));
    }
    assert.equal(strictBoolean(undefined, false), false);
    assert.equal(strictBoolean('x', true), true);
  });

  await check('always needs patterns to save', async () => {
    const base = { id: 'per_1', sessionID: 'ses_1', action: 'read', resources: [] };
    assert.equal(canAlwaysAllow({ ...base }), false);
    assert.equal(canAlwaysAllow({ ...base, save: [] }), false);
    assert.equal(canAlwaysAllow({ ...base, save: ['src/a.ts'] }), true);
  });

  await check('upsert replaces by id and keeps the arrival order', async () => {
    const first = { id: 'a', sessionID: 'ses_1', action: 'read', resources: [] };
    const second = { id: 'b', sessionID: 'ses_1', action: 'grep', resources: [] };
    const list = upsertPermission(upsertPermission([], first), second);
    assert.deepEqual(list.map((entry) => entry.id), ['a', 'b']);
    const replaced = upsertPermission(list, { ...first, action: 'list' });
    assert.deepEqual(replaced.map((entry) => entry.id), ['a', 'b']);
    assert.equal(replaced[0].action, 'list');
    assert.deepEqual(removePermission(replaced, 'a').map((entry) => entry.id), ['b']);
    assert.deepEqual(removePermission(replaced, 'missing').map((entry) => entry.id), ['a', 'b']);
  });

  await check('resolved ids are filtered and bounded', async () => {
    const list = [
      { id: 'a', sessionID: 'ses_1', action: 'read', resources: [] },
      { id: 'b', sessionID: 'ses_1', action: 'read', resources: [] },
    ];
    assert.deepEqual(filterResolved(list, new Set(['a'])).map((entry) => entry.id), ['b']);
    assert.equal(filterResolved(list, new Set()).length, 2);
    const resolved = new Set();
    for (let index = 0; index < RESOLVED_PERMISSION_LIMIT + 5; index += 1) {
      rememberResolved(resolved, `per_${index}`);
    }
    assert.equal(resolved.size, RESOLVED_PERMISSION_LIMIT);
    assert.equal(resolved.has('per_0'), false);
    assert.equal(resolved.has(`per_${RESOLVED_PERMISSION_LIMIT + 4}`), true);
    // Re-answering an id moves it to the newest position instead of duplicating.
    rememberResolved(resolved, `per_${RESOLVED_PERMISSION_LIMIT + 4}`);
    assert.equal(resolved.size, RESOLVED_PERMISSION_LIMIT);
  });

  await check('a stale list does not erase a request that arrived while it ran', async () => {
    const make = (id) => ({ id, sessionID: 'ses_1', action: 'read', resources: [] });
    const before = make('old');
    const arrived = make('new');
    // The server answered without the request that came in during the read.
    const merged = mergePermissionList([], [before, arrived], new Set(['old']));
    assert.deepEqual(merged.map((entry) => entry.id), ['new']);
    // The server already knows it: no duplicate card.
    assert.deepEqual(
      mergePermissionList([arrived], [arrived], new Set()).map((entry) => entry.id),
      ['new'],
    );
    // An entry the host knew before but the server dropped was answered or
    // expired, so it must not come back.
    assert.deepEqual(mergePermissionList([], [before], new Set(['old'])), []);
    // The server order wins and newer entries keep their arrival order after it.
    assert.deepEqual(
      mergePermissionList([make('s1'), make('s2')], [make('n1'), make('s1'), make('n2')], new Set())
        .map((entry) => entry.id),
      ['s1', 's2', 'n1', 'n2'],
    );
  });

  await check('the card title follows the terminal wording', async () => {
    const base = { id: 'per_1', sessionID: 'ses_1' };
    assert.deepEqual(permissionSummary({ ...base, action: 'read', resources: ['src/a.ts'] }), {
      title: 'Read src/a.ts',
    });
    assert.deepEqual(permissionSummary({ ...base, action: 'grep', resources: ['TODO'] }), {
      title: 'Grep "TODO"',
    });
    assert.deepEqual(permissionSummary({ ...base, action: 'shell', resources: ['git status'] }), {
      title: 'Shell command',
      detail: '$ git status',
    });
    assert.deepEqual(permissionSummary({ ...base, action: 'webfetch', resources: ['https://x.y'] }), {
      title: 'WebFetch https://x.y',
    });
    assert.deepEqual(
      permissionSummary({ ...base, action: 'external_directory', resources: ['/tmp/other/*'] }),
      { title: 'Access external directory /tmp/other' },
    );
    assert.deepEqual(permissionSummary({ ...base, action: 'mcp_thing', resources: [] }), {
      title: 'Call tool mcp_thing',
    });
    // A long command is cut instead of blowing up the card.
    const long = permissionSummary({ ...base, action: 'shell', resources: ['x'.repeat(900)] });
    assert.ok(long.detail.length < 500);
  });

  await check('reading a request survives garbage', async () => {
    assert.equal(readPermissionRequest(null), undefined);
    assert.equal(readPermissionRequest({}), undefined);
    assert.equal(readPermissionRequest({ id: 'per_1', action: 'read' }), undefined);
    assert.equal(readPermissionRequest({ id: '', sessionID: 'ses_1', action: 'read' }), undefined);
    const request = readPermissionRequest({
      id: 'per_1',
      sessionID: 'ses_1',
      action: 'read',
      resources: ['src/a.ts', 5, null],
      save: [],
      message: '',
      source: { type: 'tool' },
      metadata: { patch: 'secret' },
    });
    assert.deepEqual(request, {
      id: 'per_1',
      sessionID: 'ses_1',
      action: 'read',
      resources: ['src/a.ts'],
      save: undefined,
      message: undefined,
      source: { type: 'tool', messageID: undefined, id: undefined },
    });
    assert.equal(readSavedPermission(null), undefined);
    assert.equal(readSavedPermission({ id: 'psv_1' }), undefined);
    assert.equal(readSavedPermission({ ...savedRule, time: undefined }).created, 0);
  });
} finally {
  await new Promise((done) => server.close(done));
}

if (failures > 0) {
  console.error(`${failures} permission check(s) failed`);
  process.exit(1);
}
console.log('permissions: all checks passed');
