import { useRef, useState } from 'react';
import { Button, Dialog, Menu } from '@material-tailwind/react';
import type { UpdateCheckResult } from '@egent/shared';
import { version } from '../../../desktop/package.json';
import { request } from '../api/client';

const releasePage = 'https://github.com/Evanpatchouli/Egent/releases/latest';
type UpdateProgress = { percent: number; retry?: { attempt: number; limit: number } };
declare global {
  interface Window {
    egentUpdates?: {
      install(version: string): Promise<{ ok: true } | { ok: false; message: string }>;
      cancel(): void;
      onProgress(callback: (progress: UpdateProgress) => void): () => void;
    };
  }
}
type Update =
  | { status: 'checking' | 'empty' | 'current' }
  | { status: 'available'; version: string }
  | ({ status: 'installing' } & UpdateProgress)
  | { status: 'error'; message: string };

export function TitleBarMenu() {
  const [panel, setPanel] = useState<'about' | 'update' | null>(null);
  const [update, setUpdate] = useState<Update>({ status: 'checking' });
  const pending = useRef<AbortController | null>(null);

  function close() {
    if (update.status === 'installing') return;
    pending.current?.abort();
    pending.current = null;
    setPanel(null);
  }

  async function install() {
    const updater = window.egentUpdates;
    if (!updater || update.status !== 'available') return;
    setUpdate({ status: 'installing', percent: 0 });
    const unsubscribe = updater.onProgress((progress) =>
      setUpdate({ status: 'installing', ...progress }),
    );
    try {
      const result = await updater.install(update.version);
      if (!result.ok) setUpdate({ status: 'error', message: result.message });
    } catch {
      setUpdate({ status: 'error', message: '无法启动更新，请重试。' });
    } finally {
      unsubscribe();
    }
  }

  async function check() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setPanel('update');
    setUpdate({ status: 'checking' });
    try {
      const result = await request<UpdateCheckResult>('/api/device/check-updates', {
        method: 'POST',
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setUpdate(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        setUpdate({
          status: 'error',
          message:
            error instanceof TypeError
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
            ) : update.status === 'installing' ? (
              <div className="update-progress">
                <div className="update-progress__heading">
                  <div className="update-progress__icon" aria-hidden="true">
                    <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M10 3v9m-3.25-3L10 12.25 13.25 9M4 14.25v2h12v-2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <div className="update-progress__copy" role="status">
                    <p className="update-progress__title">
                      {update.retry
                        ? '正在重新连接'
                        : update.percent === 100
                          ? '正在校验更新'
                          : '正在下载更新'}
                    </p>
                    <p className="update-progress__detail">
                      {update.retry
                        ? `连接暂不可用，正在重试（${update.retry.attempt}/${update.retry.limit}）`
                        : update.percent === 100
                          ? '完成后将自动重启'
                          : '下载完成后将自动校验并重启'}
                    </p>
                  </div>
                  <p className="update-progress__percent" aria-hidden="true">
                    {update.percent}
                    <span>%</span>
                  </p>
                </div>
                <div
                  className="update-progress__track"
                  role="progressbar"
                  aria-label="更新下载进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={update.percent}
                >
                  <div className="update-progress__fill" style={{ width: `${update.percent}%` }} />
                </div>
              </div>
            ) : (
              <p role="status">
                {update.status === 'checking' && '正在检查更新…'}
                {update.status === 'empty' && '暂未找到公开发行版。'}
                {update.status === 'current' && '当前已是最新版本。'}
                {update.status === 'available' && '发现新版本 v' + update.version}
                {update.status === 'available' && window.egentUpdates && '，更新完成后会自动重启。'}
                {update.status === 'error' && update.message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {panel === 'update' && update.status === 'available' && window.egentUpdates && (
                <Button ripple onClick={() => void install()}>
                  立即更新
                </Button>
              )}
              {panel === 'update' &&
                ((update.status === 'available' && !window.egentUpdates) ||
                  update.status === 'error') && (
                  <Button as="a" href={releasePage} target="_blank" rel="noreferrer" ripple>
                    查看发行版
                  </Button>
                )}
              {panel === 'update' && update.status === 'error' && (
                <Button ripple onClick={() => void check()}>
                  重试
                </Button>
              )}
              <Button
                ripple
                variant="ghost"
                disabled={
                  panel === 'update' && update.status === 'installing' && update.percent === 100
                }
                onClick={
                  panel === 'update' && update.status === 'installing'
                    ? () => window.egentUpdates?.cancel()
                    : close
                }
              >
                {panel === 'update' && update.status === 'installing' ? '取消更新' : '关闭'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog>
    </>
  );
}
