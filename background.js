/**
 * background.js —— Service Worker
 *
 * 职责：
 *   1) 接收页面/弹窗发起的「填充」「撤销」请求；
 *   2) 把请求广播到该标签页下的所有框架（跨域 iframe 只能这样触达）；
 *   3) 收集各框架回报的结果并汇总，回给发起方，同时广播给顶层框架渲染面板；
 *   4) 兜底注入：扩展刚安装/刚更新时，老页面里还没有内容脚本，这里补一次。
 */

const AGGREGATE_GRACE_MS = 500; // 所有框架都回报完之后，再留一点收尾缓冲
const AGGREGATE_START_MS = 2000; // 等第一个框架「报到」的时限（超时说明页面里没有可用内容脚本）
const AGGREGATE_MAX_MS = 15000; // 整体上限，防止某个框架卡死不返回
const MAX_DETAILS = 80; // 汇总面板最多回传多少条明细

/** 进行中的请求：requestId → { timer, ... } */
const pending = new Map();

/* ------------------------------------------------------------------ *
 * 内容脚本兜底注入
 * ------------------------------------------------------------------ */

const CONTENT_FILES = [
  'common/schema.js',
  'common/storage.js',
  'content/matcher.js',
  'content/filler.js',
  'content/content.js'
];

/** 页面是扩展安装前就打开的，内容脚本可能不在，这里补注入（脚本内部有防重复守卫） */
async function ensureInjected(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: ['content/content.css'] });
  } catch {
    /* CSS 重复注入或框架不允许时忽略 */
  }
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_FILES
  });
}

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

function emptyAggregate() {
  return { ok: 0, skipped: 0, failed: 0, frames: 0, details: [] };
}

function finish(requestId) {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  clearTimeout(entry.grace);
  clearTimeout(entry.startTimer);
  clearTimeout(entry.deadline);

  const aggregate = entry.aggregate;

  // 广播给所有框架：只有顶层框架会真正渲染结果面板
  chrome.tabs
    .sendMessage(entry.tabId, { type: 'RA_DONE', requestId, action: entry.action, aggregate })
    .catch(() => {
      /* 没有接收者（页面已关闭）时忽略 */
    });

  if (entry.resolve) entry.resolve(aggregate);
}

/**
 * 所有已报到的框架都回报完了 → 安排收尾。
 * 这里必须按「报到的框架数」来判断，不能只按固定超时：
 * 顶层框架填 17 个字段要好几秒，iframe 只要几百毫秒，
 * 固定超时会在顶层还没填完时就收尾，导致结果面板漏报、用户以为没填上。
 */
function scheduleFinish(requestId) {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.grace);
  entry.grace = setTimeout(() => finish(requestId), AGGREGATE_GRACE_MS);
}

/** 框架报到：收到广播后立刻上报，让后台知道「这一轮有几个框架参与」 */
function handleFrameStart(message) {
  const entry = pending.get(message.requestId);
  if (!entry) return false;
  entry.started += 1;
  clearTimeout(entry.startTimer);
  if (entry.received >= entry.started) scheduleFinish(message.requestId);
  return true;
}

/** 各框架回报结果 */
function handleFrameReport(message) {
  const entry = pending.get(message.requestId);
  if (!entry) return false;

  const report = message.report || {};
  entry.received += 1;
  entry.aggregate.frames += 1;

  if (report.error) {
    entry.aggregate.failed += 1;
    if (entry.aggregate.details.length < MAX_DETAILS) {
      entry.aggregate.details.push({
        key: 'frame',
        label: '框架',
        status: 'failed',
        value: '',
        reason: `该框架处理失败：${report.error}`
      });
    }
  }

  for (const item of report.details || []) {
    const label = item.label || (RA_FIELD_LABEL[item.key] || item.key || '字段');
    if (item.status === 'ok') entry.aggregate.ok += 1;
    else if (item.status === 'skipped') entry.aggregate.skipped += 1;
    else if (item.status === 'failed') entry.aggregate.failed += 1;
    else continue;

    if (entry.aggregate.details.length < MAX_DETAILS) {
      entry.aggregate.details.push({ ...item, label });
    }
  }

  if (entry.received >= entry.started) scheduleFinish(message.requestId);
  return true;
}

/**
 * 汇总面板里的字段中文名由各框架自己带过来（item.label）。
 * 这里保留一份极简兜底表，仅用于个别框架未上报 label 的情况。
 */
const RA_FIELD_LABEL = {
  name: '姓名',
  phone: '手机号',
  email: '邮箱',
  school: '学校',
  company: '公司名称'
};

/* ------------------------------------------------------------------ *
 * 发起一次填充 / 撤销
 * ------------------------------------------------------------------ */

async function startAction(tabId, action) {
  if (!tabId) throw new Error('找不到目标标签页');

  // 兜底注入：失败通常是因为当前页面是 chrome:// 或扩展商店等受保护页面
  try {
    await ensureInjected(tabId);
  } catch (err) {
    throw new Error(`当前页面无法注入脚本（浏览器内置页面或受保护页面不支持）：${err.message}`);
  }

  const requestId = `ra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const aggregatePromise = new Promise((resolve) => {
    pending.set(requestId, {
      tabId,
      action,
      aggregate: emptyAggregate(),
      resolve,
      started: 0,
      received: 0,
      grace: 0,
      startTimer: setTimeout(() => finish(requestId), AGGREGATE_START_MS),
      deadline: setTimeout(() => finish(requestId), AGGREGATE_MAX_MS)
    });
  });

  // 不带 frameId 时会发送到该标签页的所有框架（含跨域 iframe）
  chrome.tabs
    .sendMessage(tabId, { type: action === 'undo' ? 'RA_DO_UNDO' : 'RA_DO_FILL', requestId })
    .catch(() => {
      /* 至少顶层框架会有响应，其余忽略 */
    });

  return aggregatePromise;
}

/* ------------------------------------------------------------------ *
 * 消息路由
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === 'RA_FRAME_REPORT') {
    handleFrameReport(message);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'RA_FRAME_START') {
    handleFrameStart(message);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'RA_START') {
    const tabId = message.tabId || (sender.tab && sender.tab.id);
    startAction(tabId, message.action || 'fill')
      .then((aggregate) => sendResponse({ ok: true, aggregate }))
      .catch((err) => sendResponse({ ok: false, error: (err && err.message) || String(err) }));
    return true; // 异步响应
  }

  if (message.type === 'RA_PING') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

/** 扩展安装 / 更新后给用户一个明确指引 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?welcome=1') });
  }
});
