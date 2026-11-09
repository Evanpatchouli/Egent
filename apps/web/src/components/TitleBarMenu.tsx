import { useRef, useState } from 'react';
import { Button, Dialog, Menu } from '@material-tailwind/react';
import valid from 'semver/functions/valid';
import gt from 'semver/functions/gt';
import { version } from '../../../desktop/package.json';

const releasePage = 'https://github.com/Evanpatchouli/Egent/releases/latest';
type Update =
  | { status: 'checking' | 'empty' | 'current' }
  | { status: 'available'; version: string }
  | { status: 'error'; message: string };

export function TitleBarMenu() {
  const [panel, setPanel] = useState<'about' | 'update' | null>(null);
  const [update, setUpdate] = useState<Update>({ status: 'checking' });
  const pending = useRef<AbortController | null>(null);

  function close() {
    pending.current?.abort();
    pending.current = null;
    setPanel(null);
  }

  async function check() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const timeout = AbortSignal.timeout(15000);
    setPanel('update');
    setUpdate({ status: 'checking' });
    try {
      const response = await fetch(
        'https://api.github.com/repos/Evanpatchouli/Egent/releases/latest',
        {
          signal: AbortSignal.any([controller.signal, timeout]),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
        },
      );
      if (response.status === 404) {
        setUpdate({ status: 'empty' });
        return;
      }
      if (!response.ok) throw new Error('GitHub 返回 HTTP ' + response.status + '，请稍后重试。');
      const release = await response.json();
      const latest = valid(release?.tag_name);
      if (!latest) throw new Error('发行版标签缺少有效版本号。');
      if (!controller.signal.aborted) {
        setUpdate(
          gt(latest, version) ? { status: 'available', version: latest } : { status: 'current' },
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setUpdate({
          status: 'error',
          message: timeout.aborted
            ? '连接 GitHub 超时，请重试。'
            : error instanceof TypeError
              ? '无法连接 GitHub，请检查网络后重试。'
              : error instanceof Error
                ? error.message
                : '检查更新失败，请重试。',
        });
      }
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }

  return (
    <>
      <Menu placement="bottom-start">
        <Menu.Trigger
          as={Button}
          ripple
          variant="ghost"
          className="titlebar-more"
          aria-label="更多"
          title="更多"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="9" r="1.5" />
            <circle cx="9" cy="9" r="1.5" />
            <circle cx="15" cy="9" r="1.5" />
          </svg>
        </Menu.Trigger>
        <Menu.Content aria-label="更多">
          <Menu.Item ripple onClick={() => void check()}>
            检查更新
          </Menu.Item>
          <Menu.Item ripple onClick={() => setPanel('about')}>
            关于
          </Menu.Item>
        </Menu.Content>
      </Menu>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        size="sm"
      >
        <Dialog.Overlay>
          <Dialog.Content className="space-y-5 p-6" aria-labelledby="desktop-info-title">
            <div className="flex items-center gap-3">
              <img src="/icon.png" alt="" width="44" height="44" />
              <div>
                <h2 id="desktop-info-title" className="text-lg font-semibold">
                  {panel === 'about' ? '关于 Egent' : '检查更新'}
                </h2>
                <p className="text-sm text-gray-600">当前版本 v{version}</p>
              </div>
            </div>
            {panel === 'about' ? (
              <p>在本机或同事开放的项目中聊天，与 Egent 一起完成开发任务。</p>
            ) : (
              <p role="status">
                {update.status === 'checking' && '正在检查更新…'}
                {update.status === 'empty' && '暂未找到公开发行版。'}
                {update.status === 'current' && '当前已是最新版本。'}
                {update.status === 'available' && '发现新版本 v' + update.version}
                {update.status === 'error' && update.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {panel === 'update' && update.status === 'available' && (
                <Button as="a" href={releasePage} target="_blank" rel="noreferrer" ripple>
                  查看发行版
                </Button>
              )}
              {panel === 'update' && update.status === 'error' && (
                <Button ripple onClick={() => void check()}>
                  重试
                </Button>
              )}
              <Button ripple variant="ghost" onClick={close}>
                关闭
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog>
    </>
  );
}
