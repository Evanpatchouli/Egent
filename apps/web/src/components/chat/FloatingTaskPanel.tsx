import { Avatar, Button } from '@material-tailwind/react';
import { useId, useRef, useState, type ReactNode } from 'react';

/** Keep task content mounted so minimizing never interrupts requests or loses details. */
export function FloatingTaskPanel({
  hostName,
  online,
  activity,
  children,
}: {
  hostName: string;
  online: boolean;
  activity?: string;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<'compact' | 'expanded' | 'minimized'>('compact');
  const id = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const minimize = useRef<HTMLButtonElement>(null);
  function hide() {
    setMode('minimized');
    requestAnimationFrame(() => launcher.current?.focus());
  }
  function restore() {
    setMode('compact');
    requestAnimationFrame(() => minimize.current?.focus());
  }
  return (
    <>
      {mode === 'minimized' && (
        <Button
          ref={launcher}
          ripple
          variant="ghost"
          className="task-panel-launcher"
          aria-label="打开 Egent 任务面板"
          aria-controls={id}
          aria-expanded={false}
          title={activity ? `Egent ${activity} · 点击打开任务面板` : '打开 Egent 任务面板'}
          onClick={restore}
        >
          <Avatar as="span" className="task-panel-logo" shape="circular">
            <img src="/icon.png" alt="Egent" />
          </Avatar>
          {activity && (
            <span className="task-panel-activity" role="status" aria-label={`Egent ${activity}`}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle
                  cx="10"
                  cy="10"
                  r="6"
                  stroke="currentColor"
                  strokeOpacity="0.25"
                  strokeWidth="2"
                />
                <path
                  className="task-panel-activity-spin"
                  d="M10 4a6 6 0 0 1 6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          )}
        </Button>
      )}
      <section
        id={id}
        className={`task-panel task-panel--${mode}`}
        hidden={mode === 'minimized'}
        aria-label="Egent 任务"
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !event.defaultPrevented &&
            event.target instanceof Node &&
            event.currentTarget.contains(event.target)
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (mode === 'expanded') setMode('compact');
            else hide();
          }
        }}
      >
        <header className="task-window-header">
          <div className="task-window-identity">
            <img src="/icon.png" alt="" width="24" height="24" />
            <div>
              <strong>Egent</strong>
              <small title={`由 ${hostName} 的设备执行`}>
                {hostName} 的设备{online ? '' : ' · 离线'}
              </small>
            </div>
          </div>
          <div className="task-window-actions">
            <Button
              ref={minimize}
              ripple
              variant="ghost"
              aria-label="最小化任务面板"
              title="最小化"
              onClick={hide}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M5 16h14" />
              </svg>
            </Button>
            <Button
              ripple
              variant="ghost"
              aria-label={mode === 'expanded' ? '收起任务面板' : '最大化任务面板'}
              title={mode === 'expanded' ? '收起' : '最大化'}
              aria-expanded={mode === 'expanded'}
              onClick={() => setMode(mode === 'expanded' ? 'compact' : 'expanded')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path
                  d={
                    mode === 'expanded'
                      ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6'
                      : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'
                  }
                />
              </svg>
            </Button>
          </div>
        </header>
        <div className="task-panel-body">{children}</div>
      </section>
    </>
  );
}
