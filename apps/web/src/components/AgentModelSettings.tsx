import { Button, Input, Slider } from '@material-tailwind/react';
import { useEffect, useId, useState } from 'react';
import {
  agentEfforts,
  defaultAgentModel,
  type AgentModelSettings,
  type AgentModelProfile,
  type AgentProvider,
} from '@egent/shared';
import { request } from '../api/client';

const providers: Record<AgentProvider, string> = {
  codex: 'Codex CLI',
  deepseek: 'DeepSeek API',
  dsh: 'DSH CLI',
};
const sources = { environment: '启动默认值', global: '设备全局设置', conversation: '此会话的设置' };
const globalPath = '/api/device/agent-model';

interface DeepSeekStatus {
  baseUrl: string;
  hasSavedKey: boolean;
  hasEnvironmentKey: boolean;
}

function DeepSeekConnectionSettings() {
  const [status, setStatus] = useState<DeepSeekStatus>();
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const urlId = useId();
  const keyId = useId();
  useEffect(() => {
    let active = true;
    request<DeepSeekStatus>('/api/device/deepseek-settings')
      .then((result) => {
        if (active) {
          setStatus(result);
          setUrl(result.baseUrl);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(clear = false) {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const result = await request<DeepSeekStatus>('/api/device/deepseek-settings', {
        method: 'PUT',
        body: { baseUrl: url, apiKey: clear ? '' : key.trim() || null },
      });
      setStatus(result);
      setUrl(result.baseUrl);
      setKey('');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '连接设置保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-form">
      <label htmlFor={urlId}>API 地址</label>
      <Input
        id={urlId}
        value={url}
        disabled={busy || !status}
        placeholder="https://api.deepseek.com"
        onChange={(e) => {
          setUrl(e.target.value);
          setSaved(false);
        }}
      />
      <label htmlFor={keyId}>API Key</label>
      <Input
        id={keyId}
        type="password"
        autoComplete="off"
        value={key}
        disabled={busy || !status}
        placeholder={status?.hasSavedKey ? '已保存，留空保持不变' : '输入 API Key'}
        onChange={(e) => {
          setKey(e.target.value);
          setSaved(false);
        }}
      />
      <p className="settings-note">
        {status?.hasSavedKey
          ? '已保存本机 Key。'
          : status?.hasEnvironmentKey
            ? '当前使用启动环境中的 Key。'
            : '尚未保存 Key。'}{' '}
        Key 仅保存在本机数据目录，不会发送给同事；文件依赖 Windows 用户目录权限保护。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ripple
          variant="outline"
          disabled={busy || !status || !url.trim()}
          onClick={() => void save()}
        >
          保存 API 连接设置
        </Button>
        {status?.hasSavedKey && (
          <Button ripple variant="ghost" disabled={busy} onClick={() => void save(true)}>
            删除已保存的 Key
          </Button>
        )}
      </div>
      {saved && (
        <p role="status" className="settings-success">
          API 连接设置已保存，从下次调用生效。
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function EffortSlider({
  profile,
  disabled,
  onChange,
}: {
  profile: AgentModelProfile;
  disabled: boolean;
  onChange: (effort: string | null) => void;
}) {
  const steps: (string | null)[] = [
    ...(profile.provider === 'codex' ? [null] : []),
    ...agentEfforts[profile.provider],
  ];
  const index = steps.indexOf(profile.effort);
  const last = steps.length - 1;
  const label = useId();
  const valueText = profile.effort ?? 'CLI 默认';
  const moveTo = (position: number) => {
    if (!disabled) onChange(steps[Math.min(last, Math.max(0, Math.round(position)))] ?? null);
  };
  const positionAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget.getBoundingClientRect();
    return ((event.clientX - track.left) * last) / track.width;
  };
  return (
    <div className="effort-control">
      <div className="effort-heading">
        <span id={label}>思考强度</span>
        <span className="effort-value">{valueText}</span>
      </div>
      <Slider
        className="effort-slider"
        min={0}
        max={last}
        step={1}
        value={[index]}
        aria-disabled={disabled}
        onValueChange={(next) => moveTo((typeof next === 'function' ? next([index]) : next)[0]!)}
        onPointerDown={(event) => {
          if (
            disabled ||
            event.button !== 0 ||
            (event.target as Element).closest('[role="slider"]')
          )
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.querySelector<HTMLElement>('[role="slider"]')?.focus();
          moveTo(positionAt(event));
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(positionAt(event));
        }}
      >
        <span
          aria-hidden="true"
          className="effort-fill"
          style={{ width: (index / last) * 100 + '%' }}
        />
        <span className="effort-stops" aria-hidden="true">
          {steps.map((step, i) => (
            <i key={step ?? 'default'} className={i < index ? 'passed' : ''} />
          ))}
        </span>
        <Slider.Thumb
          type="button"
          className="effort-thumb"
          disabled={disabled}
          aria-labelledby={label}
          aria-valuetext={valueText}
          onKeyDown={(event: React.KeyboardEvent) => {
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault();
              moveTo(event.key === 'Home' ? 0 : last);
            }
          }}
        />
      </Slider>
      <div className="effort-ends" aria-hidden="true">
        <span>{steps[0] ?? 'CLI 默认'}</span>
        <span>{steps[last]}</span>
      </div>
    </div>
  );
}

export function GlobalAgentModelSettings() {
  const [settings, setSettings] = useState<AgentModelSettings>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    request<AgentModelSettings>(globalPath)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  if (!settings)
    return error ? (
      <div role="alert">
        {error}{' '}
        <Button
          ripple
          variant="outline"
          onClick={() => {
            setError('');
            setRetry((n) => n + 1);
          }}
        >
          重试
        </Button>
      </div>
    ) : (
      <p role="status">正在读取模型设置…</p>
    );
  return <AgentModelEditor settings={settings} onSaved={setSettings} />;
}

export function AgentModelEditor({
  settings,
  conversationId,
  readOnly = false,
  onSaved,
}: {
  settings: AgentModelSettings;
  conversationId?: string;
  readOnly?: boolean;
  onSaved: (value: AgentModelSettings) => void;
}) {
  const [draft, setDraft] = useState(settings.profile);
  const [edits, setEdits] = useState<NonNullable<AgentModelSettings['savedProfiles']>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const modelId = useId();
  const { profile } = settings;
  const inherited = conversationId
    ? settings.source !== 'conversation'
    : settings.source === 'environment';
  function edit(next: AgentModelProfile) {
    setDraft(next);
    setEdits((previous) => ({ ...previous, [next.provider]: next }));
    setError('');
    setSaved(false);
  }
  async function save(value: AgentModelProfile | null) {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const next = await request<AgentModelSettings>(
        conversationId ? '/api/conversations/' + conversationId + '/agent-model' : globalPath,
        { method: 'PUT', body: { profile: value } },
      );
      setDraft(next.profile);
      if (!value) setEdits({});
      else setEdits((previous) => ({ ...previous, [next.profile.provider]: next.profile }));
      setSaved(true);
      onSaved(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '模型设置保存失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-form">
      <p className="settings-note" aria-live="polite">
        当前使用{sources[settings.source]} · {providers[profile.provider]} ·{' '}
        {profile.model ?? 'CLI 默认模型'} · {profile.effort ?? 'CLI 默认强度'}
      </p>
      {readOnly ? (
        <p>只有在线的项目所属人可以修改。</p>
      ) : (
        <>
          <fieldset>
            <legend>执行器</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(providers) as AgentProvider[]).map((provider) => (
                <Button
                  ripple
                  size="sm"
                  key={provider}
                  disabled={busy}
                  aria-pressed={draft.provider === provider}
                  variant={draft.provider === provider ? 'solid' : 'outline'}
                  onClick={() => {
                    if (draft.provider !== provider)
                      edit(
                        edits[provider] ??
                          (profile.provider === provider
                            ? profile
                            : settings.savedProfiles?.[provider]) ??
                          defaultAgentModel(provider),
                      );
                  }}
                >
                  {providers[provider]}
                </Button>
              ))}
            </div>
          </fieldset>
          {draft.provider === 'dsh' && (
            <p className="settings-note">使用 DSH 需要全局安装 @deepseek-api/dsh。</p>
          )}
          {draft.provider === 'deepseek' && !conversationId && <DeepSeekConnectionSettings />}
          {draft.provider === 'deepseek' && conversationId && (
            <p className="settings-note">API 地址和 Key 由项目所属人在本机模型设置中管理。</p>
          )}
          <label htmlFor={modelId}>模型 ID</label>
          <Input
            id={modelId}
            value={draft.model ?? ''}
            maxLength={128}
            disabled={busy}
            placeholder={
              draft.provider === 'codex' ? '留空使用 Codex CLI 默认模型' : 'deepseek-flash'
            }
            onChange={(e) => edit({ ...draft, model: e.target.value || null })}
          />
          <EffortSlider
            profile={draft}
            disabled={busy}
            onChange={(effort) => edit({ ...draft, effort })}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              ripple
              disabled={busy || (draft.provider !== 'codex' && !draft.model?.trim())}
              onClick={() => void save({ ...draft, model: draft.model?.trim() || null })}
            >
              {busy ? '正在保存…' : conversationId ? '应用到此会话' : '保存全局设置'}
            </Button>
            {!inherited && (
              <Button ripple variant="outline" disabled={busy} onClick={() => void save(null)}>
                {conversationId ? '恢复跟随全局' : '恢复启动默认值'}
              </Button>
            )}
          </div>
          {saved && (
            <p role="status" className="settings-success">
              已保存，从下次模型调用生效。
            </p>
          )}
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
