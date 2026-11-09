import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { Button } from '@material-tailwind/react';
import { Composer, type ComposerHandle } from '../src/components/chat/Composer';
import { MessageList } from '../src/components/chat/MessageList';
import '../src/styles.css';
const members = [
  { deviceId: 'alice', name: '小明' },
  { deviceId: 'bob', name: 'Alice Chen' },
  { deviceId: 'carol', name: '小红' },
];
const user = { id: 'alice', identifier: 'alice', name: '小明', role: 'OWNER' as const };
function Mentions() {
  const composer = useRef<ComposerHandle>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [disabled, setDisabled] = useState(false);
  return (
    <main className="chat-app" style={{ display: 'block', height: '100vh', paddingTop: 30 }}>
      <div style={{ maxWidth: 850, margin: 'auto' }}>
        <Button ripple variant="ghost" onClick={() => setDisabled(!disabled)}>
          切换离线
        </Button>
        <MessageList
          messages={members.map((m) => ({
            id: m.deviceId,
            conversationId: 'test',
            clientMessageId: null,
            senderType: 'USER',
            sender: { id: m.deviceId, name: m.name, role: 'COLLEAGUE' },
            content: '点击头像提及我',
            createdAt: '2026-09-16T00:00:00Z',
          }))}
          user={user}
          ownMessagesRight={true}
          hasMore={false}
          loadingEarlier={false}
          earlier={async () => {}}
          onBottom={() => {}}
          onMention={(name) => composer.current?.mention(name)}
          mentionDisabled={disabled}
        />
      </div>
      <Composer
        members={members}
        mentionRef={composer}
        disabled={disabled}
        onSend={(text) => setSent([...sent, text])}
        onTyping={() => {}}
      />
      <output aria-label="已发送">{JSON.stringify(sent)}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Mentions />);
