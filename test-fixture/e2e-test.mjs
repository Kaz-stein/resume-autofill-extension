/**
 * e2e-test.mjs —— 简历填充插件的端到端测试（通过 CDP 驱动真实浏览器）
 *
 * 跑法：
 *   1) node test-fixture/serve.js            # 起本地服务器（127.0.0.1:8899）
 *   2) 启动浏览器并开远程调试端口：
 *        msedge.exe --remote-debugging-port=9334 --user-data-dir=<临时目录> \
 *          --load-extension=<扩展根目录> --disable-extensions-except=<扩展根目录>
 *   3) node test-fixture/e2e-test.mjs        # CDP_PORT 默认 9334
 *
 * 说明：命令行 --load-extension 在部分新版 Chrome 上会被忽略，
 * 所以脚本还会兜底尝试用 CDP 的 Extensions.loadUnpacked 加载一次。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.CDP_PORT || 9334);
const FIXTURE = 'http://127.0.0.1:8899/demo-form.html';
const EXT_PATH =
  process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const sockets = [];

function record(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function printSummary() {
  const failed = results.filter((r) => !r.pass);
  console.log('\n================ 测试汇总 ================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length) {
    console.log('\n失败项：');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` ：${f.detail}` : ''}`);
  }
}

/* ------------------------------ CDP 客户端 ------------------------------ */

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
    ws.addEventListener('error', () => reject(new Error(`无法连接 ${wsUrl}`)));
    ws.addEventListener('open', () =>
      resolve({
        ws,
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { res, rej });
            ws.send(JSON.stringify({ id: mid, method, params }));
          });
        },
        async eval(expression, awaitPromise = true) {
          const r = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise,
            returnByValue: true
          });
          if (r.exceptionDetails) {
            const desc =
              (r.exceptionDetails.exception && r.exceptionDetails.exception.description) ||
              r.exceptionDetails.text;
            throw new Error(`页面内脚本异常：${desc}`);
          }
          return r.result.value;
        }
      })
    );
    sockets.push(ws);
  });
}

async function waitUntil(fn, timeout = 20000, interval = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await delay(interval);
  }
  return null;
}

const get = (obj, path) => path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

/* ------------------------------ 期望值 ------------------------------ */

const labels = {
  name: '姓名',
  gender: '性别（单选框）',
  phone: '手机号',
  emailDom: '邮箱（DOM 值）',
  emailState: '邮箱（受控组件内部 state）',
  degree: '学历（原生下拉）',
  school: '学校名称',
  major: '专业',
  eduEnd: '毕业时间（教育经历区块）',
  company: '公司名称',
  jobTitle: '职位名称',
  workDesc: '工作内容（多行文本）',
  workEnd: '离职时间（工作经历区块）',
  projectName: '项目名称',
  tech: '技术栈',
  projectDesc: '项目描述',
  city: '期望城市（自定义下拉）',
  salary: '期望薪资',
  summary: '自我评价（多行文本）'
};

const expected = {
  name: '示例姓名',
  gender: '男',
  phone: '13800000000',
  emailDom: 'example@example.com',
  emailState: 'example@example.com',
  degree: '本科',
  school: '示例大学',
  major: '计算机科学与技术',
  eduEnd: '2021-06-30',
  company: '示例科技有限公司',
  jobTitle: '前端开发工程师',
  workDesc: '负责公司核心业务系统的前端开发与性能优化，主导前端工程化改造。',
  workEnd: '至今',
  projectName: '示例中台项目',
  tech: 'React、TypeScript、Vite',
  projectDesc: '面向内部运营的一站式数据管理平台，支撑日均十万级操作。',
  city: '示例城市',
  salary: '15-25K',
  summary:
    '示例自我评价：具备扎实的前端基础与工程化经验，善于沟通协作，能独立负责模块从设计到上线的完整流程。',
  'iframe.position': '前端开发工程师'
};

const untouched = {
  leaveReason: '离职原因（简历里为空，不应填充）',
  captcha: '短信验证码（干扰字段）',
  search: '搜索框（干扰字段）',
  hidden: '隐藏字段（type=hidden）',
  agree: '协议勾选框（不应勾选）',
  'iframe.other': '昵称字段（不应被填成姓名）'
};

/* ------------------------------ 主流程 ------------------------------ */

(async () => {
  // 0. 通过 CDP 加载扩展
  const versionInfo = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await connect(versionInfo.webSocketDebuggerUrl);
  let extId = null;
  try {
    const loaded = await browser.send('Extensions.loadUnpacked', { path: EXT_PATH });
    extId = loaded.id;
    record('加载扩展成功', Boolean(extId), `扩展 ID ${extId}`);
  } catch (err) {
    // 浏览器已经通过 --load-extension 加载过时，这里会失败，退回从 Service Worker 目标里取 ID
    const existing = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(
      (t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')
    );
    if (existing) {
      extId = existing.url.split('/')[2];
      record('扩展已在浏览器中加载', true, `扩展 ID ${extId}`);
    } else {
      record('加载扩展成功', false, err.message);
    }
  }

  // 1. 打开测试夹具
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageTarget = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!pageTarget) throw new Error('没有找到可用的页面标签');

  const page = await connect(pageTarget.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.navigate', { url: FIXTURE });
  await delay(1200);

  // 2. 内容脚本是否注入
  const injected = await waitUntil(
    () => page.eval("!!document.getElementById('ra-float-host')"),
    15000
  );
  record('内容脚本自动注入悬浮按钮', injected, injected ? '' : '15 秒内未出现 #ra-float-host');
  if (!injected) {
    printSummary();
    await shutdown(1);
    return;
  }

  const shadowOk = await page.eval(
    "(() => { const h = document.getElementById('ra-float-host'); return Boolean(h && h.shadowRoot && h.shadowRoot.getElementById('ra-fill-btn')); })()"
  );
  record('按钮渲染在 Shadow DOM 中（与页面样式隔离）', shadowOk);

  // 3. 点击「一键填写简历」
  const clicked = await page.eval(`(() => {
    const h = document.getElementById('ra-float-host');
    const b = h.shadowRoot.getElementById('ra-fill-btn');
    if (!b) return 'NO_BUTTON';
    b.click();
    return 'CLICKED';
  })()`);
  record('点击悬浮按钮触发填充', clicked === 'CLICKED', clicked);

  const panelVisible = await waitUntil(
    () =>
      page.eval(`(() => {
        const h = document.getElementById('ra-float-host');
        if (!h || !h.shadowRoot) return false;
        const p = h.shadowRoot.querySelector('.panel');
        return Boolean(p && !p.hidden);
      })()`),
    30000,
    400
  );
  record('填充完成后弹出结果面板', panelVisible, panelVisible ? '' : '30 秒内未出现结果面板');

  const values = await page.eval('window.__readValues()');
  const panelText = await page.eval(
    "(() => { const p = document.getElementById('ra-float-host').shadowRoot.querySelector('.panel'); return p ? p.innerText : ''; })()"
  );

  // 4. 逐项校验已填字段
  for (const [key, want] of Object.entries(expected)) {
    const got = get(values, key);
    const pass = String(got) === String(want);
    record(`填充正确：${labels[key] || key}`, pass, pass ? '' : `期望「${want}」，实际「${got}」`);
  }

  // 5. 干扰字段必须保持原样
  for (const [key, label] of Object.entries(untouched)) {
    const got = get(values, key);
    const pass = key === 'agree' ? got === false : String(got) === '';
    record(`未被误填：${label}`, pass, pass ? '' : `实际值为「${got}」`);
  }

  // 6. 结果面板
  record('结果面板显示统计信息', /成功/.test(panelText), panelText.split('\n').slice(0, 2).join(' / '));
  record('结果面板区分跳过项', /跳过/.test(panelText));

  // 7. 撤销
  const undoClicked = await page.eval(`(() => {
    const h = document.getElementById('ra-float-host');
    const b = h.shadowRoot.querySelector('.mini.primary');
    if (!b) return 'NO_UNDO_BUTTON';
    b.click();
    return 'CLICKED';
  })()`);
  record('结果面板提供「撤销本次填充」入口', undoClicked === 'CLICKED', undoClicked);

  const undone = await waitUntil(
    async () => {
      const v = await page.eval('window.__readValues()');
      return v.name === '' && v.school === '' && v.gender === '' ? v : null;
    },
    15000,
    300
  );
  record('撤销后字段恢复为填充前的空值', Boolean(undone));
  if (undone) {
    record('撤销后单选按钮回到未选中', undone.gender === '');
    record('撤销后受控组件 state 同步清空', undone.emailState === '');
  }

  // 8. 选项页（简历管理）
  if (!extId) {
    record('选项页可以打开', false, '扩展未加载，跳过');
  } else {
    await browser.send('Target.createTarget', {
      url: `chrome-extension://${extId}/options/options.html`
    });
    await delay(1800);

    const optsTarget = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(
      (t) => t.type === 'page' && t.url.includes('/options/options.html')
    );

    if (!optsTarget) {
      record('选项页可以打开', false, '未找到 options 页面目标');
    } else {
      const opts = await connect(optsTarget.webSocketDebuggerUrl);
      await opts.send('Runtime.enable');
      await delay(600);
      const probe = await opts.eval(`(() => {
        const items = [...document.querySelectorAll('#resume-list li')].map(li => li.textContent.trim());
        const fields = document.querySelectorAll('#form-area .field').length;
        const nameValue = (document.getElementById('resume-name-input') || {}).value;
        const groups = [...document.querySelectorAll('#group-list li')].map(li => li.textContent.trim());
        return { items, fields, nameValue, groups };
      })()`);
      record('选项页渲染出简历列表', probe.items.length >= 1, probe.items.join(' / '));
      record('选项页按 schema 生成字段表单', probe.fields >= 10, `基本信息分组生成了 ${probe.fields} 个字段`);
      record('选项页显示分组导航', probe.groups.length >= 8, `${probe.groups.length} 个分组`);
      record('简历名称正确载入', String(probe.nameValue).includes('示例简历'), probe.nameValue);
    }
  }

  // 9. 弹窗页（popup）：在后台标签打开，激活夹具页后点它的「一键填写」
  if (extId) {
    let popupTargetId = null;
    try {
      const created = await browser.send('Target.createTarget', {
        url: `chrome-extension://${extId}/popup/popup.html`,
        background: true
      });
      popupTargetId = created.targetId;
    } catch (err) {
      record('弹窗页可以打开', false, err.message);
    }

    if (popupTargetId) {
      await delay(1500);
      // 把测试页切到前台，这样 popup 里的 chrome.tabs.query({active:true}) 才能拿到它
      await browser.send('Target.activateTarget', { targetId: pageTarget.id });
      await delay(600);

      const popupPage = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(
        (t) => t.type === 'page' && t.url.includes('/popup/popup.html')
      );
      if (!popupPage) {
        record('弹窗页可以打开', false, '未找到 popup 页面目标');
      } else {
        const popup = await connect(popupPage.webSocketDebuggerUrl);
        await popup.send('Runtime.enable');
        await delay(500);

        const summary = await popup.eval(`(() => ({
          name: document.getElementById('resume-name').textContent,
          rows: [...document.querySelectorAll('.summary dd')].map(d => d.textContent),
          toggles: {
            onlyEmpty: document.getElementById('set-only-empty').checked,
            highlight: document.getElementById('set-highlight').checked,
            float: document.getElementById('set-float').checked
          }
        }))()`);
        record('弹窗页显示当前简历名称', String(summary.name).includes('示例简历'), summary.name);
        record(
          '弹窗页显示关键字段摘要',
          summary.rows.includes('示例姓名') && summary.rows.includes('13800000000'),
          summary.rows.join(' / ')
        );
        record(
          '弹窗页开关默认值正确（只填空白/高亮/悬浮按钮均开启）',
          summary.toggles.onlyEmpty && summary.toggles.highlight && summary.toggles.float
        );

        // 切换设置 → 验证会落盘
        await popup.eval(
          `(async () => { const el = document.getElementById('set-highlight'); el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
        );
        await delay(600);
        const saved = await popup.eval(
          `new Promise(r => chrome.storage.local.get('ra_settings', d => r(d.ra_settings.highlight)))`
        );
        record('弹窗页开关改动会写入本地设置', saved === false, `highlight=${saved}`);
        // 改回来，避免影响后续
        await popup.eval(
          `(async () => { const el = document.getElementById('set-highlight'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
        );
        await delay(400);

        // 点弹窗里的「一键填写当前页面」
        const popupFill = await popup.eval(`(() => {
          const b = document.getElementById('btn-fill');
          if (!b) return 'NO_BUTTON';
          b.click();
          return 'CLICKED';
        })()`);
        record('弹窗页「一键填写」按钮可点击', popupFill === 'CLICKED', popupFill);

        const refilled = await waitUntil(
          async () => {
            const v = await page.eval('window.__readValues()');
            return v.name === '示例姓名' && v.school === '示例大学' && v.city === '示例城市' ? v : null;
          },
          30000,
          500
        );
        record('从弹窗触发的填充同样生效（含 iframe 与自定义下拉）', Boolean(refilled));

        // 弹窗的状态文案要等后台汇总返回后才更新，这里轮询等它落定
        const popupStatus = await waitUntil(
          async () => {
            const text = await popup.eval("document.getElementById('status').textContent");
            return /成功|失败/.test(text) ? text : null;
          },
          20000,
          400
        );
        record('弹窗页显示填充结果统计', Boolean(popupStatus), String(popupStatus || '').slice(0, 70));
      }
    }
  }

  printSummary();
  await shutdown(results.some((r) => !r.pass) ? 1 : 0);
})().catch((err) => {
  console.error('测试执行异常：', err);
  printSummary();
  shutdown(1);
});

/** 关掉所有 CDP 连接再退出，避免 Node 退出时 ws 句柄未释放 */
async function shutdown(code) {
  for (const ws of sockets) {
    try {
      ws.close();
    } catch {
      /* 忽略 */
    }
  }
  process.exitCode = code;
}
