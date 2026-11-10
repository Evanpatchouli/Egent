import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Button } from '@material-tailwind/react';
import type { UserInfo } from '@egent/shared';
import { SettingsPage } from '../src/components/SettingsPage';
import { ConversationSidebar } from '../src/components/chat/ConversationSidebar';
import { Composer } from '../src/components/chat/Composer';
import { MessageList } from '../src/components/chat/MessageList';
import '../src/styles.css';
const initial: UserInfo = { id: 'local', identifier: 'local', name: '测试同事', role: 'OWNER' };
let visible = false;
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path === '/api/device/nickname') return Response.json({ ...initial, name: body.name });
  if (path === '/api/projects')
    return Response.json([
      { name: '示例项目', path: 'C:/Projects/sample', colleagueVisible: visible },
    ]);
  if (path === '/api/projects/visibility') {
    visible = body.colleagueVisible;
    return Response.json({
      name: '示例项目',
      path: 'C:/Projects/sample',
      colleagueVisible: visible,
    });
  }
  if (path === '/api/health')
    return Response.json({
      ok: true,
      service: 'egent-server',
      version: 'fixture',
      timestamp: new Date().toISOString(),
    });
  return Response.json({ error: { message: '测试接口不存在' } }, { status: 404 });
};
function Fixture() {
  const [user, setUser] = useState(initial),
    [settings, setSettings] = useState(false),
    [refreshes, setRefreshes] = useState(0),
    [ownMessagesRight, setOwnMessagesRight] = useState(
      () => localStorage.getItem('egent.ownMessagesRight') !== 'false',
    );
  return (
    <div className="chat-app">
      <header className="app-header">
        Egent <span>{user.name}</span>
      </header>
      <div className="chat-layout" hidden={settings}>
        <aside className="chat-sidebar">
          <div className="sidebar-content">
            <ConversationSidebar
              conversations={[]}
              onSelect={() => {}}
              onCreate={() => {}}
              onRefresh={() => setRefreshes(refreshes + 1)}
              refreshing={false}
            />
            <output aria-label="刷新次数">{refreshes}</output>
          </div>
          <div className="sidebar-footer">
            <Button ripple variant="ghost" onClick={() => setSettings(true)}>
              设置
            </Button>
          </div>
        </aside>
        <main className="chat-main">
          <MessageList
            messages={[
              {
                id: 'own',
                conversationId: 'test',
                clientMessageId: null,
                senderType: 'USER',
                sender: { id: user.id, name: user.name, role: user.role },
                content: '我的消息',
                createdAt: '2026-09-16T00:00:00Z',
              },
              {
                id: 'other',
                conversationId: 'test',
                clientMessageId: null,
                senderType: 'USER',
                sender: { id: 'other', name: '同事', role: 'COLLEAGUE' },
                content: '同事的消息',
                createdAt: '2026-09-16T00:00:00Z',
              },
              {
                id: 'own-task',
                conversationId: 'test',
                clientMessageId: null,
                senderType: 'USER',
                sender: { id: user.id, name: user.name, role: user.role },
                isTaskCreation: true,
                content: '请排查订单问题\nhttps://example.com/issues/15\n保留这些需求的完整内容。',
                createdAt: '2026-09-16T00:01:00Z',
              },
              {
                id: 'other-task',
                conversationId: 'test',
                clientMessageId: null,
                senderType: 'USER',
                sender: { id: 'other', name: '同事', role: 'COLLEAGUE' },
                isTaskCreation: true,
                content: '请完善测试。',
                createdAt: '2026-09-16T00:02:00Z',
              },
              {
                id: 'question',
                conversationId: 'test',
                clientMessageId: null,
                senderType: 'USER',
                sender: { id: user.id, name: user.name, role: user.role },
                agentTaskId: 'question-task',
                content: '@Egent 解释一下',
                createdAt: '2026-09-16T00:03:00Z',
              },
              {
                id: 'revision',
                conversationId: 'test',
                clientMessageId: null,
                senderType: 'USER',
                sender: { id: user.id, name: user.name, role: user.role },
                agentTaskId: 'development-task',
                content: '[补充方案 v1] 增加验收条件',
                createdAt: '2026-09-16T00:04:00Z',
              },
            ]}
            user={user}
            ownMessagesRight={ownMessagesRight}
            hasMore={false}
            loadingEarlier={false}
            earlier={async () => {}}
            onBottom={() => {}}
            onMention={() => {}}
            mentionDisabled={false}
          />
          <Composer disabled={false} members={[]} onSend={() => {}} onTyping={() => {}} />
        </main>
      </div>
      {settings && (
        <SettingsPage
          user={user}
          ownMessagesRight={ownMessagesRight}
          onOwnMessagesRightChange={(value) => {
            localStorage.setItem('egent.ownMessagesRight', String(value));
            setOwnMessagesRight(value);
          }}
          connection={{ connected: false, socket: null, error: '' }}
          onUserChange={setUser}
          onBack={() => setSettings(false)}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
