import type { Server as HttpServer } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { prisma } from '@egent/database';
import type {
  ChatAck,
  ChatError,
  ClientToServerEvents,
  ServerToClientEvents,
  MessageInfo,
  UserInfo,
  AgentTaskInfo,
} from '@egent/shared';
import { resolveUser } from '../services/users.js';
import { accessConversation, joinConversation, requireUuid } from '../services/conversations.js';
import { sendMessage } from '../services/messages.js';
import { chatEvents } from '../services/chat-events.js';
import { ApiError } from '../errors.js';
import type { DeviceService } from '../device/service.js';
import { localUser } from '../device/identity.js';
import { bridgeWorkspace } from '../device/socket-bridge.js';

type ChatServer = Server<ClientToServerEvents, ServerToClientEvents>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
const room = (id: string) => 'conversation:' + id;
function safeError(error: unknown): ChatError {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  console.error('[chat]', error);
  return { code: 'INTERNAL_ERROR', message: '消息处理失败，请重试' };
}
function conversationId(data: unknown): string {
  return requireUuid(
    data && typeof data === 'object' && 'conversationId' in data ? data.conversationId : undefined,
  );
}
/** Wire post-commit notifications and authenticated conversation events to an existing server. */
export function attachChat(io: ChatServer, httpServer: HttpServer, device?: DeviceService) {
  io.use(async (socket, next) => {
    if (device) {
      if (socket.handshake.auth.localToken !== device.localToken)
        return next(new Error('INVALID_IDENTITY'));
      const current = await localUser(device.identity);
      if (!current) return next(new Error('INVALID_IDENTITY'));
      socket.handshake.auth.identifier = current.identifier;
    }
    const identifier: unknown = socket.handshake.auth.identifier;
    if (identifier === undefined) return next(); // P1 anonymous ping only.
    try {
      if (typeof identifier !== 'string') throw new ApiError(401, 'INVALID_IDENTITY', '身份无效');
      const current = await resolveUser(identifier);
      await socket.join('user:' + current.id);
      next();
    } catch {
      next(new Error('INVALID_IDENTITY'));
    }
  });
  const message = (data: MessageInfo) => {
    io.to(room(data.conversationId)).emit('message:new', data);
  };
  const updated = (id: string) => {
    void prisma.user
      .findMany({
        where: { OR: [{ role: 'OWNER' }, { participations: { some: { conversationId: id } } }] },
        select: { id: true },
      })
      .then((users) =>
        io
          .to(users.map((user) => 'user:' + user.id))
          .emit('conversation:updated', { conversationId: id }),
      )
      .catch((error: unknown) => console.error('[chat-notification]', error));
  };
  const read = (userId: string, id: string) => {
    io.to('user:' + userId).emit('conversation:updated', { conversationId: id });
  };
  chatEvents.on('message', message);
  chatEvents.on('conversation', updated);
  chatEvents.on('read', read);
  const agent = (task: AgentTaskInfo) => {
    io.to(room(task.conversationId)).emit('agent:task:update', task);
  };
  chatEvents.on('agent', agent);
  httpServer.once('close', () => {
    chatEvents.off('message', message);
    chatEvents.off('conversation', updated);
    chatEvents.off('read', read);
    chatEvents.off('agent', agent);
  });
  io.on('connection', (socket) => {
    if (device) bridgeWorkspace(socket, device);
    else setupSocket(socket);
  });

  function setupSocket(socket: ChatSocket) {
    const identifier: unknown = socket.handshake.auth.identifier;
    async function user(): Promise<UserInfo> {
      if (typeof identifier !== 'string')
        throw new ApiError(401, 'INVALID_IDENTITY', '请先初始化身份');
      return resolveUser(identifier);
    }
    const typing = new Map<
      string,
      { timer: ReturnType<typeof setTimeout>; user: UserInfo; at: number }
    >();
    function stop(id: string) {
      const active = typing.get(id);
      if (!active) return;
      clearTimeout(active.timer);
      typing.delete(id);
      socket.to(room(id)).emit('typing:stop', {
        conversationId: id,
        user: { id: active.user.id, name: active.user.name, role: active.user.role },
      });
    }
    async function run<T>(
      action: () => Promise<T>,
      ack?: (result: ChatAck<T>) => void,
      data?: unknown,
    ) {
      try {
        const result = await action();
        if (typeof ack === 'function') ack({ ok: true, data: result });
      } catch (cause) {
        const error = safeError(cause);
        if (data && typeof data === 'object') {
          if ('conversationId' in data && typeof data.conversationId === 'string')
            error.conversationId = data.conversationId;
          if ('clientMessageId' in data && typeof data.clientMessageId === 'string')
            error.clientMessageId = data.clientMessageId;
        }
        if (typeof ack === 'function') ack({ ok: false, error });
        socket.emit('message:error', error);
      }
    }
    // Preserve wire order despite asynchronous database checks (including React StrictMode cleanup).
    let membership = Promise.resolve();
    function membershipRun<T>(
      action: () => Promise<T>,
      ack?: (result: ChatAck<T>) => void,
      data?: unknown,
    ) {
      membership = membership.then(() => run(action, ack, data));
    }
    socket.on('conversation:join', (data, ack) =>
      membershipRun(
        async () => {
          const id = conversationId(data);
          const detail = await joinConversation(await user(), id);
          if (socket.connected) await socket.join(room(id));
          return detail;
        },
        ack,
        data,
      ),
    );
    socket.on('conversation:leave', (data, ack) =>
      membershipRun(
        async () => {
          await user();
          const id = conversationId(data);
          stop(id);
          await socket.leave(room(id));
          return null;
        },
        ack,
        data,
      ),
    );
    socket.on(
      'message:send',
      (data, ack) =>
        void run(
          async () => {
            const id = conversationId(data);
            if (
              !data ||
              Object.keys(data).some(
                (key) => !['conversationId', 'content', 'clientMessageId'].includes(key),
              )
            )
              throw new ApiError(400, 'INVALID_MESSAGE', '消息字段无效');
            const result = await sendMessage(await user(), id, {
              content: data.content,
              clientMessageId: data.clientMessageId,
            });
            stop(id);
            return result;
          },
          ack,
          data,
        ),
    );
    socket.on(
      'typing:start',
      (data) =>
        void run(
          async () => {
            const id = conversationId(data);
            const current = await user();
            await accessConversation(current, id);
            if (!socket.connected || !socket.rooms.has(room(id)))
              throw new ApiError(403, 'NOT_IN_ROOM', '请先进入会话');
            const active = typing.get(id);
            const now = Date.now();
            if (active && now - active.at < 1000) return null;
            if (active) clearTimeout(active.timer);
            typing.set(id, { user: current, at: now, timer: setTimeout(() => stop(id), 3500) });
            socket.to(room(id)).emit('typing:start', {
              conversationId: id,
              user: { id: current.id, name: current.name, role: current.role },
            });
            return null;
          },
          undefined,
          data,
        ),
    );
    socket.on(
      'typing:stop',
      (data) =>
        void run(
          async () => {
            await user();
            stop(conversationId(data));
            return null;
          },
          undefined,
          data,
        ),
    );
    socket.on('disconnect', () => {
      for (const id of typing.keys()) stop(id);
    });
  }
}
