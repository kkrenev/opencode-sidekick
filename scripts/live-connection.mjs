/**
 * Manual live check of the connection policy (`npm run compile` does not run
 * it): `node scripts/live-connection.mjs`.
 *
 * A fake SSE server stands in for OpenCode: the client connects, the server
 * dies, the retries back off, the server comes back on another port with
 * another password, `service.json` is rewritten, and the client has to follow
 * it, report one reconnect, and drop the replayed frame by its envelope id.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { OpenCodeClient } = require(resolve(root, 'out/opencode-client.js'));
const { RECONNECT_BASE_MS, RECONNECT_CAP_MS, reconnectDelay } = require(
  resolve(root, 'out/shared/reconnect.js'),
);

const state = await mkdtemp(join(tmpdir(), 'sidekick-connection-'));
const serviceFile = join(state, 'opencode', 'service.json');
await mkdir(dirname(serviceFile), { recursive: true });

async function writeService(url, password) {
  await writeFile(serviceFile, JSON.stringify({ url, password }), 'utf8');
}

/** The same shape `src/opencode-endpoint.ts` reads, without `vscode`. */
async function readService() {
  try {
    const file = JSON.parse(await readFile(serviceFile, 'utf8'));
    if (!file.url || !file.password) {
      return undefined;
    }
    return {
      url: file.url,
      credential: Buffer.from(`opencode:${file.password}`).toString('base64'),
    };
  } catch {
    return undefined;
  }
}

function frame(id, seq) {
  return {
    id,
    created: Date.now(),
    type: 'session.updated',
    data: { info: { id: 'ses_live' } },
    durable: { aggregateID: 'ses_live', seq },
  };
}

/** A fake OpenCode that answers `/api/info` and streams the given frames. */
function startServer(frames) {
  const sockets = new Set();
  const requests = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    requests.push(path);
    if (path === '/api/info') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"data":{}}');
      return;
    }
    if (path === '/api/event') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      for (const entry of frames) {
        response.write(`data: ${JSON.stringify(entry)}\n\n`);
      }
      // Keep the stream open like the real server does.
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"name":"NotFoundError"}');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      done({
        url: `http://127.0.0.1:${port}`,
        port,
        requests,
        close: () =>
          new Promise((closed) => {
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close(() => closed());
          }),
      });
    });
  });
}

async function waitFor(what, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const events = [];
const reconnects = [];
const errors = [];

let serverA;
let serverB;
let client;
let stop = () => undefined;

try {
  serverA = await startServer([frame('evt_1', 1), frame('evt_2', 2), frame('evt_2', 2), frame('evt_3', 3)]);
  await writeService(serverA.url, 'first-password');
  client = new OpenCodeClient(await readService(), () => readService());
  stop = client.subscribe(
    (event) => events.push({ id: event.id, at: Date.now() }),
    () => reconnects.push(Date.now()),
    (error) => errors.push({ message: error?.message ?? String(error), at: Date.now() }),
  );

  await waitFor('the first frames', () => events.length >= 3, 5000);
  assert.equal(client.endpoint.url, serverA.url, 'the client uses the endpoint of service.json');
  assert.equal(events.length, 3, 'the repeated envelope id is dropped');
  assert.equal(events.filter((event) => event.id === 'evt_2').length, 1, 'evt_2 arrived once');
  console.log(`connected: ${events.map((event) => event.id).join(', ')}`);

  // The server dies: the retries must back off instead of hammering it.
  await serverA.close();
  await waitFor('three failed attempts', () => errors.length >= 3, 20000);
  const gaps = [errors[1].at - errors[0].at, errors[2].at - errors[1].at];
  console.log(`retry gaps: ${gaps.join(' ms, ')} ms`);
  assert.ok(
    gaps[0] >= RECONNECT_BASE_MS * 0.75 - 200 && gaps[0] <= RECONNECT_BASE_MS * 1.25 + 400,
    `first gap ${gaps[0]} ms is around the base delay`,
  );
  assert.ok(
    gaps[1] >= RECONNECT_BASE_MS * 1.5 - 200 && gaps[1] <= RECONNECT_BASE_MS * 2.5 + 400,
    `second gap ${gaps[1]} ms is around twice the base delay`,
  );
  assert.ok(gaps[1] > gaps[0], 'the delay grows');

  // The server comes back on another port with another password.
  serverB = await startServer([frame('evt_3', 3), frame('evt_4', 4)]);
  await writeService(serverB.url, 'second-password');
  await waitFor('the client to follow the new port', () => events.some((event) => event.id === 'evt_4'), 25000);

  assert.equal(client.endpoint.url, serverB.url, 'the client rotated to the new port');
  assert.ok(
    serverB.requests.includes('/api/event'),
    `the new server was asked for the stream: ${serverB.requests.join(', ')}`,
  );
  assert.ok(reconnects.length >= 1, 'the panel was told about the reconnect');
  assert.equal(
    events.filter((event) => event.id === 'evt_3').length,
    1,
    'the replayed evt_3 was dropped',
  );
  assert.equal(events.filter((event) => event.id === 'evt_4').length, 1, 'evt_4 arrived once');

  // The cap is a policy constant, not a timed measurement: waiting for it
  // would take a minute per attempt.
  assert.equal(reconnectDelay(20, () => 0.5), RECONNECT_CAP_MS, 'the delay is capped');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    assert.ok(reconnectDelay(attempt, () => 1) <= RECONNECT_CAP_MS, `attempt ${attempt} stays under the cap`);
  }
  console.log('PASS: reconnect, backoff, endpoint rotation and dedup work end to end');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error(`events: ${JSON.stringify(events)}`);
  console.error(`errors: ${JSON.stringify(errors.map((entry) => entry.message))}`);
  process.exitCode = 1;
} finally {
  stop();
  await serverA?.close();
  await serverB?.close();
  await rm(state, { recursive: true, force: true });
}
