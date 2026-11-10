/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright CLI loads this function expression directly. */
async (page) => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await page.goto('/test/mentions.html');
  const input = page.getByRole('textbox', { name: '消息' });
  await input.fill('@');
  const inputBox = await input.boundingBox();
  const option = page.getByRole('menuitem', { name: '小明' });
  const optionBox = await option.boundingBox();
  await page.mouse.move(inputBox.x + 10, inputBox.y + 10);
  await page.mouse.move(optionBox.x + 10, optionBox.y + 10, { steps: 30 });
  check(await page.getByRole('menu').isVisible(), 'menu must stay open when the pointer enters');
  check(
    (await input.getAttribute('aria-controls')) ===
      (await page.getByRole('menu').getAttribute('id')),
    'input must reference the actual menu',
  );
  await option.click();
  check((await input.inputValue()) === '@小明 ', 'click must insert the selected mention');
  await input.fill('@');
  await input.press('ArrowDown');
  await input.press('Enter');
  check((await input.inputValue()) === '@小明 ', 'keyboard selection must still work');
  await page.goto('/test/settings.html');
  await page.evaluate(() => localStorage.removeItem('egent.ownMessagesRight'));
  await page.reload();
  check(
    await page
      .locator('[data-message-id="own"]')
      .evaluate((node) => node.classList.contains('own-message')),
    'own message must default to the right',
  );
  check(
    !(await page
      .locator('[data-message-id="other"]')
      .evaluate((node) => node.classList.contains('own-message'))),
    'other messages must remain on the left',
  );
  const ownAvatar = page.locator('[data-message-id="own"] .agent-avatar-button');
  const otherAvatar = page.locator('[data-message-id="other"] .agent-avatar-button');
  check(
    (await ownAvatar.boundingBox()).x > (await otherAvatar.boundingBox()).x,
    'own avatar must be on the right',
  );
  for (const id of ['own-task', 'other-task']) {
    const task = page.locator('[data-message-id="' + id + '"]');
    check(
      await task.getByText('创建了一项任务', { exact: true }).isVisible(),
      'task label missing',
    );
    check(await task.locator('.task-creation-content p').isVisible(), 'task content missing');
  }
  for (const id of ['own', 'other', 'question', 'revision'])
    check(
      (await page.locator('[data-message-id="' + id + '"] .task-creation-content').count()) === 0,
      'non-creation message must not use task styling',
    );
  check(
    (await page.locator('[data-message-id="own-task"] .task-creation-content p').innerText()) ===
      '请排查订单问题\nhttps://example.com/issues/15\n保留这些需求的完整内容。',
    'task content and newlines must be preserved',
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '全局设置' }).click();
  const toggle = page.getByRole('switch', { name: '我的消息显示在右侧' });
  check(await toggle.isChecked(), 'switch must default to on');
  await toggle.uncheck();
  await page.getByRole('button', { name: '返回聊天' }).click();
  check(
    !(await page
      .locator('[data-message-id="own"]')
      .evaluate((node) => node.classList.contains('own-message'))),
    'disabled setting must move own messages left',
  );
  check(
    Math.abs((await ownAvatar.boundingBox()).x - (await otherAvatar.boundingBox()).x) < 1,
    'own avatar must return to the left',
  );
  check(
    !(await page
      .locator('[data-message-id="own-task"]')
      .evaluate((node) => node.classList.contains('own-message'))),
    'task creation must follow the own-message alignment setting',
  );
  await page.reload();
  check(
    !(await page
      .locator('[data-message-id="own"]')
      .evaluate((node) => node.classList.contains('own-message'))),
    'setting must survive reload',
  );
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '全局设置' }).click();
  await toggle.check();
  await page.getByRole('button', { name: '返回聊天' }).click();
  check(
    await page
      .locator('[data-message-id="own"]')
      .evaluate((node) => node.classList.contains('own-message')),
    'enabling the setting must move own messages right',
  );
  return 'mention and message display checks passed';
};
