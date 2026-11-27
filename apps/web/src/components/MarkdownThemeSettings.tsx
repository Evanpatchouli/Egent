import { Radio } from '@material-tailwind/react';
import { markdownThemes, parseMarkdownTheme, type MarkdownTheme } from '../hooks/useMarkdownTheme';
import { MessageMarkdown } from './chat/MessageMarkdown';
import './MarkdownThemeSettings.css';

const previewText = [
  '## 联调记录',
  '接口已通过 **本地验证**。合并前，请再运行一次 `pnpm test`。',
  '> 先核对返回值，再检查空数据的展示。',
  '| 检查项 | 进度 |\n| --- | --- |\n| 消息收发 | 已完成 |\n| 离线同步 | 待复核 |',
].join('\n\n');

export function MarkdownThemeSettings({
  theme,
  onChange,
}: {
  theme: MarkdownTheme;
  onChange: (theme: MarkdownTheme) => void;
}) {
  return (
    <div className="markdown-theme-settings">
      <h3 id="markdown-theme-title">会话消息主题</h3>
      <Radio
        role="radiogroup"
        aria-labelledby="markdown-theme-title"
        className="markdown-theme-options"
        value={theme}
        onValueChange={(value) => onChange(parseMarkdownTheme(value))}
      >
        {markdownThemes.map(({ id, name }) => (
          <Radio.Item key={id} name="markdown-theme" value={id} className="markdown-theme-choice">
            <span className="markdown-theme-swatch" data-markdown-theme={id} aria-hidden="true">
              <span>Aa</span>
            </span>
            <span className="markdown-theme-caption">{name}</span>
          </Radio.Item>
        ))}
      </Radio>
      <h3 id="markdown-preview-title">消息预览</h3>
      <div
        role="region"
        aria-labelledby="markdown-preview-title"
        className="markdown-theme-preview"
        data-markdown-theme={theme}
      >
        <MessageMarkdown text={previewText} />
      </div>
    </div>
  );
}
