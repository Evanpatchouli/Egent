import { useState } from 'react';
import { Avatar, Button, Dialog, Input } from '@material-tailwind/react';
import { request } from '../api/client';
import type { PeerContact } from './InvitePeople';

/** Save a verified contact without creating a conversation or inviting it to one. */
export function AddColleagueDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (peer: PeerContact) => void;
}) {
  const [address, setAddress] = useState('');
  const [found, setFound] = useState<PeerContact | null>(null);
  const [busy, setBusy] = useState<'probe' | 'connect' | null>(null);
  const [error, setError] = useState('');
  async function probe() {
    if (busy || !address.trim()) return;
    setBusy('probe');
    setFound(null);
    setError('');
    try {
      setFound(
        await request<PeerContact>('/api/peers/probe', {
          method: 'POST',
          body: { address: address.trim() },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法找到同事，请检查 IP 和连接状态');
    } finally {
      setBusy(null);
    }
  }
  async function add() {
    if (busy || !found) return;
    setBusy('connect');
    setError('');
    try {
      const peer = await request<PeerContact>('/api/peers/connect', {
        method: 'POST',
        body: { address: found.address, deviceId: found.deviceId },
      });
      onAdded({ ...peer, online: true });
    } catch (e) {
      setFound(null);
      setError(e instanceof Error ? e.message : '添加失败，请重新查找');
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={() => {
        if (!busy) onClose();
      }}
    >
      <Dialog.Overlay>
        <Dialog.Content className="p-6 space-y-4" aria-labelledby="add-colleague-title">
          <h2 id="add-colleague-title" className="text-xl font-semibold">
            添加同事
          </h2>
          <p className="text-sm text-gray-600">输入同事的 IP，查找并确认对方后添加到同事列表。</p>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void probe();
            }}
          >
            <Input
              aria-label="同事 IP"
              placeholder="192.168.1.20 或 IP:端口"
              value={address}
              disabled={!!busy}
              onChange={(event) => {
                setAddress(event.target.value);
                setFound(null);
                setError('');
              }}
            />
            <Button
              ripple
              type="submit"
              variant="outline"
              color="secondary"
              disabled={!!busy || !address.trim()}
            >
              {busy === 'probe' ? '正在查找…' : '查找同事'}
            </Button>
          </form>
          {found && (
            <div className="add-colleague-found">
              <Avatar as="span" size="sm">
                {[...found.nickname][0]}
              </Avatar>
              <div>
                <strong>{found.nickname}</strong>
                <small>{found.address}</small>
              </div>
            </div>
          )}
          <p role="status" className="text-sm text-gray-600">
            {busy === 'connect' ? '正在连接并添加…' : found ? '已找到同事，请核对昵称与地址。' : ''}
          </p>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button ripple disabled={!!busy || !found} onClick={() => void add()}>
              添加同事
            </Button>
            <Button ripple variant="ghost" disabled={!!busy} onClick={onClose}>
              取消
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog>
  );
}
