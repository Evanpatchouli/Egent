import type { HealthResponse } from '@egent/shared';
import { config } from '../config';

/** Fetch the server health endpoint with cancellation and response validation. */
export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${config.apiBaseUrl}/api/health`, { signal });
  if (!response.ok) {
    throw new Error(`Health request failed: HTTP ${response.status}`);
  }
  const data: unknown = await response.json();
  if (
    typeof data !== 'object' ||
    data === null ||
    !('ok' in data) ||
    data.ok !== true ||
    !('service' in data) ||
    data.service !== 'egent-server' ||
    !('version' in data) ||
    typeof data.version !== 'string' ||
    !('timestamp' in data) ||
    typeof data.timestamp !== 'string'
  ) {
    throw new Error('The server returned an invalid health response.');
  }
  return { ok: true, service: data.service, version: data.version, timestamp: data.timestamp };
}
