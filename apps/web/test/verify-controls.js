/* eslint-disable @typescript-eslint/no-unused-expressions -- Playwright CLI loads this function expression directly. */
async (page) => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  check((await page.getByRole('checkbox').count()) === 2, 'Checkbox must be in accessibility tree');
  const checkbox = page.getByRole('checkbox', { name: '受控复选框', exact: true });
  await checkbox.uncheck();
  check(!(await checkbox.isChecked()), 'controlled false must stay false');
  await checkbox.check();
  await page.getByRole('button', { name: '从外部设为未选中' }).click();
  check(!(await checkbox.isChecked()), 'external false must update the native input');
  const painted = await checkbox.evaluate((node) => node.parentElement.dataset.checked);
  check(painted === 'false', 'indicator context must follow controlled false');
  await checkbox.focus();
  await page.keyboard.press('Space');
  check(await checkbox.isChecked(), 'Space must toggle checkbox');
  check(
    await page.getByRole('checkbox', { name: '禁用复选框' }).isDisabled(),
    'disabled checkbox must be natively disabled',
  );
  check((await page.getByRole('radio').count()) === 3, 'Radio must be in accessibility tree');
  const first = page.getByRole('radio', { name: '项目一' });
  const second = page.getByRole('radio', { name: '项目二' });
  await first.focus();
  await page.keyboard.press('ArrowDown');
  check(await second.isChecked(), 'native radio arrow navigation must work');
  check(!(await first.isChecked()), 'radio group must stay mutually exclusive');
  check(
    await page.getByRole('radio', { name: '禁用项目' }).isDisabled(),
    'disabled radio must be natively disabled',
  );
  const ripple = await page.evaluate(() => {
    const results = [];
    for (const label of ['实心按钮', '浅色按钮']) {
      const button = Array.from(document.querySelectorAll('button')).find(
        (node) => node.textContent === label,
      );
      const rect = button.getBoundingClientRect();
      button.dispatchEvent(
        new MouseEvent('click', { bubbles: true, clientX: rect.x + 12, clientY: rect.y + 12 }),
      );
      const circle = button.querySelector('.ripple');
      results.push({
        label,
        exists: !!circle,
        color: circle?.style.backgroundColor,
        duration: circle?.getAnimations()[0]?.effect?.getTiming().duration,
      });
    }
    const disabled = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent === '禁用按钮',
    );
    disabled.click();
    return { results, disabledRipple: disabled.querySelectorAll('.ripple').length };
  });
  check(
    ripple.results.every((item) => item.exists && item.duration === 500),
    'buttons must create the real 500ms library ripple animation',
  );
  check(ripple.results[0].color.includes('255'), 'solid button ripple must be light');
  check(ripple.results[1].color.includes('0, 0, 0'), 'light surface ripple must be dark');
  check(ripple.disabledRipple === 0, 'disabled button must not produce ripple');
  await page.getByRole('textbox', { name: '消息测试' }).fill('测试多行\n内容');
  check(
    (await page.getByRole('textbox', { name: '消息测试' }).inputValue()).includes('\n'),
    'Textarea must retain lines',
  );
  return {
    checkbox: 'controlled/keyboard/disabled passed',
    radio: 'arrow/disabled passed',
    ripple,
    textarea: 'passed',
  };
};
