/**
 * popup.js —— 弹窗逻辑：展示当前简历摘要、开关设置、触发填充
 *
 * 填充一定走 background：只有它能广播到页面里的所有 iframe。
 */
(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const statusEl = $('status');
  const fillBtn = $('btn-fill');

  const setStatus = (text, kind = '') => {
    statusEl.textContent = text;
    statusEl.className = `status ${kind}`;
  };

  /* ---------------- 摘要 ---------------- */

  function renderSummary(resume) {
    const summary = $('summary');
    $('resume-name').textContent = resume ? resume.name : '尚未创建简历';
    summary.innerHTML = '';

    if (!resume) {
      summary.textContent = '点击下方「管理简历」先录入一份简历信息。';
      return;
    }

    const basic = resume.data.basic || {};
    const job = resume.data.job || {};
    const rows = [
      ['姓名', basic.name],
      ['手机号', basic.phone],
      ['邮箱', basic.email],
      ['期望职位', job.expectedPosition]
    ];

    const dl = document.createElement('dl');
    for (const [key, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = key; // 身份证号等敏感字段这里刻意不展示
      const dd = document.createElement('dd');
      dd.textContent = value || '未填写';
      dl.append(dt, dd);
    }
    summary.appendChild(dl);
  }

  /* ---------------- 设置 ---------------- */

  async function initSettings() {
    const settings = await RA.Store.getSettings();
    $('set-only-empty').checked = settings.onlyEmpty;
    $('set-highlight').checked = settings.highlight;
    $('set-float').checked = settings.showFloatButton;

    const bind = (id, key) =>
      $(id).addEventListener('change', async (e) => {
        await RA.Store.updateSettings({ [key]: e.target.checked });
      });

    bind('set-only-empty', 'onlyEmpty');
    bind('set-highlight', 'highlight');
    bind('set-float', 'showFloatButton');
  }

  /* ---------------- 触发填充 ---------------- */

  fillBtn.addEventListener('click', async () => {
    fillBtn.disabled = true;
    setStatus('正在识别表单字段…');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('找不到当前标签页');

      const res = await chrome.runtime.sendMessage({ type: 'RA_START', action: 'fill', tabId: tab.id });
      if (!res || !res.ok) throw new Error((res && res.error) || '后台无响应');

      const { ok, skipped, failed } = res.aggregate;
      setStatus(
        `成功 ${ok} 个 · 跳过 ${skipped} 个 · 失败 ${failed} 个。详细结果请看页面右上角面板。`,
        failed ? 'error' : 'success'
      );
    } catch (err) {
      setStatus(`填充失败：${(err && err.message) || err}`, 'error');
    } finally {
      fillBtn.disabled = false;
    }
  });

  $('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  /* ---------------- 初始化 ---------------- */

  await RA.Store.ensureInitialized();
  renderSummary(await RA.Store.getActiveResume());
  await initSettings();
})();
