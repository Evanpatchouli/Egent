import { Button, Avatar } from '@material-tailwind/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessageInfo, UserInfo } from '@egent/shared';
import { MessageCopyButton } from './MessageCopyButton';
import { MessageMarkdown } from './MessageMarkdown';
import { formatMessageTime } from './messageTime';

/** Render messages with explicit sender identity and safe Markdown. */
export function MessageList({
  messages,
  user,
  ownMessagesRight,
  hasMore,
  loadingEarlier,
  earlier,
  onBottom,
  onMention,
  mentionDisabled,
}: {
  messages: MessageInfo[];
  onMention: (name: string) => void;
  mentionDisabled: boolean;
  user: UserInfo;
  ownMessagesRight: boolean;
  hasMore: boolean;
  loadingEarlier: boolean;
  earlier: () => Promise<void>;
  onBottom: (bottom: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousLast = useRef<string | undefined>(undefined);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(now);
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime() + 10);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    if (prepend.current) {
      node.scrollTop = prepend.current.top + node.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (
      nearBottom.current ||
      (previousLast.current !== messages.at(-1)?.id && messages.at(-1)?.sender?.id === user.id)
    )
      node.scrollTop = node.scrollHeight;
    previousLast.current = messages.at(-1)?.id;
    nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
    onBottom(nearBottom.current);
  }, [messages, user.id, onBottom]);
  async function loadEarlier() {
    const node = container.current;
    if (node) prepend.current = { height: node.scrollHeight, top: node.scrollTop };
    await earlier();
    requestAnimationFrame(() => {
      prepend.current = null;
    });
  }
  return (
    <div
      className="message-scroll"
      ref={container}
      onScroll={() => {
        const node = container.current!;
        nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        onBottom(nearBottom.current);
      }}
    >
      <div className="message-column">
        {hasMore && (
          <Button
            variant="ghost"
            ripple
            className="load-earlier"
            disabled={loadingEarlier}
            onClick={() => void loadEarlier()}
          >
            {loadingEarlier ? '加载中…' : '加载更早消息'}
          </Button>
        )}
        {messages.map((message) => {
          const system = message.senderType === 'SYSTEM';
          const agent = message.senderType === 'AGENT';
          const owner = message.sender?.role === 'OWNER';
          const label = system
            ? 'Egent · 系统'
            : agent
              ? 'Egent'
              : (message.sender?.name ?? '未知用户');
          return (
            <article
              key={message.id}
              className={
                'message-row ' +
                (system ? 'system-message ' : '') +
                (ownMessagesRight && message.senderType === 'USER' && message.sender?.id === user.id
                  ? 'own-message'
                  : '')
              }
              data-message-id={message.id}
            >
              {system || agent ? (
                <Button
                  ripple
                  variant="ghost"
                  className="agent-avatar-button"
                  aria-label="点击 Egent 头像提问"
                  title="在输入框中加入 @Egent"
                  disabled={mentionDisabled}
                  onClick={() => onMention('Egent')}
                >
                  <Avatar
                    as="span"
                    size="sm"
                    shape="rounded"
                    className="avatar egent-avatar"
                    aria-hidden
                  >
                    E
                  </Avatar>
                </Button>
              ) : (
                <Button
                  ripple
                  variant="ghost"
                  className="agent-avatar-button"
                  aria-label={'提及 ' + label}
                  title={'在输入框中加入 @' + label}
                  disabled={mentionDisabled || !message.sender}
                  onClick={() => onMention(label)}
                >
                  <Avatar
                    as="div"
                    size="sm"
                    shape="rounded"
                    role="img"
                    className={
                      'avatar ' +
                      (system || agent
                        ? 'egent-avatar'
                        : owner
                          ? 'owner-avatar'
                          : 'colleague-avatar')
                    }
                    aria-label={system || agent ? 'Egent 头像' : owner ? 'Owner 头像' : '同事头像'}
                  >
                    {system || agent ? 'E' : owner ? 'O' : [...(message.sender?.name ?? '同')][0]}
                  </Avatar>
                </Button>
              )}
              <div className="message-body">
                <div className="message-meta">
                  <strong>{label}</strong>
                  {message.sender && (
                    <span>
                      {owner ? 'Owner' : '同事'}
                      {message.sender.id === user.id ? ' · 你' : ''}
                    </span>
                  )}
                  <time dateTime={message.createdAt}>
                    {formatMessageTime(message.createdAt, today)}
                  </time>
                </div>
                {message.isTaskCreation ? (
                  <div className="task-creation-content">
                    <div className="task-creation-label">
                      <svg
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
                        <rect x="5" y="4" width="14" height="17" rx="2" />
                        <path d="M9 4.5h6M9 11h6M9 15h6" />
                      </svg>
                      <span>创建了一项任务</span>
                    </div>
                    <MessageMarkdown text={message.content} />
                  </div>
                ) : (
                  <MessageMarkdown text={message.content} />
                )}
                <MessageCopyButton content={message.content} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
