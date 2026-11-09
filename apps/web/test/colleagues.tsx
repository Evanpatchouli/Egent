import { createRoot } from 'react-dom/client';
import { ColleagueList } from '../src/components/ColleagueList';
import type { PeerContact } from '../src/components/InvitePeople';
import '../src/styles.css';
let peers: PeerContact[] = ['小明', '小红', '小林', '小陈', '小李'].map((nickname, i) => ({
  deviceId: String(i),
  nickname,
  address: `192.168.1.${i + 1}`,
  online: i < 2,
}));
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path === '/api/peers') return Response.json(peers);
  if (body.address === 'bad')
    return Response.json({ error: { message: '无法连接该设备' } }, { status: 503 });
  const peer = { deviceId: 'new', nickname: '新同事', address: body.address };
  if (path.endsWith('/probe')) return Response.json(peer);
  if (path.endsWith('/connect')) {
    peers = [{ ...peer, online: true }, ...peers.filter((p) => p.deviceId !== peer.deviceId)];
    return Response.json(peer);
  }
  return Response.json({}, { status: 404 });
};
createRoot(document.getElementById('root')!).render(
  <main className="chat-app">
    <aside className="chat-sidebar" style={{ height: '100%' }}>
      <div className="sidebar-content">
        <ColleagueList />
      </div>
    </aside>
  </main>,
);
