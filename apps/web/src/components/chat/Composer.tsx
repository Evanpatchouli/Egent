import { Button, Menu, Textarea } from '@material-tailwind/react';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { activeMention, hasEgentMention, mentionPosition, removeEgentMentions } from './mentions';

export interface ComposerHandle {
  mention: (name: string) => void;
}
/** Mentions remain plain text; choosing one never submits or discards a draft. */
export function Composer({
  disabled,
  members,
  onSend,
  onTyping,
  mentionRef,
}: {
  disabled: boolean;
  members: { deviceId: string; name: string }[];
  mentionRef?: React.Ref<ComposerHandle>;
  onSend: (content: string) => void;
  onTyping: (active: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [menuElementId, setMenuElementId] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const setMenu = useCallback((node: HTMLDivElement | null) => {
    menu.current = node;
    setMenuElementId(node?.id);
  }, []);
  const composing = useRef(false);
  const lastTyping = useRef(0);
  const menuId = useId();
  const active = activeMention(text, selection.start, selection.end);
  const options = [{ deviceId: 'agent', name: 'Egent' }, ...members].filter((member) =>
    member.name.toLocaleLowerCase().includes(active?.query.toLocaleLowerCase() ?? ''),
  );
  const open = !!active && !disabled && !dismissed;
  const activeIndex = Math.min(selected, Math.max(0, options.length - 1));
  const egent = hasEgentMention(text);
  const focus = useCallback((caret: number) => {
    setSelection({ start: caret, end: caret });
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  }, []);
  const mention = useCallback(
    (name: string) => {
      if (disabled) return;
      if (name === 'Egent' && hasEgentMention(text)) {
        focus(text.length);
        return;
      }
      const start = input.current?.selectionStart ?? text.length;
      const end = input.current?.selectionEnd ?? start;
      const before = text.slice(0, start);
      const prefix = before && !/\s$/u.test(before) ? ' ' : '';
      const value = `${prefix}@${name} `;
      setText(before + value + text.slice(end));
      setDismissed(true);
      focus(start + value.length);
    },
    [disabled, text, focus],
  );
  useImperativeHandle(mentionRef, () => ({ mention }), [mention]);
  useEffect(() => () => onTyping(false), [onTyping]);
  const activeStart = active?.start;
  const updatePosition = useCallback(() => {
    if (!input.current || !box.current || activeStart === undefined) return;
    const point = mentionPosition(input.current, activeStart);
    const rect = input.current.getBoundingClientRect();
    const parent = box.current.getBoundingClientRect();
    setPosition({
      left: rect.left - parent.left + point.left,
      top: rect.top - parent.top + point.top,
    });
  }, [activeStart]);
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(input.current);
    return () => observer.disconnect();
  }, [open, text, updatePosition]);
  useEffect(() => {
    if (open)
      document.getElementById(`${menuId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, menuId]);
  function choose(name: string) {
    if (!active || disabled) return;
    const before = text.slice(0, active.start);
    const prefix = before && !/\s$/u.test(before) ? ' ' : '';
    const value = `${prefix}@${name} `;
    setText(before + value + text.slice(active.end));
    setDismissed(true);
    focus(active.start + value.length);
  }
  const valid = text.trim().length > 0 && [...text.trim()].length <= 10000;
  function send() {
    if (!disabled && valid && !composing.current) {
      onSend(text.trim());
      setText('');
      setDismissed(true);
      onTyping(false);
    }
  }
  return (
    <div className="composer-wrap">
      <div className={'egent-mention-toggle' + (egent ? ' is-active' : '')}>
        <Button
          ripple
          variant="ghost"
          disabled={disabled}
          aria-pressed={egent}
          onClick={() => mention('Egent')}
        >
          @Egent
        </Button>
        {egent && (
          <Button
            ripple
            variant="ghost"
            disabled={disabled}
            aria-label="取消 @Egent"
            onClick={() => {
              const next = removeEgentMentions(text);
              setText(next);
              setDismissed(true);
              focus(next.length);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="m3 3 6 6m0-6-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Button>
        )}
      </div>
      <div className="composer" ref={box}>
        <Menu
          open={open}
          onOpenChange={(value) => {
            const next = typeof value === 'function' ? value(open) : value;
            if (!next) setDismissed(true);
          }}
          placement="top-start"
          offset={4}
        >
          <Menu.Trigger as="span" aria-hidden="true" className="mention-anchor" style={position} />
          <Menu.Content
            ref={setMenu}
            aria-label="提及会话成员"
            className="mention-menu"
            initialFocus={-1}
            returnFocus={false}
            closeOnFocusOut={false}
          >
            {options.length ? (
              options.map((member, index) => (
                <Menu.Item
                  key={member.deviceId}
                  id={`${menuId}-${index}`}
                  ripple
                  className={index === activeIndex ? 'mention-option is-active' : 'mention-option'}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(member.name)}
                >
                  <span>{member.name}</span>
                  {member.deviceId === 'agent' && <small>只读助手</small>}
                </Menu.Item>
              ))
            ) : (
              <p className="mention-empty">没有匹配的成员</p>
            )}
          </Menu.Content>
        </Menu>
        <Textarea
          ref={input}
          resize
          className="border-0 p-0 shadow-none focus:border-0 focus:ring-0 focus:shadow-none"
          aria-label="消息"
          aria-controls={open ? menuElementId : undefined}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-activedescendant={open && options.length ? `${menuId}-${activeIndex}` : undefined}
          placeholder={disabled ? '正在连接会话…' : '发消息，输入 @ 提及成员…'}
          value={text}
          disabled={disabled}
          rows={3}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onSelect={(event) => {
            setSelection({
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            });
          }}
          onScroll={updatePosition}
          onChange={(event) => {
            setText(event.target.value);
            setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
            setDismissed(false);
            setSelected(0);
            if (!event.target.value) onTyping(false);
            else if (Date.now() - lastTyping.current > 1000) {
              onTyping(true);
              lastTyping.current = Date.now();
            }
          }}
          onBlur={(event) => {
            onTyping(false);
            if (!menu.current?.contains(event.relatedTarget)) setDismissed(true);
          }}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (open) {
              if (event.key === 'Escape') {
                event.preventDefault();
                setDismissed(true);
                return;
              }
              if (options.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault();
                setSelected(
                  (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) %
                    options.length,
                );
                return;
              }
              if (!event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')) {
                if (options.length) {
                  event.preventDefault();
                  choose(options[activeIndex]!.name);
                } else if (event.key === 'Enter') event.preventDefault();
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-footer">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <Button ripple disabled={disabled || !valid} onClick={send}>
            发送 <span aria-hidden>↑</span>
          </Button>
        </div>
      </div>
      <p className="chat-footnote">
        智能参与由项目所属人设置；@Egent 只读回答，修改代码需创建任务并确认。
      </p>
    </div>
  );
}
