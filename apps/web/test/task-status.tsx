import { createRoot } from 'react-dom/client';
import type { AgentStatus } from '@egent/shared';
import { TaskStatus } from '../src/components/chat/TaskStatus';
import '../src/styles.css';
const statuses: AgentStatus[] = [
  'PENDING',
  'ANALYZING',
  'QUEUED',
  'WAITING_USER_CONFIRMATION',
  'WAITING_OWNER_CONFIRMATION',
  'IMPLEMENTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 760, margin: '40px auto', padding: 16 }}>
    <section className="task-panel" aria-label="Egent 状态预览">
      <div className="task-panel-heading">
        <strong>Egent</strong>
        <small>任务状态</small>
      </div>
      {statuses.map((status) => (
        <article className="task-card" key={status}>
          <div className="task-card-title">
            <div className="task-card-meta">
              <span className="task-kind">只读问答</span>
              <TaskStatus status={status} />
            </div>
          </div>
          <p className="task-requirement">本项目最近一次 git 提交记录是什么</p>
        </article>
      ))}
      <article className="task-card">
        <div className="task-card-meta">
          <span className="task-kind">离线快照</span>
          <TaskStatus status="ANALYZING" online={false} />
        </div>
      </article>
    </section>
  </main>,
);
