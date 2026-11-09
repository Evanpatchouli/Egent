import { useCallback, useEffect, useState } from 'react';
import type { AgentTaskInfo } from '@egent/shared';
import type { ChatConnection } from './useChatConnection';
import { request } from '../api/client';
/** Load all visible task cards; permissions are computed by the project host for this user. */
export function useAgentTask(conversationId: string, connection: ChatConnection) {
  const [tasks, setTasks] = useState<AgentTaskInfo[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let active = true,
      pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const rows = await request<AgentTaskInfo[]>(
          '/api/conversations/' + conversationId + '/agent-tasks',
        );
        if (active) {
          setTasks(rows);
          setError('');
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : '任务加载失败');
      } finally {
        pending = false;
      }
    };
    const update = (task: AgentTaskInfo) => {
      if (task.conversationId === conversationId) void load();
    };
    connection.socket?.on('agent:task:update', update);
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
      connection.socket?.off('agent:task:update', update);
    };
  }, [conversationId, connection.socket, connection.connected, revision]);
  return { tasks, error, refresh };
}
