import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'authorization',
]);

function forwardableHeaders(source: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name)) {
      continue;
    }
    headers[name] = value;
  }
  return headers;
}

export interface LocalProxy {
  readonly origin: string;
  dispose(): void;
}

export function startLocalProxy(target: URL, credential: string): Promise<LocalProxy> {
  const server = http.createServer((request, response) => {
    const headers = forwardableHeaders(request.headers);
    headers.host = target.host;
    headers.authorization = `Basic ${credential}`;

    const upstream = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url,
        headers,
      },
      (reply) => {
        response.writeHead(
          reply.statusCode ?? 502,
          reply.statusMessage,
          forwardableHeaders(reply.headers),
        );
        response.socket?.setNoDelay(true);
        reply.pipe(response);
      },
    );

    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      }
      response.end('OpenCode server is not reachable');
    });

    request.pipe(upstream);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        dispose: () => server.close(),
      });
    });
  });
}
