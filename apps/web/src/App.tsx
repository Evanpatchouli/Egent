import { useEffect, useState } from 'react';
import { Button, Dialog, Input } from '@material-tailwind/react';
import type { UserInfo } from '@egent/shared';
import { request } from './api/client';
import { ChatShell } from './components/chat/ChatShell';
/** Device identity is provided only by the local backend; the form edits a nickname. */
export function App() {
  const [local, setLocal] = useState<UserInfo | null>(null),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    void request<{ user: UserInfo | null }>('/api/device', { local: true })
      .then((result) => {
        setLocal(result.user);
        setName(result.user?.name ?? '');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function nickname() {
    try {
      const result = await request<UserInfo>('/api/device/nickname', {
        local: true,
        method: 'POST',
        body: { name },
      });
      setLocal(result);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '昵称保存失败');
    }
  }
  if (loading)
    return (
      <main className="startup-screen" role="status" aria-live="polite">
        <img className="startup-logo" src="/icon.png" alt="Egent" width="96" height="96" />
        <p className="startup-caption">Egent 启动中</p>
      </main>
    );
  return (
    <>
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
      {local && <ChatShell user={local} onUserChange={setLocal} />}
      {!local && (
        <Dialog open onOpenChange={() => {}} size="sm">
          <Dialog.Overlay>
            <Dialog.Content className="space-y-5 p-6" aria-labelledby="nickname-title">
              <h1 id="nickname-title" className="text-xl font-semibold">
                你是谁
              </h1>
              <p>设置你的昵称，设备身份由本机自动识别。</p>
              <Input
                aria-label="昵称"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
              <Button ripple disabled={!name.trim()} onClick={() => void nickname()}>
                确认
              </Button>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog>
      )}
    </>
  );
}
