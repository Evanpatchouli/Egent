import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Button } from '@material-tailwind/react';
import type { AgentTaskInfo } from '@egent/shared';
import { AgentStatus } from '../src/components/chat/AgentStatus';
import { Composer } from '../src/components/chat/Composer';
import '../src/styles.css';
const tasks: AgentTaskInfo[] = Array.from({ length: 6 }, (_, i) => ({
  taskId: `fixture-${i}`,
  conversationId: 'fixture',
  intent: 'TASK',
  requirement: i === 0 ? '调整聊天区任务面板的尺寸与位置' : `查看第 ${i} 次项目提交记录`,
  requestedByUserId: 'fixture',
  type: 'DEVELOPMENT_SIMPLE',
  status: i === 0 ? 'WAITING_USER_CONFIRMATION' : 'COMPLETED',
  planVersion: 1,
  revision: 1,
  createdAt: '2026-09-16T00:00:00Z',
  updatedAt: '2026-09-16T00:00:00Z',
  errorMessage: null,
  plan: {
    summary: '保留现有任务功能，调整浮动展示。',
    steps: ['调整面板布局', '验证最小化与展开'],
    affectedAreas: ['聊天任务面板'],
    risks: ['需要验证小窗口滚动'],
  },
  result: null,
  canConfirm: i === 0,
  canCancel: i === 0,
  canRevise: i === 0,
}));
// Isolated fixture: no requests reach a real backend or task executor.
window.fetch = async (_input, init) => {
  const path = new URL(String(_input), location.origin).pathname;
  if (path.endsWith('/agent-participation')) return Response.json({ enabled: true });
  if (path.endsWith('/confirm')) {
    tasks[0]!.status = 'QUEUED';
    tasks[0]!.canConfirm = false;
    return Response.json(tasks[0]);
  }
  if (path.endsWith('/agent-tasks') && (!init?.method || init.method === 'GET'))
    return Response.json(tasks);
  return Response.json({ error: { message: '此验证页不提交真实任务' } }, { status: 400 });
};
function Fixture() {
  const [sent, setSent] = useState('');
  const [online, setOnline] = useState(true);
  return (
    <main className="chat-app" style={{ display: 'flex', height: '100dvh' }}>
      <section className="conversation-view">
        <header className="conversation-header">
          <div>
            <h1>聊天区浮动面板</h1>
            <p>本机项目 · 1 人</p>
          </div>
          <div>
            <Button
              ripple
              variant="ghost"
              onClick={() => {
                tasks[0]!.status = 'ANALYZING';
              }}
            >
              模拟分析
            </Button>
            <Button
              ripple
              variant="ghost"
              onClick={() => {
                tasks[0]!.status = 'IMPLEMENTING';
              }}
            >
              模拟执行
            </Button>
            <Button
              ripple
              variant="ghost"
              onClick={() => {
                tasks[0]!.status = 'COMPLETED';
              }}
            >
              模拟完成
            </Button>
            <Button ripple variant="ghost" onClick={() => setOnline(!online)}>
              切换在线
            </Button>
          </div>
        </header>
        <div className="conversation-stage">
          <AgentStatus
            conversationId="fixture"
            connection={{ socket: null, connected: true, error: '' }}
            hostName="项目所属人"
            online={online}
            canConfigureAgent
          />
          <div className="message-scroll">
            <div className="message-column">
              {Array.from({ length: 14 }, (_, i) => (
                <article className="message-row" key={i}>
                  <div className="message-body">
                    <strong>会话成员</strong>
                    <p>这是第 {i + 1} 条聊天消息，任务面板不会再占据聊天布局。</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
        <Composer members={[]} disabled={false} onSend={setSent} onTyping={() => {}} />
        <output aria-label="发送记录">{sent}</output>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
