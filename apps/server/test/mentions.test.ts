import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionsName } from '../src/device/mentions.js';

test('member mentions match whole nicknames, including punctuation and spaces', () => {
  assert.equal(mentionsName('@小林 你好', '小林'), true);
  assert.equal(mentionsName('请看（@小林）', '小林'), true);
  assert.equal(mentionsName('@小林新 消息', '小林'), false);
  assert.equal(mentionsName('name@小林.com', '小林'), false);
  assert.equal(mentionsName('@A.B 好', 'A.B'), true);
  assert.equal(mentionsName('@A-B 好', 'A.B'), false);
  assert.equal(mentionsName('@张 三 好', '张 三'), true);
  assert.equal(mentionsName('@Egent hello', 'Egent'), false);
});
