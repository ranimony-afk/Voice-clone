import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';
import { createLiveWebSocketUnavailableResponse, liveWebSocketDenialReason, type CostPolicyEnvironment } from './costPolicy.ts';

/** Attach the real HTTP-upgrade gate used by the application server. */
export function attachLiveWebSocketUpgradeHandler(
  server: Server,
  wss: WebSocketServer,
  getEnvironment: () => CostPolicyEnvironment,
): void {
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string;
    try {
      const host = request.headers.host || 'localhost';
      pathname = new URL(request.url || '', `http://${host}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== '/live-ws') return;

    const denial = liveWebSocketDenialReason(getEnvironment());
    if (denial) {
      socket.end(createLiveWebSocketUnavailableResponse(denial));
      return;
    }

    try {
      wss.handleUpgrade(request, socket, head, (client) => {
        wss.emit('connection', client, request);
      });
    } catch {
      socket.destroy();
    }
  });
}
