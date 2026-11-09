import { useEffect, useRef, useState } from 'react';
import type { HealthResponse } from '@egent/shared';
import { getHealth } from '../api/health';

/** Run an on-demand HTTP health check; cancel requests when the page unmounts. */
export function useHealth() {
  const [result, setResult] = useState<HealthResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  async function ping() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    setResult(null);
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const health = await getHealth(controller.signal);
      if (request.current === controller) setResult(health);
    } catch (cause) {
      if (request.current === controller) {
        setError(
          controller.signal.aborted
            ? 'Health request timed out.'
            : cause instanceof Error
              ? cause.message
              : 'Health request failed.',
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return { result, pending, error, ping };
}
