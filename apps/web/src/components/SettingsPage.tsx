import { Button, Input, Switch } from '@material-tailwind/react';
import { useEffect, useRef, useState } from 'react';
import type { UserInfo } from '@egent/shared';
import type { ChatConnection } from '../hooks/useChatConnection';
import { useHealth } from '../hooks/useHealth';
import { request } from '../api/client';
import { ProjectPanel } from './ProjectPanel';
import { GlobalAgentModelSettings } from './AgentModelSettings';

const sections = [
  {
    id: 'general',
    title: '全局设置',
    description: '调整这台设备上的聊天显示方式。',
    icon: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  },
  {
    id: 'nickname',
    title: '修改昵称',
    description: '设置同事在会话中看到的名字。',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 8 0 0 1 16 0v2',
  },
  {
    id: 'projects',
    title: '项目设置',
    description: '管理本机项目对同事的可见性。',
    icon: 'M3 6h7l2 2h9v12H3ZM3 6V4h7l2 2',
  },
  {
    id: 'model',
    title: '模型设置',
    description: '设置本机承载会话的默认执行器、模型和思考强度。',
    icon: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  },
  {
    id: 'connection',
    title: '连接与状态',
    description: '查看本机服务连接并进行连通性测试。',
    icon: 'M8 12h8M9 5H7a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h2m6-14h2a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-2',
  },
] as const;
export function SettingsPage({
  user,
  ownMessagesRight,
  onOwnMessagesRightChange,
  connection,
  onUserChange,
  onBack,
}: {
  user: UserInfo;
  ownMessagesRight: boolean;
  onOwnMessagesRightChange: (value: boolean) => void;
  connection: ChatConnection;
  onUserChange: (user: UserInfo) => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<(typeof sections)[number]['id']>('nickname');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [selected]);
  const current = sections.find((section) => section.id === selected)!;
  return (
    <main className="settings-page" aria-label="设置">
      <aside className="settings-sidebar">
        <Button ripple variant="ghost" className="settings-back" onClick={onBack}>
          <span aria-hidden="true">←</span> 返回聊天
        </Button>
        <h1>设置</h1>
        <nav aria-label="设置菜单">
          {sections
            .filter(
              (section) => !['projects', 'model'].includes(section.id) || user.role === 'OWNER',
            )
            .map((section) => (
              <Button
                ripple
                variant="ghost"
                key={section.id}
                className={'settings-nav-item' + (selected === section.id ? ' selected' : '')}
                aria-current={selected === section.id ? 'page' : undefined}
                onClick={() => setSelected(section.id)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={section.icon} />
                </svg>
                {section.title}
              </Button>
            ))}
        </nav>
      </aside>
      <section className="settings-main" aria-labelledby="settings-page-title">
        <div className="settings-content">
          <header>
            <h2 id="settings-page-title" ref={heading} tabIndex={-1}>
              {current.title}
            </h2>
            <p>{current.description}</p>
          </header>
          <div hidden={selected !== 'nickname'}>
            <NicknameSettings user={user} onUserChange={onUserChange} />
          </div>
          {selected === 'general' && (
            <div className="settings-general-options">
              <div className="settings-display-option">
                <Switch
                  id="own-messages-right"
                  role="switch"
                  aria-label="我的消息显示在右侧"
                  checked={ownMessagesRight}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    onOwnMessagesRightChange(event.target.checked)
                  }
                />
                <label htmlFor="own-messages-right">我的消息显示在右侧</label>
              </div>
              <SystemNotificationSettings />
            </div>
          )}
          {selected === 'projects' && user.role === 'OWNER' && <ProjectPanel user={user} />}
          {selected === 'model' && user.role === 'OWNER' && <GlobalAgentModelSettings />}
          <div hidden={selected !== 'connection'}>
            <ConnectionSettings connection={connection} />
          </div>
        </div>
      </section>
    </main>
  );
}
function SystemNotificationSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<{ systemNotifications: boolean }>('/api/device/notification-settings')
      .then((value) => {
        if (active) setEnabled(value.systemNotifications);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(value: boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ systemNotifications: boolean }>(
        '/api/device/notification-settings',
        {
          method: 'PUT',
          body: { systemNotifications: value },
        },
      );
      setEnabled(result.systemNotifications);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '系统通知设置保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="settings-display-option">
        <Switch
          id="system-notifications"
          role="switch"
          aria-label="允许系统通知"
          checked={enabled ?? true}
          disabled={busy || enabled === null}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            void change(event.target.checked)
          }
        />
        <label htmlFor="system-notifications">允许系统通知</label>
      </div>
      <p className="settings-note">被 @ 时显示 Windows 通知；关闭后仍会在托盘和会话列表提醒。</p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
function NicknameSettings({
  user,
  onUserChange,
}: {
  user: UserInfo;
  onUserChange: (user: UserInfo) => void;
}) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const updated = await request<UserInfo>('/api/device/nickname', {
        local: true,
        method: 'POST',
        body: { name: name.trim() },
      });
      onUserChange(updated);
      setName(updated.name);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '昵称保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor="settings-nickname">昵称</label>
      <Input
        id="settings-nickname"
        aria-label="昵称"
        value={name}
        disabled={busy}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
      />
      <p className="settings-note">昵称可以修改或重名，不会改变你的设备身份和历史记录。</p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="settings-success">
          昵称已保存
        </p>
      )}
      <Button ripple type="submit" disabled={busy || !name.trim() || name.trim() === user.name}>
        {busy ? '正在保存…' : '保存昵称'}
      </Button>
    </form>
  );
}
function ConnectionSettings({ connection }: { connection: ChatConnection }) {
  const health = useHealth();
  const [pong, setPong] = useState('未测试');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const socket = connection.socket;
    const received = () => {
      clearTimeout(timer.current);
      setPong('连接正常，已收到响应');
    };
    socket?.on('pong', received);
    return () => {
      socket?.off('pong', received);
      clearTimeout(timer.current);
    };
  }, [connection.socket]);
  return (
    <div className="settings-diagnostics">
      <section>
        <h3>实时连接</h3>
        <p>Socket.IO：{connection.connected ? '已连接' : connection.error || '未连接'}</p>
        <Button
          ripple
          variant="outline"
          color="secondary"
          disabled={!connection.connected || pong === '等待响应…'}
          onClick={() => {
            setPong('等待响应…');
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setPong('连接测试超时，请重试'), 5000);
            connection.socket?.emit('ping');
          }}
        >
          测试实时连接
        </Button>
        <p role="status" className="settings-note">
          {pong}
        </p>
      </section>
      <section>
        <h3>本机服务</h3>
        <Button
          ripple
          variant="outline"
          color="secondary"
          disabled={health.pending}
          onClick={() => void health.ping()}
        >
          {health.pending ? '正在测试…' : '测试本机服务'}
        </Button>
        {health.error && (
          <p role="alert" className="text-red-700">
            {health.error}
          </p>
        )}
        {health.result && <pre>{JSON.stringify(health.result, null, 2)}</pre>}
      </section>
    </div>
  );
}
