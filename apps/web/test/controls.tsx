import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Button, Checkbox, Radio, Textarea } from '@material-tailwind/react';
import '../src/styles.css';
function Controls() {
  const [checked, setChecked] = useState(true),
    [value, setValue] = useState('one'),
    [count, setCount] = useState(0);
  return (
    <main style={{ padding: 30, display: 'grid', gap: 20, maxWidth: 500 }}>
      <Button ripple onClick={() => setCount((v) => v + 1)}>
        实心按钮
      </Button>
      <Button ripple variant="ghost" onClick={() => setCount((v) => v + 1)}>
        浅色按钮
      </Button>
      <Button ripple disabled onClick={() => setCount((v) => v + 1)}>
        禁用按钮
      </Button>
      <output aria-label="点击次数">{count}</output>
      <Checkbox
        className="egent-control"
        aria-label="受控复选框"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
      >
        <Checkbox.Indicator />
      </Checkbox>
      <Button ripple variant="ghost" onClick={() => setChecked(false)}>
        从外部设为未选中
      </Button>
      <Checkbox aria-label="禁用复选框" disabled checked={false}>
        <Checkbox.Indicator />
      </Checkbox>
      <Radio value={value} onValueChange={setValue} role="radiogroup" aria-label="项目">
        <Radio.Item name="project" aria-label="项目一" value="one">
          <Radio.Indicator />
        </Radio.Item>
        <Radio.Item name="project" aria-label="项目二" value="two">
          <Radio.Indicator />
        </Radio.Item>
        <Radio.Item name="project" aria-label="禁用项目" value="disabled" disabled>
          <Radio.Indicator />
        </Radio.Item>
      </Radio>
      <Textarea aria-label="消息测试" rows={3} />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Controls />);
