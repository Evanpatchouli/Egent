import type { Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ConversationInfo,
  MessageInfo,
  MessagePage,
  AgentTaskInfo,
} from '@egent/shared';
import type { DeviceService } from './service.js';
import { chatEvents } from '../services/chat-events.js';

/** A local authenticated socket routes every conversation through its own authority and visibility checks. */
export function bridgeWorkspace(
  socket: Socket<ClientToServerEvents, ServerToClientEvents>,
  device: DeviceService,
) {
  const joined = new Map<string, string | undefined>();
  let updating = false;
  let membership = Promise.resolve();
  const update = async () => {
    if (updating || !socket.connected) return;
    updating = true;
    try {
      socket.emit('conversation:updated', { conversationId: '' });
      for (const [id, cursor] of joined) {
        let after = cursor;
        for (let n = 0; n < 100; n++) {
          const page = (await device.workspace(
            'GET',
            '/api/conversations/' + id + '/messages?limit=100' + (after ? '&after=' + after : ''),
          )) as MessagePage;
          if (!joined.has(id)) break;
          for (const message of page.items) {
            if (cursor) await device.observeMessage(message);
            socket.emit('message:new', message);
          }
          if (page.items.length) {
            after = page.items.at(-1)!.id;
            joined.set(id, after);
          }
          if (!page.hasMore || !cursor) break;
        }
        const tasks = (await device.workspace(
          'GET',
          '/api/conversations/' + id + '/agent-tasks',
        )) as AgentTaskInfo[];
        if (joined.has(id) && tasks[0]) socket.emit('agent:task:update', tasks[0]);
      }
    } catch {
      /* HTTP history retry and the next sync pulse recover disconnected authorities. */
    } finally {
      updating = false;
    }
  };
  const notify = () => {
    void update();
  };
  chatEvents.on('peerSync', notify);
  chatEvents.on('conversation', notify);
  chatEvents.on('read', notify);
  chatEvents.on('agent', notify);
  const notificationsChanged = () => socket.emit('notification:updated');
  chatEvents.on('notificationsChanged', notificationsChanged);
  socket.on('conversation:join', (data, ack) => {
    membership = membership.then(async () => {
      try {
        const c = (await device.workspace(
          'POST',
          '/api/conversations/' + data.conversationId + '/join',
        )) as ConversationInfo;
        const page = (await device.workspace(
          'GET',
          '/api/conversations/' + c.id + '/messages?limit=1',
        )) as MessagePage;
        if (socket.connected) joined.set(c.id, page.items.at(-1)?.id);
        ack({ ok: true, data: c });
      } catch (e) {
        ack({
          ok: false,
          error: {
            code: 'CONVERSATION_UNAVAILABLE',
            message: e instanceof Error ? e.message : '会话不可用',
          },
        });
      }
    });
  });
  socket.on('conversation:leave', (data, ack) => {
    membership = membership.then(() => {
      joined.delete(data.conversationId);
      ack?.({ ok: true, data: null });
    });
  });
  socket.on('message:send', (data, ack) => {
    void (async () => {
      try {
        const message = (await device.workspace(
          'POST',
          '/api/conversations/' + data.conversationId + '/messages',
          { content: data.content, clientMessageId: data.clientMessageId },
        )) as MessageInfo;
        ack({ ok: true, data: message });
        notify();
      } catch (e) {
        ack({
          ok: false,
          error: { code: 'SEND_FAILED', message: e instanceof Error ? e.message : '发送失败' },
        });
      }
    })();
  });
  socket.on('disconnect', () => {
    joined.clear();
    chatEvents.off('peerSync', notify);
    chatEvents.off('conversation', notify);
    chatEvents.off('read', notify);
    chatEvents.off('agent', notify);
    chatEvents.off('notificationsChanged', notificationsChanged);
  });
}
