import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { codexFailure } from './codex-errors.js';
import type { ExecutionInput } from './contracts.js';

export type SpawnAdapter = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    windowsHide: true;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => ChildProcessWithoutNullStreams;
/** Async process runner with bounded output and termination before releasing its execution slot. */
export function runProcess(
  command: string,
  args: string[],
  input: ExecutionInput,
  timeoutMs: number,
  adapter: SpawnAdapter = spawn,
  provider: 'Codex' | 'DeepSeek' | 'DSH' = 'Codex',
  environment: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) return reject(new Error(provider + ' 执行已取消'));
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (
        /^(EGENT_|DATABASE_URL|POSTGRES_|VITE_|CODEX_COMMAND|CODEX_TIMEOUT_MS|DSH_COMMAND)/i.test(
          key,
        )
      )
        delete env[key];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = adapter(command, args, {
        cwd: input.workspacePath,
        env: { ...env, ...environment },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return reject(new Error(provider + ' 执行器启动失败，请检查项目设备上的 CLI 路径'));
    }
    let stdout = '',
      stderr = '',
      bytes = 0,
      failure: Error | undefined,
      closed = false;
    const stop = (reason: string) => {
      if (failure || closed) return;
      failure = new Error(reason);
      console.error('[AgentExecutor]', {
        event: reason.includes('超时') ? 'timeout' : 'cancel/error',
        pid: child.pid,
      });
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          shell: false,
          stdio: 'ignore',
        });
        killer.once('error', () => child.kill('SIGKILL'));
        killer.once('exit', (code) => {
          if (code) child.kill('SIGKILL');
        });
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop(provider + ' 执行超时'), timeoutMs);
    const abort = () => stop(provider + ' 执行已取消');
    input.signal.addEventListener('abort', abort, { once: true });
    const collect = (chunk: Buffer, target: 'out' | 'err') => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) return stop(provider + ' 输出超过 2 MiB 限额');
      if (target === 'out') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    // StringDecoder is used by streams so multibyte Chinese never splits into replacement chars.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => collect(Buffer.from(data, 'utf8'), 'out'));
    child.stderr.on('data', (data: string) => collect(Buffer.from(data, 'utf8'), 'err'));
    child.stdin.on('error', () => stop(provider + ' stdin 写入失败'));
    child.once('error', () => {
      failure = new Error(provider + ' 执行器不存在或启动失败');
    });
    child.once('close', (code) => {
      closed = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      console.log('[AgentExecutor]', { event: 'exit', exitCode: code, outputBytes: bytes });
      if (failure) reject(failure);
      else if (code !== 0) {
        // DSH stderr includes private reasoning. Never forward it to logs or conversation members.
        const message =
          provider === 'DSH'
            ? 'DSH 调用失败（退出码 ' + code + '），请检查 headless 安装、API Key 和模型配置。'
            : codexFailure(
                stdout,
                stderr,
                code,
                provider,
                environment.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY,
              );
        console.error('[AgentExecutor] diagnostic', message);
        reject(new Error(message));
      } else resolve({ stdout, stderr, exitCode: code });
    });
    console.log('[AgentExecutor]', { event: 'start', workspacePath: input.workspacePath });
    child.stdin.end(input.prompt, 'utf8');
  });
}
