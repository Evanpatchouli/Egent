import { useRef, useState } from 'react';
import { Button, Dialog, Radio } from '@material-tailwind/react';
import type { ConversationInfo } from '@egent/shared';
import { request } from '../api/client';
import { InvitePeople, type PeerContact } from './InvitePeople';

type ProjectOwner = {
  deviceId: string;
  nickname: string;
  projects: { path: string; name: string }[];
};
/** Two deliberate steps: invite people, then bind exactly one member-owned project. */
export function ConnectDialog({
  onClose,
  onCreated,
  conversation,
}: {
  onClose: () => void;
  onCreated: (conversation: ConversationInfo) => void;
  conversation?: ConversationInfo;
}) {
  const [selected, setSelected] = useState<PeerContact[]>([]);
  const [step, setStep] = useState(1);
  const [owners, setOwners] = useState<ProjectOwner[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const id = useRef(crypto.randomUUID());
  const locked = busy || connecting;
  async function next() {
    setBusy(true);
    setError('');
    try {
      const rows = await request<ProjectOwner[]>('/api/workspace/projects', {
        method: 'POST',
        body: { memberIds: selected.map((p) => p.deviceId) },
      });
      setOwners(rows);
      setOwnerId(rows[0]?.deviceId ?? '');
      setProject('');
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : '项目读取失败');
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const result = await request<ConversationInfo>(
        conversation ? '/api/conversations/' + conversation.id + '/invite' : '/api/conversations',
        {
          method: 'POST',
          body: conversation
            ? { memberIds: selected.map((p) => p.deviceId) }
            : {
                id: id.current,
                hostId: ownerId,
                projectPath: project,
                memberIds: selected.map((p) => p.deviceId),
              },
        },
      );
      onCreated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '未能完成，请重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={() => {
        if (!locked) onClose();
      }}
    >
      <Dialog.Overlay>
        <Dialog.Content className="invite-dialog p-6" aria-labelledby="invite-title">
          <div className="invite-heading">
            <small>{conversation ? '一起继续讨论' : `新聊天 · ${step} / 2`}</small>
            <h2 id="invite-title">{step === 1 ? '邀请同事' : '选择会话项目'}</h2>
            <p>
              {conversation
                ? '新同事将从加入后的记录开始参与，会话项目保持不变。'
                : step === 1
                  ? '把需要一起讨论的同事加进来，也可以先创建自己的会话。'
                  : '从你和同事开放的项目中选一个。创建后，会话将始终属于这个项目。'}
            </p>
          </div>
          {step === 1 ? (
            <InvitePeople
              selected={selected}
              onChange={setSelected}
              disabled={busy}
              onBusy={setConnecting}
              excluded={conversation?.members?.map((m) => m.deviceId)}
            />
          ) : (
            <div className="project-cascader" aria-label="会话项目二级选择器">
              <section>
                <h3>1. 项目所属人</h3>
                <div role="group" aria-label="项目所属人">
                  {owners.map((owner) => (
                    <Button
                      ripple
                      variant="ghost"
                      key={owner.deviceId}
                      aria-pressed={ownerId === owner.deviceId}
                      className={ownerId === owner.deviceId ? 'selected-owner' : ''}
                      disabled={busy}
                      onClick={() => {
                        setOwnerId(owner.deviceId);
                        setProject('');
                      }}
                    >
                      <span>{owner.nickname}</span>
                      <small>{owner.projects.length} 个项目 ›</small>
                    </Button>
                  ))}
                </div>
              </section>
              <section>
                <h3>2. 开放的项目</h3>
                <Radio value={project} onValueChange={setProject}>
                  <div className="cascader-projects">
                    {owners
                      .find((o) => o.deviceId === ownerId)
                      ?.projects.map((p, i) => (
                        <div
                          key={p.path}
                          className={'cascader-project ' + (project === p.path ? 'chosen' : '')}
                        >
                          <Radio.Item
                            className="egent-control"
                            name="conversation-project"
                            id={'group-project-' + i}
                            value={p.path}
                            disabled={busy}
                          >
                            <Radio.Indicator />
                          </Radio.Item>
                          <label htmlFor={'group-project-' + i}>
                            <strong>{p.name}</strong>
                            <small>{p.path}</small>
                          </label>
                        </div>
                      ))}
                  </div>
                </Radio>
                {!owners.find((o) => o.deviceId === ownerId)?.projects.length && (
                  <p className="sidebar-empty">
                    还没有开放的项目。请这位成员在项目设置中开放一个项目。
                  </p>
                )}
              </section>
            </div>
          )}
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <footer className="invite-actions">
            <Button ripple variant="ghost" disabled={locked} onClick={onClose}>
              取消
            </Button>
            <div className="flex gap-2">
              {step === 2 && (
                <Button
                  ripple
                  variant="outline"
                  color="secondary"
                  disabled={locked}
                  onClick={() => setStep(1)}
                >
                  上一步
                </Button>
              )}
              {step === 1 && !conversation ? (
                <Button ripple disabled={locked} onClick={() => void next()}>
                  下一步：选择项目
                </Button>
              ) : (
                <Button
                  ripple
                  disabled={locked || (conversation ? !selected.length : !project)}
                  onClick={() => void submit()}
                >
                  {busy ? '正在准备会话…' : conversation ? '邀请加入' : '创建会话'}
                </Button>
              )}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog>
  );
}
