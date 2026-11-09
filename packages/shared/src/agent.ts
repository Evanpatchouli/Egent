/** Persisted Agent workflow states; classification is unknown before analysis. */
export type AgentStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'ANALYZING'
  | 'WAITING_USER_CONFIRMATION'
  | 'WAITING_OWNER_CONFIRMATION'
  | 'IMPLEMENTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
/** The only supported P4 workflows. */
export type AgentType = 'DEVELOPMENT_SIMPLE' | 'DEVELOPMENT_COMPLEX' | 'QUESTION';
/** Public task data excludes raw model output and internal metadata. */
export interface AgentTaskInfo {
  intent: 'QUESTION' | 'TASK';
  requirement: string;
  requestedByUserId: string;
  plan: { summary: string; steps: string[]; affectedAreas: string[]; risks: string[] } | null;
  result: { summary: string; changedFiles: string[]; verification: string[] } | null;
  canConfirm?: boolean;
  canCancel?: boolean;
  canRevise?: boolean;
  createdAt: string;
  revision: number;
  taskId: string;
  conversationId: string;
  type: AgentType | null;
  status: AgentStatus;
  planVersion: number;
  updatedAt: string;
  errorMessage: string | null;
}
