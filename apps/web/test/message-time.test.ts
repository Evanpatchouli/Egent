import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMessageTime } from '../src/components/chat/messageTime.ts';

test('message times use the local calendar and a 24-hour clock', () => {
  const now = new Date(2026, 5, 22, 0, 2);
  assert.equal(formatMessageTime(new Date(2026, 5, 22, 0, 1).toISOString(), now), '00:01');
  assert.equal(formatMessageTime(new Date(2026, 5, 21, 15, 36).toISOString(), now), '昨天 15:36');
  assert.equal(
    formatMessageTime(new Date(2026, 5, 20, 15, 36).toISOString(), now),
    '6月20日 15:36',
  );
  assert.equal(
    formatMessageTime(new Date(2025, 5, 21, 15, 36).toISOString(), now),
    '2025年6月21日 15:36',
  );
});

test('yesterday across a year boundary includes the year', () => {
  const now = new Date(2026, 0, 1, 0, 1);
  assert.equal(
    formatMessageTime(new Date(2025, 11, 31, 23, 59).toISOString(), now),
    '昨天（2025年） 23:59',
  );
  assert.equal(
    formatMessageTime(new Date(2025, 11, 30, 23, 59).toISOString(), now),
    '2025年12月30日 23:59',
  );
});
