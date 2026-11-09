import { Button, Menu } from '@material-tailwind/react';
import { useState } from 'react';
import type { ConversationInfo } from '@egent/shared';
/** Only conversation-bearing projects appear, including retained historical project paths. */
export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onRefresh,
  onRemove,
  refreshing,
}: {
  conversations: ConversationInfo[];
  activeId?: string;
  onSelect: (conversation: ConversationInfo) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onRemove: (conversation: ConversationInfo) => void;
  refreshing: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = new Map<string, ConversationInfo[]>();
  for (const item of conversations) {
    const key = (item.hostId ?? '') + ':' + item.projectPath;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <>
      <Button ripple className="new-chat" onClick={onCreate}>
        <span aria-hidden>＋</span> 新聊天
      </Button>
      <div className="sidebar-project-heading">
        <h2 className="sidebar-label">项目</h2>
        <Button
          ripple
          variant="ghost"
          className="sidebar-refresh"
          aria-label="刷新会话"
          aria-busy={refreshing}
          title={refreshing ? '正在刷新会话…' : '刷新会话'}
          disabled={refreshing}
          onClick={onRefresh}
        >
          <svg
            className={refreshing ? 'is-refreshing' : ''}
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
            <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />
          </svg>
        </Button>
      </div>
      {groups.size === 0 && <p className="sidebar-empty">还没有会话。选择项目，开始第一条聊天。</p>}
      <nav aria-label="会话历史">
        {[...groups].map(([path, rows]) => (
          <section className="project-group" key={path}>
            <Button
              variant="ghost"
              ripple
              className="project-toggle"
              title={rows[0]!.projectPath}
              aria-expanded={!collapsed.has(path)}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(path)) next.delete(path);
                  else next.add(path);
                  return next;
                })
              }
            >
              <span aria-hidden>{collapsed.has(path) ? '▸' : '▾'}</span>
              <span>{rows[0]!.projectName}</span>
              <small className="project-owner-label">{rows[0]!.hostName}</small>
            </Button>
            {collapsed.has(path) && rows.some((item) => item.mentionAlert) && (
              <p className="collapsed-mention conversation-mention">
                {rows.find((item) => item.mentionAlert)?.mentionAlert?.senderName} @ 了你
              </p>
            )}
            {!collapsed.has(path) &&
              rows.map((item) => (
                <ConversationMenu
                  key={item.id}
                  item={item}
                  active={item.id === activeId}
                  onSelect={() => onSelect(item)}
                  onRemove={() => onRemove(item)}
                />
              ))}
          </section>
        ))}
      </nav>
    </>
  );
}

function ConversationMenu({
  item,
  active,
  onSelect,
  onRemove,
}: {
  item: ConversationInfo;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      placement="bottom-start"
    >
      <div
        onClickCapture={onSelect}
        onContextMenuCapture={(event: React.MouseEvent) => {
          event.preventDefault();
          setOpen(true);
        }}
        onKeyDownCapture={(event: React.KeyboardEvent) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <Menu.Trigger
          as={Button}
          variant="ghost"
          ripple
          className={'conversation-link ' + (active ? 'selected' : '')}
          aria-current={active ? 'page' : undefined}
          title={item.title}
        >
          <span className="conversation-copy">
            <span className="conversation-title">{item.title}</span>
            {item.mentionAlert && (
              <span
                className="conversation-mention"
                title={`${item.mentionAlert.senderName} @ 了你`}
              >
                {item.mentionAlert.senderName} @ 了你
              </span>
            )}
          </span>
          {item.unreadCount > 0 && (
            <span className="unread" aria-label={item.unreadCount + ' 条未读'}>
              {item.unreadCount > 99 ? '99+' : item.unreadCount}
            </span>
          )}
        </Menu.Trigger>
      </div>
      <Menu.Content aria-label={item.title + '的操作'}>
        <Menu.Item ripple onClick={onRemove}>
          从本机历史移除
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}
