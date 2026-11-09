import { Button, Dialog } from '@material-tailwind/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationInfo, UserInfo } from '@egent/shared';
import { request } from '../../api/client';
import { useConversationMessages } from '../../hooks/useConversationMessages';
import type { ChatConnection } from '../../hooks/useChatConnection';
import type { useOutbox } from '../../hooks/useOutbox';
import { MessageList } from './MessageList';
import { Composer, type ComposerHandle } from './Composer';
import { AgentStatus } from './AgentStatus';
import { AgentModelEditor } from '../AgentModelSettings';

/** Active conversation owns history/read lifecycle, while the parent keeps pending sends. */
export function ConversationView({
  conversation,
  user,
  ownMessagesRight,
  connection,
  outbox,
  onInvite,
  onModelSaved,
  isVisible = true,
}: {
  conversation: ConversationInfo;
  user: UserInfo;
  ownMessagesRight: boolean;
  connection: ChatConnection;
  onInvite: () => void;
  onModelSaved: () => void;
  isVisible?: boolean;
  outbox: ReturnType<typeof useOutbox>;
}) {
  const available = connection.connected && conversation.online !== false;
  const profile = conversation.agentModelSettings?.profile;
  const modelLabel = profile
    ? (profile.model ?? 'Codex 默认模型') + ' ' + (profile.effort ?? '默认强度')
    : '会话模型';
  const [modelDialog, setModelDialog] = useState<string | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const history = useConversationMessages(conversation.id, user, connection);
  const [bottom, setBottom] = useState(true);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [readError, setReadError] = useState('');
  const marked = useRef('');
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (outbox.delivered?.conversationId === conversation.id) history.add([outbox.delivered]);
  }, [outbox.delivered, conversation.id, history.add]);
  const last = history.messages.at(-1)?.id;
  useEffect(() => {
    if (!last || !bottom || !visible || !isVisible || history.loading || marked.current === last)
      return;
    let active = true;
    const timer = setTimeout(() => {
      void request('/api/conversations/' + conversation.id + '/read', {
        method: 'POST',
        body: { messageId: last },
      })
        .then(() => {
          if (active) {
            marked.current = last;
            setReadError('');
          }
        })
        .catch(() => {
          if (active) setReadError('已读状态未保存，重新打开会话可重试');
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [last, bottom, visible, isVisible, history.loading, conversation.id]);
  const onTyping = useCallback(
    (active: boolean) => {
      if (connection.socket?.connected)
        connection.socket.emit(active ? 'typing:start' : 'typing:stop', {
          conversationId: conversation.id,
        });
    },
    [connection.socket, conversation.id],
  );
  return (
    <section className="conversation-view" aria-label="聊天区">
      <header className="conversation-header">
        <div>
          <h1>{conversation.title}</h1>
          <p title={conversation.projectPath}>
            {conversation.hostName} · {conversation.projectName} ·{' '}
            {conversation.members?.length ?? 1} 人
          </p>
          <small>{conversation.members?.map((m) => m.name).join('、')}</small>
        </div>
        <span className={'connection-status ' + (available ? 'online' : '')}>
          {available ? '已连接' : '项目所属人离线 · 本地历史'}
        </span>
        <Button
          ripple
          variant="ghost"
          size="sm"
          className="min-w-0 max-w-[45%]"
          disabled={!conversation.agentModelSettings}
          title={
            conversation.agentModelSettings
              ? modelLabel + ' · 查看会话模型设置'
              : '项目设备尚未提供模型设置'
          }
          onClick={() => setModelDialog(conversation.id)}
        >
          <span className="truncate">{modelLabel}</span>
        </Button>
        <Button
          ripple
          variant="ghost"
          color="secondary"
          className="conversation-invite"
          aria-label="邀请同事"
          title="邀请同事"
          disabled={!available}
          onClick={onInvite}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="7" r="4" />
            <path d="M2 21v-2a7 7 0 0 1 14 0v2M19 8v6m-3-3h6" />
          </svg>
        </Button>
      </header>
      {modelDialog === conversation.id && conversation.agentModelSettings && (
        <Dialog open size="md" onOpenChange={() => setModelDialog(null)}>
          <Dialog.Overlay>
            <Dialog.Content className="p-6 space-y-4" aria-labelledby="conversation-model-title">
              <h2 id="conversation-model-title" className="text-xl font-semibold">
                会话模型
              </h2>
              <AgentModelEditor
                settings={conversation.agentModelSettings}
                conversationId={conversation.id}
                readOnly={!available || !conversation.canConfigureAgent}
                onSaved={() => {
                  setModelDialog(null);
                  onModelSaved();
                }}
              />
              <Button ripple variant="ghost" onClick={() => setModelDialog(null)}>
                关闭
              </Button>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog>
      )}
      <div className="conversation-stage">
        {conversation.historyAfter && <p className="sync-status">你只能查看加入后的记录。</p>}
        <AgentStatus
          conversationId={conversation.id}
          connection={connection}
          hostName={conversation.hostName ?? '项目所属人'}
          online={available}
          canConfigureAgent={conversation.canConfigureAgent}
          autoAgentEnabled={conversation.autoAgentEnabled}
          autoAgentError={conversation.autoAgentError}
        />
        {history.error && (
          <div className="chat-error" role="alert">
            {history.error}{' '}
            <Button variant="ghost" ripple onClick={history.retry}>
              重试加载
            </Button>
          </div>
        )}
        {history.loading && (
          <p className="sync-status" role="status">
            同步消息中…
          </p>
        )}
        <MessageList
          onMention={(name) => composer.current?.mention(name)}
          mentionDisabled={!available || history.loading || !!history.error}
          messages={history.messages}
          user={user}
          ownMessagesRight={ownMessagesRight}
          hasMore={history.hasMore}
          loadingEarlier={history.loadingEarlier}
          earlier={history.earlier}
          onBottom={setBottom}
        />
        <div className="outbox">
          {outbox.items
            .filter((item) => item.conversationId === conversation.id)
            .map((item) => (
              <div
                key={item.clientMessageId}
                className={'pending-message' + (ownMessagesRight ? ' pending-message-right' : '')}
              >
                <p>{item.content}</p>
                <span>{item.status === 'sending' ? '发送中…' : item.error}</span>
                {item.status === 'failed' && (
                  <Button
                    variant="ghost"
                    ripple
                    disabled={!available}
                    onClick={() => outbox.retry(item)}
                  >
                    重试发送
                  </Button>
                )}
              </div>
            ))}
        </div>
        <div className="typing-status" role="status">
          {history.typing.length > 0
            ? history.typing.join('、') + ' 正在输入…'
            : readError || (!bottom ? '正在阅读历史消息' : '')}
        </div>
      </div>
      <Composer
        members={conversation.members ?? []}
        mentionRef={composer}
        disabled={!available || history.loading || !!history.error}
        onSend={(text) => outbox.send(conversation.id, text)}
        onTyping={onTyping}
      />
    </section>
  );
}
