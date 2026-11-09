import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@egent/shared';
import { attachChat } from './chat.js';
import type { DeviceService } from '../device/service.js';

/** Attach typed ping/pong events to the Koa HTTP server. */
export function attachSocketServer(
  httpServer: HttpServer,
  corsOrigins: readonly string[],
  device?: DeviceService,
) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: [...corsOrigins], methods: ['GET', 'POST'], credentials: false },
    // CORS covers polling; enforce the same origin list for WebSocket handshakes too.
    // CLI clients without an Origin remain usable in this unauthenticated P1 service.
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, origin === undefined || corsOrigins.includes(origin));
    },
  });

  attachChat(io, httpServer, device);
  io.on('connection', (socket) => {
    console.log(`[socket] connected ${socket.id}`);
    socket.on('ping', () => {
      socket.emit('pong');
    });
    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected ${socket.id}: ${reason}`);
    });
  });
  return io;
}
