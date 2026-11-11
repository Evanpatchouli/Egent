import { Button } from '@material-tailwind/react';
import { useEffect, useRef, useState } from 'react';

export function MessageCopyButton({ content }: { content: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(content);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    timer.current = setTimeout(() => setStatus('idle'), 2000);
  }

  const label = status === 'copied' ? '已复制' : status === 'failed' ? '复制失败' : '复制';
  return (
    <Button
      ripple
      variant="ghost"
      className="message-copy"
      aria-label={`${label}消息`}
      title={label === '复制' ? '复制消息' : label}
      onClick={() => void copy()}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {status === 'copied' ? (
          <path d="m5 12 4 4L19 6" />
        ) : (
          <>
            <rect x="8" y="8" width="11" height="11" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </>
        )}
      </svg>
      <span aria-live="polite">{label}</span>
    </Button>
  );
}
