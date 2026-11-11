import { config, desktopContext } from '../config';

/** HTTP error preserves the server code for identity reset and conflict handling. */
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
/** Call the local authenticated workspace; each conversation is routed by its backend authority. */
export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; local?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'X-Egent-Local-Token': desktopContext.localToken,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.any([
      AbortSignal.timeout(
        options.method === 'POST' && (path === '/api/conversations' || path.endsWith('/invite'))
          ? 120000
          : path === '/api/device/check-updates'
            ? 17000
            : 15000,
      ),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('egent:invalid-identity'));
    throw new RequestError(
      response.status,
      data.error?.code ?? 'HTTP_ERROR',
      data.error?.message ?? '请求失败',
    );
  }
  return data as T;
}
