import type { AgentStatus } from '@egent/shared';
/** Database partial index uses this same set of active states. */
export const activeStatuses: AgentStatus[] = [
  'PENDING',
  'QUEUED',
  'ANALYZING',
  'WAITING_USER_CONFIRMATION',
  'WAITING_OWNER_CONFIRMATION',
  'IMPLEMENTING',
];
const allowed: Record<AgentStatus, AgentStatus[]> = {
  PENDING: ['ANALYZING', 'FAILED', 'CANCELLED'],
  QUEUED: ['IMPLEMENTING', 'FAILED', 'CANCELLED'],
  ANALYZING: [
    'PENDING',
    'WAITING_USER_CONFIRMATION',
    'WAITING_OWNER_CONFIRMATION',
    'IMPLEMENTING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ],
  WAITING_USER_CONFIRMATION: ['PENDING', 'QUEUED', 'FAILED', 'CANCELLED'],
  WAITING_OWNER_CONFIRMATION: ['PENDING', 'QUEUED', 'FAILED', 'CANCELLED'],
  IMPLEMENTING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};
/** Central authority for all task transitions; terminal tasks cannot execute again. */
export function assertTransition(from: AgentStatus, to: AgentStatus): void {
  if (!allowed[from].includes(to))
    throw new Error('非法 AgentTask 状态转换：' + from + ' -> ' + to);
}
