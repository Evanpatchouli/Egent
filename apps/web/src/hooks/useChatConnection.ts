import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, UserInfo } from '@egent/shared';
import { config, desktopContext } from '../config';
/** One identity-bound connection per mounted chat application. */
export function useChatConnection(user: UserInfo) {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(
    null,
  );
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const connection: Socket<ServerToClientEvents, ClientToServerEvents> = io(config.socketUrl, {
      auth: { localToken: desktopContext.localToken },
    });
    setSocket(connection);
    connection.on('peer:status', setConnected);
    connection.on('connect', () => {
      setConnected(true);
      setError('');
    });
    connection.on('disconnect', () => setConnected(false));
    connection.on('connect_error', (cause) => {
      setConnected(false);
      setError(cause.message);
      if (cause.message === 'INVALID_IDENTITY')
        window.dispatchEvent(new Event('egent:invalid-identity'));
    });
    connection.on('message:error', (cause) => {
      if (cause.code === 'INVALID_IDENTITY')
        window.dispatchEvent(new Event('egent:invalid-identity'));
    });
    return () => {
      connection.removeAllListeners();
      connection.disconnect();
    };
  }, [user.identifier]);
  return { socket, connected, error };
}
export type ChatConnection = ReturnType<typeof useChatConnection>;
