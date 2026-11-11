import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function NotificationMarkdown({ text }: { text: string }) {
  return (
    <div className="notification-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
