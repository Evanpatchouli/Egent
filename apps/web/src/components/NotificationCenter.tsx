import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Button, Checkbox, Dialog, Input, Textarea } from '@material-tailwind/react';
import type { NotificationInfo } from '@egent/shared';
import { request } from '../api/client';
import type { ChatConnection } from '../hooks/useChatConnection';
import type { PeerContact } from './InvitePeople';

const MarkdownContent = lazy(() => import('./NotificationMarkdown'));

function Markdown({ text }: { text: string }) {
  return (
    <Suspense fallback={<p className="notification-hint">正在加载内容…</p>}>
      <MarkdownContent text={text} />
    </Suspense>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Global inbox stays mounted across chat and settings, even when its dialog is closed. */
export function NotificationCenter({ connection }: { connection: ChatConnection }) {
  const [rows, setRows] = useState<NotificationInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'create'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<PeerContact[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [contactsLoading, setContactsLoading] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const generation = useRef(0);
  const selected = rows.find((row) => row.id === selectedId);
  const unread = rows.filter((row) => !row.read).length;
  const refresh = useCallback(async () => {
    const turn = ++generation.current;
    try {
      const result = await request<NotificationInfo[]>('/api/notifications');
      if (turn === generation.current) setRows(result);
    } catch (cause) {
      if (turn === generation.current)
        setError(cause instanceof Error ? cause.message : '通知读取失败');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const socket = connection.socket;
    socket?.on('notification:updated', refresh);
    socket?.on('connect', refresh);
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      generation.current++;
      socket?.off('notification:updated', refresh);
      socket?.off('connect', refresh);
      clearInterval(timer);
    };
  }, [connection.socket, refresh]);

  function close() {
    if (busy) return;
    setOpen(false);
    setView('list');
    setError('');
  }

  async function select(row: NotificationInfo) {
    setSelectedId(row.id);
    setError('');
    if (!row.read) {
      try {
        await request('/api/notifications/' + row.id + '/read', { method: 'POST' });
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '标记已读失败');
      }
    }
  }

  async function createView() {
    setView('create');
    setError('');
    setContactsLoading(true);
    try {
      const peers = await request<PeerContact[]>('/api/peers');
      setContacts(peers);
      setRecipients((existing) =>
        existing.filter((id) => peers.some((peer) => peer.deviceId === id)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '同事列表读取失败');
    } finally {
      setContactsLoading(false);
    }
  }

  function changed() {
    requestId.current = crypto.randomUUID();
    setError('');
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ id: string }>('/api/notifications', {
        method: 'POST',
        body: { id: requestId.current, title, content, recipientIds: recipients },
      });
      setSelectedId(result.id);
      setTitle('');
      setContent('');
      setRecipients([]);
      setPreview(false);
      requestId.current = crypto.randomUUID();
      setView('list');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发布失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        ripple
        variant="ghost"
        className="notification-trigger"
        aria-label={unread ? `通知，${unread} 条未读` : '通知'}
        title="通知"
        onClick={() => {
          setOpen(true);
          setError('');
          void refresh();
        }}
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
          <path d="M18 8a6 6 0 0 0-12 0c0 7-2.5 7.3-2.5 9h17C20.5 15.3 18 15 18 8Z" />
          <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
        </svg>
        {unread > 0 && <span className="notification-badge">{unread > 99 ? '99+' : unread}</span>}
      </Button>
      {open && (
        <Dialog
          open
          size="xl"
          onOpenChange={(next) => {
            if (!next) close();
          }}
        >
          <Dialog.Overlay>
            <Dialog.Content className="notification-dialog" aria-labelledby="notification-title">
              <header className="notification-header">
                <div className="notification-heading">
                  {view === 'create' && (
                    <Button
                      ripple
                      variant="ghost"
                      className="notification-back"
                      aria-label="返回通知列表"
                      title="返回通知列表"
                      disabled={busy}
                      onClick={() => {
                        setView('list');
                        setError('');
                      }}
                    >
                      <svg
                        width="19"
                        height="19"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m15 18-6-6 6-6" />
                        <path d="M9 12h11" />
                      </svg>
                    </Button>
                  )}
                  <div>
                    <p>EGENT · 通知中心</p>
                    <h2 id="notification-title">{view === 'list' ? '通知' : '创建通知'}</h2>
                  </div>
                </div>
                <div className="notification-header-actions">
                  {view === 'list' && (
                    <Button ripple onClick={() => void createView()}>
                      创建通知
                    </Button>
                  )}
                  <Button
                    ripple
                    variant="outline"
                    color="secondary"
                    disabled={busy}
                    onClick={close}
                  >
                    关闭
                  </Button>
                </div>
              </header>
              {error && (
                <p className="notification-error" role="alert">
                  {error}
                </p>
              )}
              {view === 'list' ? (
                <div className="notification-inbox">
                  <section className="notification-list" aria-label="通知列表">
                    <div className="notification-list-heading">
                      <span>全部通知</span>
                      <small>
                        {rows.length} 条 · {unread} 条未读
                      </small>
                    </div>
                    <div className="notification-list-scroll">
                      {rows.length === 0 && <p className="notification-list-empty">还没有通知</p>}
                      {rows.map((row) => (
                        <Button
                          key={row.id}
                          ripple
                          variant="ghost"
                          aria-pressed={row.id === selectedId}
                          onClick={() => void select(row)}
                          className={
                            'notification-item' + (row.id === selectedId ? ' is-selected' : '')
                          }
                        >
                          <span className="notification-item-top">
                            <span className="notification-item-source">
                              {row.direction === 'application'
                                ? '应用通知'
                                : row.direction === 'sent'
                                  ? '我发布的'
                                  : row.senderName || '同事'}
                            </span>
                            <time dateTime={row.createdAt}>{formatTime(row.createdAt)}</time>
                          </span>
                          <span className="notification-item-title">
                            {!row.read && <span className="notification-dot" aria-label="未读" />}
                            <strong>{row.title}</strong>
                          </span>
                          <span className="notification-item-excerpt">
                            {row.content.replace(/\s+/g, ' ').slice(0, 80)}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </section>
                  <section className="notification-detail" aria-label="通知详情">
                    {selected ? (
                      <article>
                        <div className="notification-detail-meta">
                          <span>
                            {selected.direction === 'application'
                              ? '应用通知'
                              : selected.direction === 'sent'
                                ? '我发布的通知'
                                : `${selected.senderName} 发布`}
                          </span>
                          <time dateTime={selected.createdAt}>
                            {formatTime(selected.createdAt)}
                          </time>
                        </div>
                        <h3>{selected.title}</h3>
                        {selected.direction === 'sent' && (
                          <p className="notification-delivery">
                            {selected.pendingCount
                              ? `${selected.recipientCount - selected.pendingCount}/${selected.recipientCount} 人已送达 · ${selected.pendingCount} 人等待连接`
                              : `已送达 ${selected.recipientCount} 人`}
                          </p>
                        )}
                        <Markdown text={selected.content} />
                      </article>
                    ) : (
                      <div className="notification-detail-empty">
                        <span aria-hidden="true">✳</span>
                        <strong>选择一条通知</strong>
                        <p>在这里查看来自同事和 Egent 的消息。</p>
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <div className="notification-compose">
                  <div className="notification-compose-columns">
                    <section
                      className="notification-field notification-recipients"
                      aria-label="通知对象"
                    >
                      <div className="notification-recipients-heading">
                        <label>通知对象</label>
                        <small>已选 {recipients.length} 人</small>
                      </div>
                      <p className="notification-hint">若同事离线，重连后送达</p>
                      {contactsLoading ? (
                        <p className="notification-hint">正在读取同事…</p>
                      ) : contacts.length === 0 ? (
                        <p className="notification-hint">还没有同事，请先在侧栏添加。</p>
                      ) : (
                        <div className="notification-recipient-box">
                          <div className="notification-recipient-all">
                            <Checkbox
                              id="notification-all"
                              className="egent-control"
                              aria-label="全选同事"
                              checked={recipients.length === contacts.length}
                              disabled={busy}
                              onChange={() => {
                                changed();
                                setRecipients(
                                  recipients.length === contacts.length
                                    ? []
                                    : contacts.map((peer) => peer.deviceId),
                                );
                              }}
                            >
                              <Checkbox.Indicator />
                            </Checkbox>
                            <label htmlFor="notification-all">全选同事</label>
                          </div>
                          <div className="notification-recipient-list">
                            {contacts.map((peer) => (
                              <div className="notification-recipient" key={peer.deviceId}>
                                <Checkbox
                                  id={'recipient-' + peer.deviceId}
                                  className="egent-control"
                                  aria-label={'选择 ' + peer.nickname}
                                  checked={recipients.includes(peer.deviceId)}
                                  disabled={busy}
                                  onChange={() => {
                                    changed();
                                    setRecipients((old) =>
                                      old.includes(peer.deviceId)
                                        ? old.filter((id) => id !== peer.deviceId)
                                        : [...old, peer.deviceId],
                                    );
                                  }}
                                >
                                  <Checkbox.Indicator />
                                </Checkbox>
                                <Avatar as="span" size="sm">
                                  {[...peer.nickname][0]}
                                </Avatar>
                                <label htmlFor={'recipient-' + peer.deviceId}>
                                  <strong>{peer.nickname}</strong>
                                  <small>{peer.online ? '在线' : '离线'}</small>
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                    <div className="notification-compose-main">
                      <div className="notification-field notification-title-field">
                        <label htmlFor="notification-subject">通知标题</label>
                        <Input
                          id="notification-subject"
                          aria-label="通知标题"
                          placeholder="为通知写一个清晰的标题"
                          value={title}
                          maxLength={120}
                          disabled={busy}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            changed();
                            setTitle(event.target.value);
                          }}
                        />
                      </div>
                      <div className="notification-field notification-editor-field">
                        <div className="notification-editor-heading">
                          <label htmlFor="notification-content">
                            通知详情 <span>Markdown</span>
                          </label>
                          <div>
                            <Button
                              ripple
                              variant="ghost"
                              aria-pressed={!preview}
                              onClick={() => setPreview(false)}
                            >
                              编辑
                            </Button>
                            <Button
                              ripple
                              variant="ghost"
                              aria-pressed={preview}
                              onClick={() => setPreview(true)}
                            >
                              预览
                            </Button>
                          </div>
                        </div>
                        {preview ? (
                          <div className="notification-preview">
                            {content.trim() ? (
                              <Markdown text={content} />
                            ) : (
                              <p className="notification-hint">内容预览将显示在这里。</p>
                            )}
                          </div>
                        ) : (
                          <Textarea
                            id="notification-content"
                            aria-label="通知详情，Markdown 格式"
                            placeholder="使用 Markdown 编写通知内容…"
                            value={content}
                            maxLength={32000}
                            disabled={busy}
                            rows={7}
                            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                              changed();
                              setContent(event.target.value);
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  <footer className="notification-compose-footer">
                    <span>通知会保存在接收人的设备上。</span>
                    <Button
                      ripple
                      disabled={
                        busy ||
                        contactsLoading ||
                        !recipients.length ||
                        !title.trim() ||
                        !content.trim()
                      }
                      onClick={() => void publish()}
                    >
                      {busy ? '正在发布…' : '发布通知'}
                    </Button>
                  </footer>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog>
      )}
    </>
  );
}
