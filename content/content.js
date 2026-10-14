/**
 * content.js —— 悬浮按钮 + 填充调度 + 结果面板
 *
 * 运行位置：所有框架（all_frames: true）。每个框架各管自己 DOM 里的表单，
 * 跨域 iframe 拿不到 DOM，只能靠 background 广播消息来协同。
 *
 * 消息协议（与 background.js 约定）：
 *   页面 → 后台   RA_START      { action: 'fill' | 'undo', tabId }
 *   后台 → 各框架 RA_DO_FILL / RA_DO_UNDO  { requestId }
 *   各框架 → 后台 RA_FRAME_REPORT          { requestId, report }
 *   后台 → 各框架 RA_DONE                  { aggregate }（只有顶层框架会渲染面板）
 */
(() => {
  'use strict';

  if (window.__RA_LOADED__) return;
  window.__RA_LOADED__ = true;

  const IS_TOP = window.top === window;
  const sleep = RA.Filler.sleep;

  /** 本框架上一次填充的撤销快照 */
  let lastSnapshots = [];

  /* ================================================================== *
   * 一、Shadow DOM 界面（按钮 + 结果面板）
   * ================================================================== */

  const UI_STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    .btn {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 16px;
      font: 500 14px/1.2 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      color: #fff; white-space: nowrap;
      background: linear-gradient(135deg, #4f6bff 0%, #2f4ce0 100%);
      border: none; border-radius: 999px;
      box-shadow: 0 6px 18px rgba(47, 76, 224, 0.35), 0 2px 6px rgba(0, 0, 0, 0.12);
      cursor: pointer; pointer-events: auto;
      transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
    }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(47,76,224,.45); }
    .btn:active { transform: translateY(0) scale(0.98); }
    .btn.busy { opacity: .7; cursor: progress; }
    .btn .icon { font-size: 15px; }

    .toast {
      margin-top: 8px; max-width: 280px; padding: 8px 12px;
      font: 400 13px/1.5 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      color: #fff; background: rgba(28,28,30,.92);
      border-radius: 10px; box-shadow: 0 8px 22px rgba(0,0,0,.28);
      opacity: 0; transform: translateY(6px);
      transition: opacity .2s ease, transform .2s ease;
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    .panel {
      width: 340px; max-height: 60vh; overflow: auto;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,.16);
      font: 400 13px/1.6 "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      color: #1c1c1e; pointer-events: auto;
    }
    .panel-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 10px 12px; border-bottom: 1px solid #f0f1f3;
      position: sticky; top: 0; background: #fff;
    }
    .panel-title { font-weight: 600; }
    .panel-close {
      border: none; background: transparent; font-size: 16px; line-height: 1;
      cursor: pointer; color: #6b7280; padding: 2px 6px;
    }
    .panel-body { padding: 10px 12px; }
    .stat { display: flex; gap: 12px; margin-bottom: 8px; }
    .stat b { font-size: 15px; }
    .ok { color: #16a34a; } .warn { color: #d97706; } .bad { color: #dc2626; }

    .list { margin: 6px 0 0; padding: 0; list-style: none; max-height: 30vh; overflow: auto; }
    .list li {
      display: flex; gap: 8px; padding: 4px 0;
      border-bottom: 1px dashed #f0f1f3; align-items: baseline;
    }
    .list li:last-child { border-bottom: none; }
    .list .k { color: #6b7280; flex: 0 0 auto; }
    .list .v { flex: 1; word-break: break-all; }

    .panel-foot {
      display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #f0f1f3;
      position: sticky; bottom: 0; background: #fff;
    }
    .mini {
      flex: 1; padding: 7px 10px; font: inherit; font-size: 13px;
      border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; cursor: pointer;
    }
    .mini:hover { background: #f4f5f7; }
    .mini.primary { background: #2f4ce0; border-color: #2f4ce0; color: #fff; }
    .mini.primary:hover { background: #2740bf; }

    .hint { color: #6b7280; font-size: 12px; margin-top: 6px; }
  `;

  let host = null;
  let shadow = null;
  let btnEl = null;
  let toastEl = null;
  let panelEl = null;
  let toastTimer = 0;

  function buildUI() {
    host = document.createElement('div');
    host.id = 'ra-float-host';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = UI_STYLE;

    const wrap = document.createElement('div');
    wrap.setAttribute('part', 'wrap');

    // 悬浮按钮（用 pointer 事件实现拖动，不依赖页面任何样式）
    btnEl = document.createElement('button');
    btnEl.type = 'button';
    btnEl.className = 'btn';
    btnEl.id = 'ra-fill-btn';
    btnEl.innerHTML = '<span class="icon">📝</span><span class="label">一键填写简历</span>';

    toastEl = document.createElement('div');
    toastEl.className = 'toast';

    panelEl = document.createElement('div');
    panelEl.className = 'panel';
    panelEl.hidden = true;

    wrap.append(btnEl, toastEl, panelEl);
    shadow.append(style, wrap);

    // 挂在 documentElement 而不是 body：不少单页应用会整个替换 body
    document.documentElement.appendChild(host);

    bindDrag();
    btnEl.addEventListener('click', () => {
      if (host.dataset.dragged === '1') return; // 刚拖动过，不算点击
      startFill();
    });
  }

  /** 拖动 + 位置记忆 */
  function bindDrag() {
    let drag = null;

    btnEl.addEventListener('pointerdown', (e) => {
      const rect = host.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom, moved: false };
      host.dataset.dragged = '0';
      btnEl.setPointerCapture(e.pointerId);
    });

    btnEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;

      drag.moved = true;
      host.dataset.dragged = '1';
      host.classList.add('ra-dragging');

      const right = Math.min(Math.max(drag.right - dx, 8), window.innerWidth - 60);
      const bottom = Math.min(Math.max(drag.bottom - dy, 8), window.innerHeight - 40);
      host.style.setProperty('right', `${right}px`, 'important');
      host.style.setProperty('bottom', `${bottom}px`, 'important');
    });

    btnEl.addEventListener('pointerup', async () => {
      if (!drag) return;
      host.classList.remove('ra-dragging');
      if (drag.moved) {
        const rect = host.getBoundingClientRect();
        await RA.Store.updateSettings({
          floatPos: {
            right: Math.round(window.innerWidth - rect.right),
            bottom: Math.round(window.innerHeight - rect.bottom)
          }
        });
      }
      // 让 click 事件先跑完再复位「刚拖动过」的标记
      setTimeout(() => {
        host.dataset.dragged = '0';
      }, 50);
      drag = null;
    });
  }

  function showToast(text, duration = 2600) {
    toastEl.textContent = text;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
  }

  /* ================================================================== *
   * 二、结果面板
   * ================================================================== */

  const MASKED_FIELDS = new Set(['idCard', 'emergencyPhone']); // 极敏感字段不回显明文

  function displayValue(field, value) {
    if (MASKED_FIELDS.has(field.key)) {
      const s = String(value);
      return s.length > 6 ? `${s.slice(0, 3)}****${s.slice(-2)}` : '****';
    }
    return String(value).length > 40 ? `${String(value).slice(0, 40)}…` : String(value);
  }

  function renderPanel(aggregate, action) {
    const isUndo = action === 'undo';
    const { ok, skipped, failed, details, frames } = aggregate;

    const okList = details.filter((d) => d.status === 'ok');
    const skipList = details.filter((d) => d.status === 'skipped');
    const failList = details.filter((d) => d.status === 'failed');

    panelEl.hidden = false;
    panelEl.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = isUndo ? '已撤销本次填充' : '填写结果';
    const close = document.createElement('button');
    close.className = 'panel-close';
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', () => {
      panelEl.hidden = true;
    });
    head.append(title, close);

    const body = document.createElement('div');
    body.className = 'panel-body';

    if (isUndo) {
      body.innerHTML = `<div class="stat"><span class="ok">已还原 <b>${ok}</b> 个字段</span></div>
        <div class="hint">页面回到填充前的状态。</div>`;
    } else {
      const stat = document.createElement('div');
      stat.className = 'stat';
      stat.innerHTML = `
        <span class="ok">成功 <b>${ok}</b></span>
        <span class="warn">跳过 <b>${skipped}</b></span>
        <span class="bad">失败 <b>${failed}</b></span>`;
      body.appendChild(stat);

      if (frames > 1) {
        const fh = document.createElement('div');
        fh.className = 'hint';
        fh.textContent = `本次共扫描 ${frames} 个框架（含页面内嵌 iframe 表单）`;
        body.appendChild(fh);
      }

      const buildList = (items, className) => {
        if (!items.length) return;
        const ul = document.createElement('ul');
        ul.className = `list ${className}`;
        for (const item of items) {
          const li = document.createElement('li');
          const k = document.createElement('span');
          k.className = 'k';
          k.textContent = item.label;
          const v = document.createElement('span');
          v.className = 'v';
          v.textContent = item.status === 'ok' ? displayValue(item, item.value) : item.reason;
          li.append(k, v);
          ul.appendChild(li);
        }
        body.appendChild(ul);
      };

      buildList(okList.slice(0, 40), 'ok-list');
      buildList(skipList.slice(0, 20), 'skip-list');
      buildList(failList.slice(0, 20), 'fail-list');

      if (!details.length) {
        const empty = document.createElement('div');
        empty.className = 'hint';
        empty.textContent = '没有识别到可填写的字段。可以先展开表单全部内容再试一次。';
        body.appendChild(empty);
      } else {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = '结果仅供参考，提交前请人工核对一遍。';
        body.appendChild(hint);
      }
    }

    const foot = document.createElement('div');
    foot.className = 'panel-foot';

    if (!isUndo && ok > 0) {
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'mini primary';
      undoBtn.textContent = '撤销本次填充';
      undoBtn.addEventListener('click', () => startAction('undo'));
      foot.appendChild(undoBtn);
    }

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'mini';
    retryBtn.textContent = '再填一次';
    retryBtn.addEventListener('click', () => startAction('fill'));
    foot.appendChild(retryBtn);

    panelEl.append(head, body, foot);
  }

  /* ================================================================== *
   * 三、本框架内的填充 / 撤销
   * ================================================================== */

  async function fillThisFrame() {
    const [resume, settings] = await Promise.all([RA.Store.getActiveResume(), RA.Store.getSettings()]);
    if (!resume) return { url: location.href, matched: 0, details: [] };

    const assignments = RA.Matcher.match(resume, document);
    const { results, snapshots } = await RA.Filler.fillAll(assignments, {
      onlyEmpty: settings.onlyEmpty,
      highlight: settings.highlight
    });
    lastSnapshots = snapshots;

    return {
      url: location.href,
      matched: assignments.length,
      details: results.map((r) => ({
        key: r.field.key,
        label: r.field.label,
        status: r.status,
        value: r.value,
        applied: r.applied,
        reason: r.reason
      }))
    };
  }

  async function undoThisFrame() {
    const count = await RA.Filler.undo(lastSnapshots);
    lastSnapshots = [];
    return { url: location.href, details: Array.from({ length: count }, () => ({ status: 'ok' })) };
  }

  /** 向后台发请求，由后台广播到所有框架并汇总结果 */
  async function startAction(action) {
    if (action === 'fill') {
      btnEl.classList.add('busy');
      showToast('正在识别表单字段…', 1500);
    }

    try {
      const res = await chrome.runtime.sendMessage({ type: 'RA_START', action });
      if (!res || !res.ok) {
        showToast(`操作失败：${(res && res.error) || '后台无响应'}`);
        return;
      }
      if (IS_TOP && res.aggregate) renderPanel(res.aggregate, action);
    } catch (err) {
      showToast(`操作失败：${err && err.message ? err.message : err}`);
    } finally {
      btnEl.classList.remove('busy');
    }
  }

  const startFill = () => startAction('fill');

  /* ================================================================== *
   * 四、消息处理
   * ================================================================== */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;

    if (message.type === 'RA_DO_FILL') {
      // 先报到：让后台知道本轮有几个框架参与，避免它提前收尾导致结果漏报
      chrome.runtime.sendMessage({ type: 'RA_FRAME_START', requestId: message.requestId });
      fillThisFrame()
        .then((report) => {
          chrome.runtime.sendMessage({ type: 'RA_FRAME_REPORT', requestId: message.requestId, report });
          sendResponse({ ok: true });
        })
        .catch((err) => {
          chrome.runtime.sendMessage({
            type: 'RA_FRAME_REPORT',
            requestId: message.requestId,
            report: { url: location.href, error: String((err && err.message) || err), details: [] }
          });
          sendResponse({ ok: false, error: String(err) });
        });
      return true;
    }

    if (message.type === 'RA_DO_UNDO') {
      undoThisFrame()
        .then((report) => {
          chrome.runtime.sendMessage({ type: 'RA_FRAME_REPORT', requestId: message.requestId, report });
          sendResponse({ ok: true });
        })
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    return false;
  });

  /* ================================================================== *
   * 五、启动
   * ================================================================== */

  async function bootstrap() {
    const settings = await RA.Store.getSettings();
    if (settings.floatPos) {
      host.style.setProperty('right', `${settings.floatPos.right}px`, 'important');
      host.style.setProperty('bottom', `${settings.floatPos.bottom}px`, 'important');
    }
    btnEl.style.display = settings.showFloatButton ? '' : 'none';
    // 设置变化（比如用户在弹窗里关闭了悬浮按钮）时实时生效
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.ra_settings) return;
      const next = changes.ra_settings.newValue || {};
      btnEl.style.display = next.showFloatButton === false ? 'none' : '';
    });
  }

  // 只有顶层框架才显示悬浮按钮，避免每个 iframe 都冒出一个按钮
  if (IS_TOP) {
    const mount = () => {
      if (document.documentElement && !document.getElementById('ra-float-host')) buildUI();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();

    // 页面被框架整体重绘时补回按钮
    new MutationObserver(() => {
      if (!document.getElementById('ra-float-host')) buildUI();
    }).observe(document.documentElement, { childList: true });

    bootstrap().catch(() => {});
  }
})();
