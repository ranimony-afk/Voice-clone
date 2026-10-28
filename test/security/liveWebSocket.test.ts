import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { attachLiveWebSocketUpgradeHandler } from '../../server/security/liveWebSocketUpgrade.ts';

test('live WebSocket policy rejects provider sessions before connection/provider initialization', async () => {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  let providerInitializations = 0;
  wss.on('connection', () => { providerInitializations += 1; });

  let environment: { NODE_ENV: string; GEMINI_API_KEY?: string } = { NODE_ENV: 'development', GEMINI_API_KEY: 'test-provider-key' };
  attachLiveWebSocketUpgradeHandler(server, wss, () => environment);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const requestUpgrade = () => new Promise<string>((resolve, reject) => {
    const socket = net.connect(address.port, '127.0.0.1');
    let response = '';
    socket.setTimeout(2000, () => socket.destroy(new Error('WebSocket denial timed out')));
    socket.on('connect', () => socket.write([
      'GET /live-ws HTTP/1.1',
      `Host: 127.0.0.1:${address.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n')));
    socket.on('data', (chunk) => { response += chunk.toString('utf8'); });
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });

  try {
    const paidKeyDenial = await requestUpgrade();
    assert.match(paidKeyDenial, /^HTTP\/1\.1 503 Service Unavailable\r\n/);
    assert.match(paidKeyDenial, /PAID_FEATURE_DISABLED/);
    assert.equal(providerInitializations, 0);

    environment = { NODE_ENV: 'production' };
    const productionDenial = await requestUpgrade();
    assert.match(productionDenial, /^HTTP\/1\.1 503 Service Unavailable\r\n/);
    assert.equal(providerInitializations, 0);
  } finally {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
