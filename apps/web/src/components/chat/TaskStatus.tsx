import type { AgentStatus } from '@egent/shared';

const states: Record<AgentStatus, { label: string; icon: string; tone: string; active?: boolean }> =
  {
    PENDING: {
      label: '等待分析',
      icon: 'M12 8v4l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      tone: 'waiting',
      active: true,
    },
    ANALYZING: {
      label: '只读分析中',
      icon: 'm12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z',
      tone: 'working',
      active: true,
    },
    QUEUED: {
      label: '已确认 · 排队执行',
      icon: 'M4 6h16M4 12h10M4 18h6m7-3 3 3-3 3',
      tone: 'waiting',
      active: true,
    },
    WAITING_USER_CONFIRMATION: {
      label: '等待请求者或项目所属人确认',
      icon: 'M9 8v8m6-8v8 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      tone: 'waiting',
    },
    WAITING_OWNER_CONFIRMATION: {
      label: '等待项目所属人确认',
      icon: 'M9 8v8m6-8v8 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      tone: 'waiting',
    },
    IMPLEMENTING: {
      label: '正在修改项目',
      icon: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',
      tone: 'working',
      active: true,
    },
    COMPLETED: {
      label: '已完成',
      icon: 'm8 12 3 3 5-6',
      tone: 'success',
    },
    FAILED: {
      label: '未完成',
      icon: 'M12 8v5m0 3h.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      tone: 'error',
    },
    CANCELLED: {
      label: '已取消',
      icon: 'm9 9 6 6m0-6-6 6 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      tone: 'muted',
    },
  };

/** Animate only live work; settled states remain immediately readable. */
export function TaskStatus({ status, online = true }: { status: AgentStatus; online?: boolean }) {
  const state = states[status];
  return (
    <span
      className={`task-state task-state--${state.tone}${state.active && online ? ' is-working' : ''}`}
      role="status"
      aria-atomic="true"
    >
      <svg
        className="task-state-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {status === 'COMPLETED' && (
          <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
        )}
        <path
          d={state.icon}
          stroke={status === 'COMPLETED' ? '#fff' : undefined}
          strokeWidth={status === 'COMPLETED' ? 2.2 : undefined}
        />
      </svg>
      <span className="task-state-label">{state.label}</span>
    </span>
  );
}
