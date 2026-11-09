import { useEffect, useState } from 'react';
import type { MessageInfo, SendMessageInput } from '@egent/shared';
import type { ChatConnection } from './useChatConnection';
import { clientMessageId } from '../api/chat';
/** Pending messages survive conversation switches; every retry reuses its original UUID. */
export function useOutbox(connection: ChatConnection) {
  const [items, setItems] = useState<
    Array<SendMessageInput & { status: 'sending' | 'failed'; error?: string }>
  >([]);
  const [delivered, setDelivered] = useState<MessageInfo | null>(null);
  useEffect(() => {
    const socket = connection.socket;
    const receive = (message: MessageInfo) => {
      setItems((rows) =>
        rows.filter(
          (row) =>
            !(
              row.conversationId === message.conversationId &&
              row.clientMessageId === message.clientMessageId
            ),
        ),
      );
    };
    socket?.on('message:new', receive);
    return () => {
      socket?.off('message:new', receive);
    };
  }, [connection.socket]);
  function transmit(input: SendMessageInput) {
    setItems((rows) => [
      ...rows.filter((row) => row.clientMessageId !== input.clientMessageId),
      { ...input, status: 'sending' },
    ]);
    const fail = (error: string) =>
      setItems((rows) =>
        rows.map((row) =>
          row.clientMessageId === input.clientMessageId ? { ...row, status: 'failed', error } : row,
        ),
      );
    const socket = connection.socket;
    if (!socket?.connected) return fail('连接已断开，请重连后重试');
    socket.timeout(8000).emit('message:send', input, (timeoutError, result) => {
      if (timeoutError) return fail('未收到确认，请重试（不会重复发送）');
      if (!result.ok) return fail(result.error.message);
      setItems((rows) => rows.filter((row) => row.clientMessageId !== input.clientMessageId));
      setDelivered(result.data);
    });
  }
  return {
    items,
    delivered,
    retry: (input: SendMessageInput) =>
      transmit({
        conversationId: input.conversationId,
        clientMessageId: input.clientMessageId,
        content: input.content,
      }),
    send: (conversationId: string, content: string) =>
      transmit({ conversationId, content, clientMessageId: clientMessageId() }),
  };
}
