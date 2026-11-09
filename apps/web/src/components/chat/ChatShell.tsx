import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Avatar, Dialog } from '@material-tailwind/react';
import type { ConversationInfo, UserInfo } from '@egent/shared';
import { request } from '../../api/client';
import { useChatConnection } from '../../hooks/useChatConnection';
import { useOutbox } from '../../hooks/useOutbox';
import { SettingsPage } from '../SettingsPage';
import { ConversationSidebar } from './ConversationSidebar';
import { ConnectDialog } from '../ConnectDialog';
import { ColleagueList } from '../ColleagueList';
import { ConversationView } from './ConversationView';

/** Simplified chat workspace around the existing P2 identity and project settings. */
export function ChatShell({
  user,
  onUserChange,
}: {
  user: UserInfo;
  onUserChange: (user: UserInfo) => void;
}) {
  const connection = useChatConnection(user);
  const outbox = useOutbox(connection);
  const [conversations, setConversations] = useState<ConversationInfo[]>([]);
  const [active, setActive] = useState<ConversationInfo | null>(null);
  const [picker, setPicker] = useState(false);
  const [invite, setInvite] = useState<ConversationInfo | null>(null);
  const [removing, setRemoving] = useState<ConversationInfo | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [settings, setSettings] = useState(false);
  const [ownMessagesRight, setOwnMessagesRight] = useState(
    () => localStorage.getItem('egent.ownMessagesRight') !== 'false',
  );
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const rows = await request<ConversationInfo[]>('/api/conversations');
      if (current !== version.current) return;
      setConversations(rows);
      setError('');
      setActive((selected) =>
        selected ? (rows.find((row) => row.id === selected.id) ?? selected) : null,
      );
    } catch (cause) {
      if (current === version.current)
        setError(cause instanceof Error ? cause.message : '会话读取失败');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 3000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const notify = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 80);
    };
    const socket = connection.socket;
    socket?.on('conversation:updated', notify);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(poll);
      version.current++;
      if (timer) clearTimeout(timer);
      socket?.off('conversation:updated', notify);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, connection.socket, connection.connected]);
  async function manualRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Show at least one full spin even when the local request finishes immediately.
      await Promise.all([refresh(), new Promise<void>((resolve) => setTimeout(resolve, 900))]);
    } finally {
      setRefreshing(false);
    }
  }
  function choose(item: ConversationInfo) {
    setActive(item);
    setSidebar(false);
  }
  async function removeHistory() {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError('');
    try {
      await request('/api/device/conversations/' + removing.id + '/hide', { method: 'POST' });
      version.current++;
      setConversations((rows) => rows.filter((row) => row.id !== removing.id));
      setActive((selected) => (selected?.id === removing.id ? null : selected));
      setRemoving(null);
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : '移除失败');
    } finally {
      setRemoveBusy(false);
    }
  }
  return (
    <div className="chat-app">
      <header className="app-header">
        <div>
          <Button
            variant="ghost"
            ripple
            className="mobile-menu"
            aria-label="切换侧栏"
            onClick={() => setSidebar(!sidebar)}
          >
            ☰
          </Button>
          <span className="wordmark">
            Egent<span className="wordmark-dot">.</span>
            <small style={{ fontSize: 12, marginLeft: 12 }}>{'协作空间'}</small>
          </span>
        </div>
        <div className="identity-label">
          <Avatar
            as="span"
            size="sm"
            shape="rounded"
            className={
              'identity-mark ' + (user.role === 'OWNER' ? 'owner-avatar' : 'colleague-avatar')
            }
          >
            {user.role === 'OWNER' ? 'O' : [...user.name][0]}
          </Avatar>
          <span>
            {user.name}
            <small>{user.role === 'OWNER' ? 'Owner' : '同事'}</small>
          </span>
        </div>
      </header>
      <div className="chat-layout" hidden={settings}>
        <aside className={'chat-sidebar ' + (sidebar ? 'sidebar-open' : '')}>
          <div className="sidebar-content">
            <ConversationSidebar
              conversations={conversations}
              activeId={active?.id}
              onSelect={choose}
              onCreate={() => setPicker(true)}
              onRefresh={() => void manualRefresh()}
              onRemove={(item) => {
                setRemoveError('');
                setRemoving(item);
              }}
              refreshing={refreshing}
            />
            <ColleagueList />
          </div>
          <div className="sidebar-footer">
            <Button
              variant="ghost"
              ripple
              onClick={() => {
                setSettings(true);
                setSidebar(false);
              }}
            >
              设置
            </Button>
          </div>
        </aside>
        <main className="chat-main">
          {error && (
            <div role="alert" className="chat-error">
              {error}{' '}
              <Button variant="ghost" ripple onClick={() => void refresh()}>
                重试
              </Button>
            </div>
          )}
          {active ? (
            <ConversationView
              key={active.id}
              isVisible={!settings}
              conversation={active}
              user={user}
              ownMessagesRight={ownMessagesRight}
              connection={connection}
              outbox={outbox}
              onInvite={() => setInvite(active)}
              onModelSaved={refresh}
            />
          ) : (
            <div className="chat-welcome">
              <span className="welcome-emblem">E</span>
              <p className="eyebrow">你的项目工作空间</p>
              <h1>有什么需要一起处理？</h1>
              <p>
                选一个项目，写下需求或问题。
                <br />
                会话会保留在这里，方便继续讨论。
              </p>
              <Button ripple onClick={() => setPicker(true)}>
                新聊天
              </Button>
              <small>与同事、Owner 实时交流</small>
            </div>
          )}
        </main>
      </div>
      {settings && (
        <SettingsPage
          user={user}
          ownMessagesRight={ownMessagesRight}
          onOwnMessagesRightChange={(value) => {
            localStorage.setItem('egent.ownMessagesRight', String(value));
            setOwnMessagesRight(value);
          }}
          connection={connection}
          onUserChange={onUserChange}
          onBack={() => {
            setSettings(false);
            void refresh();
          }}
        />
      )}
      {picker && (
        <ConnectDialog
          onClose={() => setPicker(false)}
          onCreated={(item) => {
            setPicker(false);
            choose(item);
            void refresh();
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          size="sm"
          onOpenChange={() => {
            if (!removeBusy) setRemoving(null);
          }}
        >
          <Dialog.Overlay>
            <Dialog.Content className="p-6 space-y-4" aria-labelledby="remove-history-title">
              <h2 id="remove-history-title" className="text-xl font-semibold">
                从本机历史移除
              </h2>
              <p>
                将“{removing.title}
                ”从本机会话列表移除。会话和消息仍保留在项目设备，其他成员不受影响；目前没有恢复入口。
              </p>
              {removeError && (
                <p role="alert" className="text-red-700">
                  {removeError}
                </p>
              )}
              <div className="flex gap-2">
                <Button ripple disabled={removeBusy} onClick={() => void removeHistory()}>
                  {removeBusy ? '正在移除…' : '移除'}
                </Button>
                <Button
                  ripple
                  variant="ghost"
                  disabled={removeBusy}
                  onClick={() => setRemoving(null)}
                >
                  取消
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog>
      )}
      {invite && (
        <ConnectDialog
          conversation={invite}
          onClose={() => setInvite(null)}
          onCreated={(item) => {
            setInvite(null);
            choose(item);
            void refresh();
          }}
        />
      )}
    </div>
  );
}
