import { createContext, memo, useContext, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm, remarkBreaks];
const InsideLink = createContext(false);

function isWebUrl(value: string | undefined): value is string {
  if (!value || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function MessageLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!isWebUrl(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      <InsideLink.Provider value>{children}</InsideLink.Provider>
    </a>
  );
}

function MessageImage({ src, alt }: { src?: string; alt?: string }) {
  const insideLink = useContext(InsideLink);
  const label = alt ? `图片：${alt}` : '图片';
  // Messages must not load remote images automatically. Linked images keep their outer link.
  return insideLink ? <span>{label}</span> : <MessageLink href={src}>{label}</MessageLink>;
}

const components = { a: MessageLink, img: MessageImage };

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
