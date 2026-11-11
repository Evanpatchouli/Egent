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
  const ownMarkdown = page.locator('[data-message-id="own-markdown"] .message-markdown');
  check((await ownMarkdown.locator('strong').innerText()) === '重点', 'own Markdown must render');
  check((await ownMarkdown.locator('br').count()) === 1, 'single line breaks must be preserved');
  const taskMarkdown = page.locator('[data-message-id="other-task"] .message-markdown');
  check((await taskMarkdown.locator('strong').innerText()) === '测试', 'task Markdown must render');
  check((await taskMarkdown.locator('li').innerText()) === '覆盖回归', 'task list must render');
  const markdown = page.locator('[data-message-id="agent-markdown"] .message-markdown');
  check((await markdown.locator('h2').innerText()) === '实施说明', 'heading must render');
  check((await markdown.locator('strong').innerText()) === '粗体', 'strong text must render');
  check((await markdown.locator('em').innerText()) === '斜体', 'emphasis must render');
  check((await markdown.locator('del').innerText()) === '删除线', 'GFM must render');
  check(await markdown.getByRole('checkbox').isChecked(), 'GFM task list must render');
  check(await markdown.getByRole('checkbox').isDisabled(), 'task list must remain read-only');
  check(
    (await markdown
      .locator('li')
      .first()
      .evaluate((node) => getComputedStyle(node).listStyleType)) !== 'none',
    'ordinary items in task lists must keep their bullets',
  );
  check(
    (await page
      .locator('[data-message-id="system-markdown"] .message-markdown strong')
      .innerText()) === '提示',
    'system Markdown must render',
  );
  check((await markdown.locator('blockquote').innerText()) === '重要提示', 'quote must render');
  check((await markdown.locator('table td').count()) === 2, 'table must render');
  check(
    (await markdown.locator('pre code').innerText()).includes('const longLine'),
    'code must render',
  );
  const safeLink = markdown.getByRole('link', { name: '安全链接', exact: true });
  check((await safeLink.getAttribute('href')) === 'https://example.com/docs', 'link URL missing');
  check((await safeLink.getAttribute('target')) === '_blank', 'link must leave the app window');
  check((await safeLink.getAttribute('rel')) === 'noreferrer', 'link must not send a referrer');
  check(
    (await markdown.getByRole('link', { name: '不安全链接' }).count()) === 0,
    'unsafe link must be inert',
  );
  check(
    (await markdown.getByRole('link', { name: '图片：预览' }).getAttribute('href')) ===
      'https://example.com/pixel.png',
    'image must be a link without loading the resource',
  );
  check(
    (await markdown.getByRole('link', { name: '图片：图标' }).getAttribute('href')) ===
      'https://example.com/destination',
    'linked image must retain its outer destination',
  );
  check(
    (await markdown.locator('a a, img, script').count()) === 0,
    'unsafe HTML or image must not render',
  );
  check(
    (await markdown.innerText()).includes('<img src=x onerror=alert(1)>'),
    'raw HTML must remain text',
  );
  check(
    await markdown.locator('pre').evaluate((node) => node.scrollWidth > node.clientWidth),
    'long code must scroll inside the message',
  );
  await page.evaluate(() => {
    window.testCopiedMessage = '';
    window.testCopyFails = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          if (window.testCopyFails) throw new Error('clipboard denied');
          window.testCopiedMessage = text;
        },
      },
    });
  });
  const ownMessage = page.locator('[data-message-id="own-markdown"]');
  const ownCopy = ownMessage.getByRole('button', { name: '复制消息' });
  await page.mouse.move(0, 0);
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-message-id="own-markdown"] .message-copy'))
        .opacity === '0',
  );
  await ownMessage.hover();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-message-id="own-markdown"] .message-copy'))
        .opacity === '1',
  );
  const copyBox = await ownCopy.boundingBox();
  const bodyBox = await ownMessage.locator('.message-body').boundingBox();
  check(
    Math.abs(copyBox.x - bodyBox.x) < 1 && copyBox.y >= bodyBox.y + bodyBox.height,
    'copy button must sit below the left edge of the message',
  );
  await ownCopy.click();
  check(
    (await page.evaluate(() => window.testCopiedMessage)) === '我的 **重点**\n下一行',
    'copy must preserve the original Markdown',
  );
  check(
    await ownMessage.getByRole('button', { name: '已复制消息' }).isVisible(),
    'copy success must be visible',
  );
  const taskMessage = page.locator('[data-message-id="other-task"]');
  await taskMessage.hover();
  await taskMessage.getByRole('button', { name: '复制消息' }).click();
  check(
    (await page.evaluate(() => window.testCopiedMessage)) === '请完善 **测试**。\n- 覆盖回归',
    'task copy must preserve the original content',
  );
  await page.evaluate(() => {
    window.testCopyFails = true;
  });
  const systemMessage = page.locator('[data-message-id="system-markdown"]');
  await systemMessage.hover();
  await systemMessage.getByRole('button', { name: '复制消息' }).click();
  check(
    await systemMessage.getByRole('button', { name: '复制失败消息' }).isVisible(),
    'copy failure must be visible',
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-message-id="system-markdown"] .message-copy')
        .getAttribute('aria-label') === '复制消息',
  );
  await page.evaluate(() => {
    window.testCopyFails = false;
  });
  await page.mouse.move(0, 0);
  await page.locator('[data-message-id="other"] .message-copy').focus();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-message-id="other"] .message-copy'))
        .opacity === '1',
  );
  await page.keyboard.press('Enter');
  check(
    (await page.evaluate(() => window.testCopiedMessage)) === '同事的消息',
    'keyboard activation must copy the message',
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
  const composer = page.getByRole('textbox', { name: '消息' });
  await composer.fill('发送 **Markdown**\n第二行');
  await composer.press('Enter');
  const sent = page.locator('[data-message-id="sent-0"]');
  check(
    (await sent.locator('.message-markdown strong').innerText()) === 'Markdown',
    'sent Markdown must render',
  );
  check((await sent.locator('.message-markdown br').count()) === 1, 'sent line breaks must render');
  check((await composer.inputValue()) === '', 'sending must clear the composer');
  check(
    await page
      .locator('.message-scroll')
      .evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight < 2),
    'sending must scroll to the new message',
  );
  return 'mention and message display checks passed';
};
