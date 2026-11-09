import { Button, Dialog, Textarea, Switch } from '@material-tailwind/react';
import { useEffect, useRef, useState } from 'react';
import type { AgentTaskInfo } from '@egent/shared';
import type { ChatConnection } from '../../hooks/useChatConnection';
import { useAgentTask } from '../../hooks/useAgentTask';
import { request } from '../../api/client';
import { TaskStatus } from './TaskStatus';
import { FloatingTaskPanel } from './FloatingTaskPanel';
/** Explicit request cards separate model work and approvals from ordinary conversation. */
export function AgentStatus({
  conversationId,
  connection,
  hostName,
  online,
  autoAgentEnabled = true,
  autoAgentError,
  canConfigureAgent = false,
}: {
  conversationId: string;
  connection: ChatConnection;
  hostName: string;
  online: boolean;
  autoAgentEnabled?: boolean;
  autoAgentError?: string | null;
  canConfigureAgent?: boolean;
}) {
  const { tasks, error, refresh } = useAgentTask(conversationId, connection);
  const [automatic, setAutomatic] = useState(autoAgentEnabled);
  const [modeBusy, setModeBusy] = useState(false);
  useEffect(() => setAutomatic(autoAgentEnabled), [autoAgentEnabled]);
  async function toggle(enabled: boolean) {
    setAutomatic(enabled);
    setModeBusy(true);
    setActionError('');
    try {
      await request('/api/conversations/' + conversationId + '/agent-participation', {
        method: 'PUT',
        body: { enabled },
      });
    } catch (e) {
      setAutomatic(!enabled);
      setActionError(e instanceof Error ? e.message : '开关保存失败');
    } finally {
      setModeBusy(false);
    }
  }
  const [form, setForm] = useState<'create' | AgentTaskInfo | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  async function action(task: AgentTaskInfo, name: 'confirm' | 'cancel') {
    setBusy(task.taskId);
    setActionError('');
    try {
      await request('/api/agent-tasks/' + task.taskId + '/' + name, {
        method: 'POST',
        body:
          name === 'confirm'
            ? {
                planVersion: task.planVersion,
                revision: task.revision,
                clientMessageId: crypto.randomUUID(),
              }
            : {},
      });
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '操作失败');
      refresh();
    } finally {
      setBusy('');
    }
  }
  return (
    <FloatingTaskPanel
      hostName={hostName}
      online={online}
      activity={
        !online
          ? undefined
          : tasks.some((task) => task.status === 'IMPLEMENTING')
            ? '正在执行'
            : tasks.some((task) => task.status === 'ANALYZING')
              ? '正在思考'
              : tasks.some((task) => task.status === 'PENDING' || task.status === 'QUEUED')
                ? '正在排队'
                : undefined
      }
    >
      <div className="task-panel-heading">
        <div
          className="agent-mode"
          title={canConfigureAgent ? '会话共享开关' : '仅项目所属人可修改'}
        >
          <Switch
            id="agent-participation"
            role="switch"
            aria-label="智能参与"
            checked={automatic}
            disabled={!online || modeBusy || !canConfigureAgent}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => void toggle(e.target.checked)}
          />
          <label htmlFor="agent-participation">
            智能参与{!canConfigureAgent && <small className="block">仅所属人可修改</small>}
          </label>
        </div>
        <Button
          ripple
          variant="outline"
          color="secondary"
          disabled={!online}
          onClick={() => setForm('create')}
        >
          创建任务
        </Button>
      </div>
      {!tasks.length && !error && (
        <p className="task-hint">
          {automatic
            ? 'Egent 会判断是否需要主动回复；修改代码仍需创建任务并确认。'
            : '已关闭自主回复。输入 @Egent 提问，或创建独立的开发任务。'}
        </p>
      )}
      {automatic && autoAgentError && (
        <p className="task-hint" role="status">
          智能参与暂不可用：{autoAgentError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-red-700">
          {actionError}
        </p>
      )}
      <div className="task-card-list">
        {tasks.map((task) => (
          <article className="task-card" key={task.taskId}>
            <div className="task-card-title">
              <div className="task-card-meta">
                <span className="task-kind">
                  {task.intent === 'QUESTION' ? '只读问答' : '开发任务'}
                </span>
                <TaskStatus status={task.status} online={online} />
                {task.planVersion > 0 && <span className="task-kind">v{task.planVersion}</span>}
              </div>
              <Button
                ripple
                variant="ghost"
                size="sm"
                aria-expanded={expanded === task.taskId}
                onClick={() => setExpanded(expanded === task.taskId ? null : task.taskId)}
              >
                {expanded === task.taskId ? '收起' : '查看详情'}
              </Button>
            </div>
            <p className="task-requirement">{task.requirement}</p>
            {expanded === task.taskId && (
              <div className="task-details">
                {task.plan && (
                  <>
                    <h3>方案 v{task.planVersion}</h3>
                    <p>{task.plan.summary}</p>
                    <ol>
                      {task.plan.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                    <p>影响范围：{task.plan.affectedAreas.join('、') || '未列出'}</p>
                    <p>风险：{task.plan.risks.join('；') || '未识别额外风险'}</p>
                  </>
                )}
                {task.result && (
                  <>
                    <h3>结果</h3>
                    <p>{task.result.summary}</p>
                    {task.result.changedFiles.length > 0 && (
                      <p>修改文件：{task.result.changedFiles.join('、')}</p>
                    )}
                    <ul>
                      {task.result.verification.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </>
                )}
                {task.errorMessage && <p className="text-red-700">{task.errorMessage}</p>}
                <div className="task-actions">
                  {task.canConfirm && (
                    <Button
                      ripple
                      disabled={!online || !!busy}
                      onClick={() => void action(task, 'confirm')}
                    >
                      确认并执行 v{task.planVersion}
                    </Button>
                  )}
                  {task.canRevise && (
                    <Button
                      ripple
                      variant="outline"
                      color="secondary"
                      disabled={!online || !!busy}
                      onClick={() => setForm(task)}
                    >
                      补充需求
                    </Button>
                  )}
                  {task.canCancel && (
                    <Button
                      ripple
                      variant="ghost"
                      disabled={!online || !!busy}
                      onClick={() => void action(task, 'cancel')}
                    >
                      取消任务
                    </Button>
                  )}
                </div>
                {task.status === 'IMPLEMENTING' && (
                  <small>本次只执行已确认方案。新增需求请创建另一项任务。</small>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      {form && (
        <TaskForm
          key={form === 'create' ? 'create' : form.taskId}
          conversationId={conversationId}
          task={form === 'create' ? undefined : form}
          onClose={() => setForm(null)}
          onDone={(task) => {
            setForm(null);
            setExpanded(task.taskId);
            refresh();
          }}
        />
      )}
    </FloatingTaskPanel>
  );
}
function TaskForm({
  conversationId,
  task,
  onClose,
  onDone,
}: {
  conversationId: string;
  task?: AgentTaskInfo;
  onClose: () => void;
  onDone: (task: AgentTaskInfo) => void;
}) {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useRef(crypto.randomUUID());
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const result = await request<AgentTaskInfo>(
        task
          ? '/api/agent-tasks/' + task.taskId + '/revise'
          : '/api/conversations/' + conversationId + '/agent-tasks',
        {
          method: 'POST',
          body: {
            content,
            clientMessageId: id.current,
            ...(task ? { planVersion: task.planVersion, revision: task.revision } : {}),
          },
        },
      );
      onDone(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      size="md"
      onOpenChange={() => {
        if (!busy) onClose();
      }}
    >
      <Dialog.Overlay>
        <Dialog.Content className="p-6 space-y-4" aria-labelledby="task-form-title">
          <h2 id="task-form-title" className="text-xl font-semibold">
            {task ? '补充需求 · 方案 v' + task.planVersion : '创建开发任务'}
          </h2>
          <p>
            {task
              ? '补充后会重新分析并生成新版方案，需要再次确认。'
              : '描述希望完成的修改。Egent 会先只读分析，明确确认后才修改代码。普通聊天不会自动纳入任务。'}
          </p>
          <Textarea
            aria-label="任务需求"
            rows={5}
            value={content}
            disabled={busy}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setContent(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              ripple
              disabled={busy || !content.trim() || content.length > 10000}
              onClick={() => void submit()}
            >
              {busy ? '正在提交…' : task ? '提交补充' : '提交分析'}
            </Button>
            <Button ripple variant="ghost" disabled={busy} onClick={onClose}>
              取消
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog>
  );
}
