import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Checkbox, Input } from '@material-tailwind/react';
import { request } from '../api/client';

export interface PeerContact {
  deviceId: string;
  nickname: string;
  address: string;
  online?: boolean;
}

/** Invite selection requires a live verified connection, including previously known contacts. */
export function InvitePeople({
  selected,
  onChange,
  excluded = [],
  disabled = false,
  onBusy,
}: {
  selected: PeerContact[];
  onChange: (peers: PeerContact[]) => void;
  excluded?: string[];
  disabled?: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [contacts, setContacts] = useState<PeerContact[]>([]);
  const [address, setAddress] = useState('');
  const [verified, setVerified] = useState<PeerContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(() => {
    void request<PeerContact[]>('/api/peers')
      .then(setContacts)
      .catch((e: Error) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, []);
  async function probe() {
    const turn = ++generation.current;
    setBusy(true);
    setVerified(null);
    setError('');
    try {
      const peer = await request<PeerContact>('/api/peers/probe', {
        method: 'POST',
        body: { address },
      });
      if (turn === generation.current) setVerified(peer);
    } catch (e) {
      if (turn === generation.current) setError(e instanceof Error ? e.message : '无法连接同事');
    } finally {
      if (turn === generation.current) setBusy(false);
    }
  }
  async function add(peer: PeerContact) {
    setBusy(true);
    setError('');
    try {
      const result = await request<PeerContact>('/api/peers/connect', {
        method: 'POST',
        body: { address: peer.address, deviceId: peer.deviceId },
      });
      if (excluded.includes(result.deviceId)) throw new Error('这位同事已经在会话中');
      onChange([...selected.filter((p) => p.deviceId !== result.deviceId), result]);
      setContacts((old) => [result, ...old.filter((p) => p.deviceId !== result.deviceId)]);
      setVerified(null);
      setAddress('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '对方可能不在线或 IP 已更改');
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || disabled;
  return (
    <div className="invite-people">
      <div className="invite-address">
        <label htmlFor="invite-ip">邀请一位新同事</label>
        <p>输入同事的 IP，找到对方后加入本次会话。</p>
        <div className="flex gap-2">
          <Input
            id="invite-ip"
            aria-label="同事 IP"
            placeholder="192.168.1.20 或 IP:端口"
            value={address}
            disabled={locked}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              generation.current++;
              setAddress(e.target.value);
              setVerified(null);
              setError('');
            }}
          />
          <Button
            ripple
            variant="outline"
            color="secondary"
            disabled={locked || !address.trim()}
            onClick={() => void probe()}
          >
            查找
          </Button>
        </div>
        {verified && (
          <div className="invite-found">
            <span>找到 {verified.nickname}</span>
            <Button
              ripple
              disabled={locked || selected.length >= 19}
              onClick={() => void add(verified)}
            >
              添加同事
            </Button>
          </div>
        )}
      </div>
      <div className="invite-list-heading">
        <h3>熟悉的同事</h3>
        <span>已选 {selected.length} 人</span>
      </div>
      <div className="invite-contact-list">
        {contacts
          .filter((p) => !excluded.includes(p.deviceId))
          .map((peer) => {
            const checked = selected.some((p) => p.deviceId === peer.deviceId);
            return (
              <div className={'invite-contact ' + (checked ? 'chosen' : '')} key={peer.deviceId}>
                <Checkbox
                  id={'invite-' + peer.deviceId}
                  className="egent-control"
                  checked={checked}
                  disabled={locked || (!checked && selected.length >= 19)}
                  aria-label={'邀请 ' + peer.nickname}
                  onChange={() =>
                    checked
                      ? onChange(selected.filter((p) => p.deviceId !== peer.deviceId))
                      : void add(peer)
                  }
                >
                  <Checkbox.Indicator />
                </Checkbox>
                <Avatar as="span" size="sm">
                  {[...peer.nickname][0]}
                </Avatar>
                <label htmlFor={'invite-' + peer.deviceId} className="contact-copy">
                  <strong>{peer.nickname}</strong>
                  <small>{peer.address}</small>
                </label>
                <small>{checked ? '已选择' : peer.online ? '在线' : '点击尝试连接'}</small>
              </div>
            );
          })}
        {contacts.filter((p) => !excluded.includes(p.deviceId)).length === 0 && (
          <p className="sidebar-empty">还没有可邀请的同事，从上方输入 IP 开始吧。</p>
        )}
      </div>
      <p role="status">{busy ? '正在确认同事是否在线…' : ''}</p>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
