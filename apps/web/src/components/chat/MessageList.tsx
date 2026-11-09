import { Button, Avatar } from '@material-tailwind/react';
import { useLayoutEffect, useRef } from 'react';
import type { MessageInfo, UserInfo } from '@egent/shared';
/** Render plain text and explicit sender identity; no HTML or Markdown interpretation. */
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
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                <p>{message.content}</p>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
