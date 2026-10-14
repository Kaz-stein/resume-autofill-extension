/**
 * site-check.mjs —— 官网自检（CDP 驱动真实浏览器 + 本地对比度计算）
 *
 * 检查项：
 *   1. 三档宽度（360 / 768 / 1440）有无横向溢出
 *   2. 首屏是否依赖任何外部资源（用 Resource Timing 判定，不是靠肉眼扫 HTML）
 *   3. prefers-reduced-motion: reduce 下是否直接呈现终态
 *   4. prefers-color-scheme: dark 是否生效
 *   5. 键盘 Tab 顺序与可见焦点
 *   6. 设计 token 的 WCAG 对比度
 */
const PORT = Number(process.env.CDP_PORT || 9335);
const PAGE =
  'file:///C:/Users/pence/Documents/Codex/2026-10-13/you-s/outputs/resume-autofill-extension/docs/index.html';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/* ------------------------------ CDP ------------------------------ */

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('ws error')));
    ws.addEventListener('open', () =>
      resolve({
        ws,
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { res, rej });
            ws.send(JSON.stringify({ id: mid, method, params }));
          }),
        async eval(expression) {
          const r = await this.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true
          });
          if (r.exceptionDetails) {
            return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
          }
          return r.result.value;
        }
      })
    );
  });
}

/* --------------------------- 对比度计算 --------------------------- */

function luminance(hex) {
  const c = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/* ------------------------------ 主流程 ------------------------------ */

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const page = await connect(target.webSocketDebuggerUrl);
await page.send('Page.enable');
await page.send('Runtime.enable');
await page.send('Network.enable');
await page.send('Page.navigate', { url: PAGE });
await delay(1500);

/* 1. 三档宽度溢出检查 */
for (const [w, h] of [
  [360, 780],
  [768, 1024],
  [1440, 900]
]) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: w,
    height: h,
    deviceScaleFactor: 1,
    mobile: w < 500
  });
  await delay(350);
  const probe = await page.eval(`(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.classList.contains('skip')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        bad.push((el.tagName.toLowerCase() + '.' + (el.className || '')).slice(0, 46) + ' → ' + Math.round(r.left) + '..' + Math.round(r.right));
      }
    }
    return { vw, overflow, bad: bad.slice(0, 4) };
  })()`);
  record(
    `${w}px 宽度无横向溢出`,
    probe.overflow <= 1 && probe.bad.length === 0,
    probe.overflow > 1 ? `溢出 ${probe.overflow}px` : probe.bad.join(' | ')
  );
}

/* 2. 外部资源（用真实的网络请求记录判定） */
const external = await page.eval(`(() => {
  const entries = performance.getEntriesByType('resource').map(e => e.name);
  const remote = entries.filter(u => /^https?:/i.test(u));
  const domRefs = [...document.querySelectorAll('link[href],script[src],img[src],iframe[src]')]
    .map(el => el.getAttribute('href') || el.getAttribute('src'))
    .filter(u => u && /^(https?:)?\\/\\//i.test(u));
  return { remote, domRefs, all: entries.length };
})()`);
record(
  '首屏不加载任何外部资源',
  external.remote.length === 0 && external.domRefs.length === 0,
  external.remote.length || external.domRefs.length ? JSON.stringify(external) : `本地请求 ${external.all} 个（样式表与脚本）`
);

/* 3. 演示动画在正常模式下会跑起来（先强制重新加载，避免沿用上一轮状态） */
await page.send('Emulation.clearDeviceMetricsOverride');
await page.send('Page.navigate', { url: `${PAGE}?t=${Date.now()}` });
await delay(1200);
await page.eval(`document.getElementById('demoForm').scrollIntoView({block:'center'})`);

let played = null;
for (let i = 0; i < 20; i += 1) {
  played = await page.eval(`(() => {
  const rows = [...document.querySelectorAll('#demoForm .row')];
  const filled = rows.filter(r => r.classList.contains('is-filled'));
  const skipped = rows.filter(r => r.classList.contains('is-skipped'));
  return {
    filled: filled.length,
    skipped: skipped.length,
    total: rows.length,
    firstWhy: (rows[0].querySelector('.row__why') || {}).textContent || '',
    sampleValue: (filled[0] && filled[0].querySelector('.row__value').textContent) || ''
  };
})()`);
  if (played.filled === 6 && played.skipped === 3) break;
  await delay(400);
}
record(
  '演示动画逐条填入并标注依据',
  played.filled === 6 && played.skipped === 3 && played.firstWhy.length > 0,
  `填入 ${played.filled} / 跳过 ${played.skipped} / 共 ${played.total}，首行依据「${played.firstWhy}」，示例值「${played.sampleValue}」`
);

/* 4. 减少动效：直接呈现终态 */
await page.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
});
await page.send('Page.navigate', { url: PAGE });
await delay(1200);
const reduced = await page.eval(`(() => {
  const rows = [...document.querySelectorAll('#demoForm .row')];
  return {
    filled: rows.filter(r => r.classList.contains('is-filled')).length,
    skipped: rows.filter(r => r.classList.contains('is-skipped')).length,
    whyCount: rows.filter(r => (r.querySelector('.row__why') || {}).textContent).length
  };
})()`);
record(
  '开启「减少动态效果」时直接呈现终态',
  reduced.filled === 6 && reduced.skipped === 3 && reduced.whyCount === 9,
  `填入 ${reduced.filled} / 跳过 ${reduced.skipped} / 带依据 ${reduced.whyCount}`
);
await page.send('Emulation.setEmulatedMedia', { features: [] });

/* 5. 深色模式 */
await page.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: 'dark' }]
});
await page.send('Page.navigate', { url: PAGE });
await delay(1000);
const dark = await page.eval(`(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  const fg = getComputedStyle(document.body).color;
  return { bg, fg, scheme: getComputedStyle(document.documentElement).colorScheme };
})()`);
record(
  '深色模式生效',
  dark.bg === 'rgb(16, 19, 23)',
  `body 背景 ${dark.bg} / 文字 ${dark.fg}`
);
await page.send('Emulation.setEmulatedMedia', { features: [] });
await page.send('Page.navigate', { url: PAGE });
await delay(1000);

/* 6. 键盘可达性与焦点可见（用真实的 Tab 按键，而不是程序化 focus） */
const focusables = await page.eval(`(() => {
  const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null).length;
})()`);
record('可聚焦元素数量正常', focusables >= 8, `${focusables} 个可聚焦元素`);

const tab = async (mods = 0) =>
  page.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
    modifiers: mods
  });

await page.eval('document.body.focus()');
await tab();
await delay(120);
const focusProbe = await page.eval(`(() => {
  const el = document.activeElement;
  const cs = getComputedStyle(el);
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').trim().slice(0, 12),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor
  };
})()`);
record(
  '按 Tab 键后焦点样式可见',
  focusProbe.outlineStyle !== 'none' && parseFloat(focusProbe.outlineWidth) >= 2,
  `${focusProbe.tag}「${focusProbe.text}」→ ${focusProbe.outlineStyle} ${focusProbe.outlineWidth} ${focusProbe.outlineColor}`
);

const order = await page.eval(`(() => {
  const sel = 'a[href], button';
  const els = [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
  return els.slice(0, 6).map(el => (el.textContent || '').trim().slice(0, 14));
})()`);
record('Tab 顺序从「跳到正文」开始', order[0].includes('跳到正文'), order.join(' → '));

/* 7. 对比度 */
const pairs = [
  ['正文 --ink / --paper', '#16181C', '#FBFBFA', 4.5],
  ['次要文字 --ink-soft / --paper', '#5A646E', '#FBFBFA', 4.5],
  ['小标签 --ink-faint / --paper', '#6A737A', '#FBFBFA', 4.5],
  ['主色 --brand / --paper（大标题）', '#0E6E6B', '#FBFBFA', 3.0],
  ['按钮白字 / --brand', '#FFFFFF', '#0E6E6B', 4.5],
  ['校验绿 --filled / --paper', '#1A7A45', '#FBFBFA', 4.5],
  ['校验绿 --filled / --filled-wash（性别胶囊）', '#1A7A45', '#EAF6EE', 4.5],
  ['深色正文 #E9ECEF / #101317', '#E9ECEF', '#101317', 4.5],
  ['深色次要 #A2ACB5 / #101317', '#A2ACB5', '#101317', 4.5],
  ['深色小标签 #78828B / #101317', '#78828B', '#101317', 4.5],
  ['深色主色 #4FB3AE / #101317', '#4FB3AE', '#101317', 4.5]
  ,
  ['深色校验绿 #4DBD7A / #101317', '#4DBD7A', '#101317', 4.5]
];
for (const [name, fg, bg, min] of pairs) {
  const ratio = contrast(fg, bg);
  record(
    `对比度 ${name}`,
    ratio >= min,
    `${ratio.toFixed(2)}:1（要求 ≥ ${min}）`
  );
}

console.log('\n================ 汇总 ================');
const failed = results.filter((r) => !r.pass);
console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
for (const f of failed) console.log(`  FAIL ${f.name} — ${f.detail}`);

page.ws.close();
process.exitCode = failed.length ? 1 : 0;
