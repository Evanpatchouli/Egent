import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageInfo, MessagePage, UserInfo } from '@egent/shared';
import { request } from '../api/client';
import type { ChatConnection } from './useChatConnection';

/** Preserve server identity and deterministic ordering across history, broadcasts and acknowledgements. */
export function mergeMessages(current: MessageInfo[], incoming: MessageInfo[]): MessageInfo[] {
  return [
    ...new Map([...current, ...incoming].map((message) => [message.id, message])).values(),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
/** Scope all asynchronous results to this mounted conversation; a switch remounts the view. */
export function useConversationMessages(id: string, user: UserInfo, connection: ChatConnection) {
  const [messages, setMessages] = useState<MessageInfo[]>([]);
  const latest = useRef<MessageInfo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState('');
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({});
  const [retrySync, setRetrySync] = useState(0);
  const alive = useRef(true);
  const add = useCallback((items: MessageInfo[]) => {
    if (!alive.current) return;
    latest.current = mergeMessages(latest.current, items);
    setMessages(latest.current);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const socket = connection.socket;
    const onMessage = (message: MessageInfo) => {
      if (message.conversationId === id) add([message]);
    };
    const onTyping = (data: { conversationId: string; user: { id: string; name: string } }) => {
      if (data.conversationId === id && data.user.id !== user.id)
        setTyping((rows) => ({
          ...rows,
          [data.user.id]: { name: data.user.name, until: Date.now() + 4000 },
        }));
    };
    const offTyping = (data: { conversationId: string; user: { id: string } }) => {
      if (data.conversationId === id)
        setTyping((rows) => {
          const result = { ...rows };
          delete result[data.user.id];
          return result;
        });
    };
    socket?.on('message:new', onMessage);
    socket?.on('typing:start', onTyping);
    socket?.on('typing:stop', offTyping);
    async function sync() {
      // Freeze the pre-reconnect boundary before live room events can advance the local list.
      const last = latest.current.at(-1);
      setError('');
      setLoading(true);
      try {
        await request('/api/conversations/' + id + '/join', { method: 'POST' });
        if (cancelled) return;
        if (socket?.connected)
          await new Promise<void>((resolve, reject) => {
            socket
              .timeout(8000)
              .emit('conversation:join', { conversationId: id }, (timeoutError, result) => {
                if (cancelled) {
                  return resolve();
                }
                if (timeoutError) reject(new Error('进入会话超时'));
                else if (!result.ok) reject(new Error(result.error.message));
                else resolve();
              });
          });
        if (cancelled) return;
        if (!last) {
          const page = await request<MessagePage>('/api/conversations/' + id + '/messages');
          if (cancelled) return;
          add(page.items);
          setCursor(page.nextCursor);
          setHasMore(page.hasMore);
        } else {
          let after = last.id;
          for (;;) {
            const page = await request<MessagePage>(
              '/api/conversations/' + id + '/messages?limit=100&after=' + after,
            );
            if (cancelled) return;
            add(page.items);
            if (!page.hasMore || !page.nextCursor) break;
            after = page.nextCursor;
          }
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '历史加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void sync();
    const timer = setInterval(
      () =>
        setTyping((rows) =>
          Object.fromEntries(Object.entries(rows).filter(([, value]) => value.until > Date.now())),
        ),
      1000,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
      socket?.off('message:new', onMessage);
      socket?.off('typing:start', onTyping);
      socket?.off('typing:stop', offTyping);
      if (socket?.connected) {
        socket.emit('typing:stop', { conversationId: id });
        socket.emit('conversation:leave', { conversationId: id });
      }
    };
  }, [id, user.id, connection.socket, connection.connected, retrySync, add]);
  async function earlier() {
    if (loadingEarlier || !hasMore || !cursor) return;
    setLoadingEarlier(true);
    setError('');
    try {
      const page = await request<MessagePage>(
        '/api/conversations/' + id + '/messages?before=' + cursor,
      );
      if (!alive.current) return;
      add(page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : '加载失败');
    } finally {
      if (alive.current) setLoadingEarlier(false);
    }
  }
  return {
    messages,
    add,
    hasMore,
    loading,
    loadingEarlier,
    earlier,
    error,
    typing: Object.values(typing).map((value) => value.name),
    retry: () => setRetrySync((value) => value + 1),
  };
}
