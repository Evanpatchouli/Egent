import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@egent/shared';
import { createApp } from '../src/app.js';
import { attachSocketServer } from '../src/socket/index.js';

const allowedOrigin = 'http://localhost:5173';
const deniedOrigin = 'http://untrusted.invalid';
const desktopVersion = JSON.parse(
  readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8'),
).version as string;
const server = createServer(createApp([allowedOrigin]).callback());
const socketServer = attachSocketServer(server, [allowedOrigin]);
let baseUrl: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => socketServer.close(() => resolve()));
});

test('health returns the shared contract and allows configured browser origins', async () => {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: allowedOrigin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.service, 'egent-server');
  assert.equal(body.version, desktopVersion);
  assert.equal(typeof body.timestamp, 'string');
  assert.ok(Number.isFinite(Date.parse(String(body.timestamp))));
});

test('HTTP does not grant CORS to unlisted origins', async () => {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: deniedOrigin } });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('unknown paths, unsupported methods, and malformed JSON have appropriate status', async () => {
  assert.equal((await fetch(`${baseUrl}/missing`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/health`, { method: 'POST' })).status, 405);
  const invalidJson = await fetch(`${baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: allowedOrigin },
    body: '{',
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.deepEqual(await invalidJson.json(), { error: { code: 'HTTP_400', message: '请求无效' } });
});

for (const transport of ['polling', 'websocket'] as const) {
  test(`Socket.IO ${transport} ping/pong works`, { timeout: 8_000 }, async () => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = connect(baseUrl, {
      transports: [transport],
      extraHeaders: { Origin: allowedOrigin },
      reconnection: false,
      autoConnect: false,
      timeout: 3_000,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('No pong received')), 5_000);
        socket.once('connect_error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        socket.once('pong', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once('connect', () => socket.emit('ping'));
        socket.connect();
      });
    } finally {
      socket.disconnect();
    }
  });

  test(
    `Socket.IO ${transport} rejects an unlisted browser origin`,
    { timeout: 5_000 },
    async () => {
      const socket = connect(baseUrl, {
        transports: [transport],
        extraHeaders: { Origin: deniedOrigin },
        reconnection: false,
        autoConnect: false,
        timeout: 2_000,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', () =>
            reject(new Error('Unexpected connection from denied origin')),
          );
          socket.once('connect_error', (error) => {
            if (error.message === 'timeout') reject(new Error('Expected rejection, not a timeout'));
            else resolve();
          });
          socket.connect();
        });
      } finally {
        socket.disconnect();
      }
    },
  );
}
