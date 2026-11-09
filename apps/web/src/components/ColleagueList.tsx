import { useEffect, useState } from 'react';
import { Avatar, Button, Dialog, Input, Menu } from '@material-tailwind/react';
import { request } from '../api/client';
import type { PeerContact } from './InvitePeople';
import { AddColleagueDialog } from './AddColleagueDialog';

/** Persisted colleagues expose connectivity and a pinned-identity address repair action. */
export function ColleagueList() {
  const [peers, setPeers] = useState<PeerContact[]>([]);
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<PeerContact | null>(null);
  const [address, setAddress] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () =>
      void request<PeerContact[]>('/api/peers')
        .then((rows) => {
          if (live) setPeers(rows);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [revision]);
  async function act(connect: boolean) {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/peers/' + (connect ? 'connect' : 'probe'), {
        method: 'POST',
        body: { address, deviceId: editing.deviceId },
      });
      if (connect) setEditing(null);
      else setVerified(true);
    } catch (e) {
      setVerified(false);
      setError(e instanceof Error ? e.message : '对方可能不在线或 IP 已更改');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="colleague-section" aria-label="同事列表">
      <div className="colleague-heading">
        <h2 className="sidebar-label">同事</h2>
        <span
          className="colleague-count"
          aria-label={`${peers.filter((peer) => peer.online).length} 位在线，共 ${peers.length} 位同事`}
          title="在线 / 全部同事（连接可用）"
        >
          {peers.filter((peer) => peer.online).length}/{peers.length}
        </span>
        <Button
          ripple
          variant="ghost"
          className="colleague-add"
          aria-label="添加同事"
          title="添加同事"
          onClick={() => setAdding(true)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Button>
      </div>
      {!peers.length && <p className="sidebar-empty">点击右上角 +，添加一位同事。</p>}
      {adding && (
        <AddColleagueDialog
          onClose={() => setAdding(false)}
          onAdded={(peer) => {
            setPeers((rows) => [peer, ...rows.filter((row) => row.deviceId !== peer.deviceId)]);
            setRevision((value) => value + 1);
            setAdding(false);
          }}
        />
      )}
      {peers.map((peer) => (
        <ColleagueMenu
          key={peer.deviceId}
          peer={peer}
          onReconnect={() => {
            setEditing(peer);
            setAddress(peer.address);
            setVerified(false);
            setError('');
          }}
        />
      ))}
      {editing && (
        <Dialog
          open
          onOpenChange={() => {
            if (!busy) setEditing(null);
          }}
          size="sm"
        >
          <Dialog.Overlay>
            <Dialog.Content className="p-6 space-y-4" aria-labelledby="reconnect-title">
              <h2 id="reconnect-title" className="text-xl font-semibold">
                重新连接 {editing.nickname}
              </h2>
              <p>对方可能不在线或 IP 已更改。更新地址后，我们会核对是否仍是这位同事。</p>
              <Input
                aria-label="同事的新 IP"
                disabled={busy}
                value={address}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setAddress(e.target.value);
                  setVerified(false);
                  setError('');
                }}
              />
              <p role="status">
                {busy ? '正在连接…' : verified ? '已找到原来的同事，可以重新连接。' : ''}
              </p>
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  ripple
                  variant="outline"
                  color="secondary"
                  disabled={busy || !address.trim()}
                  onClick={() => void act(false)}
                >
                  检测连通性
                </Button>
                <Button ripple disabled={busy || !verified} onClick={() => void act(true)}>
                  连接
                </Button>
                <Button ripple variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                  取消
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog>
      )}
    </section>
  );
}

/** Material Tailwind manages keyboard focus, dismissal and portal placement for the context menu. */
function ColleagueMenu({ peer, onReconnect }: { peer: PeerContact; onReconnect: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu open={open} onOpenChange={setOpen} placement="bottom-start">
      <Menu.Trigger
        as={Button}
        ripple
        variant="ghost"
        className="colleague-row"
        onContextMenu={(e: React.MouseEvent) => {
          e.preventDefault();
          setOpen(true);
        }}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar as="span" size="xs">
          {[...peer.nickname][0]}
        </Avatar>
        <span>{peer.nickname}</span>
        <small className={peer.online ? 'peer-online' : ''}>{peer.online ? '在线' : '离线'}</small>
      </Menu.Trigger>
      <Menu.Content aria-label={peer.nickname + '的操作'}>
        <Menu.Item ripple onClick={onReconnect}>
          重新连接
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}
