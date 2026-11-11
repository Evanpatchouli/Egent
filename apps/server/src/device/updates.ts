import valid from 'semver/functions/valid.js';
import gt from 'semver/functions/gt.js';
import prerelease from 'semver/functions/prerelease.js';
import { EGENT_VERSION, type UpdateCheckResult } from '@egent/shared';
import { recordUpdate } from './notifications.js';

const releaseUrl = 'https://api.github.com/repos/Evanpatchouli/Egent/releases/latest';
const interval = 5 * 60 * 1000;

/** One backend-owned checker continues while the renderer is hidden. */
export class UpdateChecker {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<UpdateCheckResult>;
  private controller = new AbortController();
  constructor(
    private get: typeof fetch = fetch,
    private current = EGENT_VERSION,
  ) {}

  start() {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), interval);
  }

  async stop() {
    clearInterval(this.timer);
    this.controller.abort();
    await this.active;
  }

  check(): Promise<UpdateCheckResult> {
    if (this.active) return this.active;
    this.active = this.run().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }

  private async run(): Promise<UpdateCheckResult> {
    const timeout = AbortSignal.timeout(15000);
    try {
      const response = await this.get(releaseUrl, {
        signal: AbortSignal.any([this.controller.signal, timeout]),
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Egent' },
        redirect: 'error',
      });
      if (response.status === 404) return { status: 'empty' };
      if (!response.ok) throw new Error('GitHub 返回 HTTP ' + response.status + '，请稍后重试。');
      const release = (await response.json()) as {
        tag_name?: unknown;
        draft?: unknown;
        prerelease?: unknown;
      };
      const latest = typeof release.tag_name === 'string' ? valid(release.tag_name) : null;
      if (!latest) throw new Error('发行版标签缺少有效版本号。');
      if (release.draft || release.prerelease || prerelease(latest) || !gt(latest, this.current))
        return { status: 'current' };
      if (this.controller.signal.aborted) return { status: 'error', message: '检查已取消。' };
      await recordUpdate(latest);
      return { status: 'available', version: latest };
    } catch (error) {
      return {
        status: 'error',
        message: timeout.aborted
          ? '连接 GitHub 超时，请重试。'
          : error instanceof TypeError
            ? '无法连接 GitHub，请检查网络后重试。'
            : error instanceof Error
              ? error.message
              : '检查更新失败，请重试。',
      };
    }
  }
}
