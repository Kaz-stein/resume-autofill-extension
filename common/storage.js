/**
 * storage.js —— 数据存取封装（选项页 / 弹窗页 / 内容脚本共用）
 *
 * 存储结构：
 *   ra_resumes     [{ id, name, updatedAt, data }]
 *   ra_active_id   当前激活简历的 id
 *   ra_settings    { onlyEmpty, highlight, showFloatButton, floatPos }
 *
 * 全部数据只落在 chrome.storage.local，不发起任何网络请求。
 */
(function () {
  'use strict';
  const RA = (globalThis.RA = globalThis.RA || {});

  const KEY_RESUMES = 'ra_resumes';
  const KEY_ACTIVE = 'ra_active_id';
  const KEY_SETTINGS = 'ra_settings';

  const DEFAULT_SETTINGS = {
    onlyEmpty: true, // 只填充空白字段，不覆盖已有内容
    highlight: true, // 填充后高亮刚填的字段
    showFloatButton: true, // 页面右下角显示悬浮按钮
    floatPos: null // { right, bottom } 拖动后的位置
  };

  /* ------------------------- 基础读写 ------------------------- */

  const get = (keys) =>
    new Promise((resolve) => chrome.storage.local.get(keys, (data) => resolve(data || {})));

  const set = (items) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        const err = chrome.runtime.lastError;
        err ? reject(new Error(err.message)) : resolve();
      });
    });

  /** 输入防抖：选项页自动保存用 */
  function debounce(fn, wait = 500) {
    let timer = 0;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* ------------------------- 简历读写 ------------------------- */

  /** 首次使用时初始化示例数据 */
  async function ensureInitialized() {
    const data = await get([KEY_RESUMES, KEY_ACTIVE]);
    if (Array.isArray(data[KEY_RESUMES]) && data[KEY_RESUMES].length) {
      return { resumes: data[KEY_RESUMES], activeId: data[KEY_ACTIVE] || data[KEY_RESUMES][0].id };
    }
    const sample = RA.createSampleResume();
    await set({ [KEY_RESUMES]: [sample], [KEY_ACTIVE]: sample.id });
    return { resumes: [sample], activeId: sample.id };
  }

  const getResumes = async () => {
    const data = await get(KEY_RESUMES);
    return Array.isArray(data[KEY_RESUMES]) ? data[KEY_RESUMES] : [];
  };

  const getActiveId = async () => {
    const data = await get(KEY_ACTIVE);
    return data[KEY_ACTIVE] || null;
  };

  /** 取当前激活的简历（内容脚本和弹窗页都靠它拿填充数据） */
  async function getActiveResume() {
    const { resumes, activeId } = await ensureInitialized();
    return resumes.find((r) => r.id === activeId) || resumes[0] || null;
  }

  async function saveResume(resume) {
    const resumes = await getResumes();
    const index = resumes.findIndex((r) => r.id === resume.id);
    const next = { ...resume, updatedAt: Date.now() };
    if (index >= 0) resumes[index] = next;
    else resumes.push(next);
    await set({ [KEY_RESUMES]: resumes });
    return next;
  }

  async function deleteResume(id) {
    const resumes = (await getResumes()).filter((r) => r.id !== id);
    const activeId = (await getActiveId()) === id ? null : await getActiveId();
    await set({ [KEY_RESUMES]: resumes, [KEY_ACTIVE]: activeId || (resumes[0] && resumes[0].id) || null });
    return resumes;
  }

  async function setActiveId(id) {
    await set({ [KEY_ACTIVE]: id });
  }

  /** 新建空白简历时，用一份字段结构完整但值为空的对象，避免到处判空 */
  function createEmptyResumeData() {
    const data = {};
    for (const group of RA.GROUPS) {
      if (group.repeatable) {
        const item = {};
        for (const field of RA.fieldsOfGroup(group.id)) item[field.key] = '';
        data[group.id] = [item];
      } else {
        const item = {};
        for (const field of RA.fieldsOfGroup(group.id)) item[field.key] = '';
        data[group.id] = item;
      }
    }
    return data;
  }

  /* ------------------------- 设置 ------------------------- */

  async function getSettings() {
    const data = await get(KEY_SETTINGS);
    return { ...DEFAULT_SETTINGS, ...(data[KEY_SETTINGS] || {}) };
  }

  async function updateSettings(patch) {
    const next = { ...(await getSettings()), ...patch };
    await set({ [KEY_SETTINGS]: next });
    return next;
  }

  /* ------------------------- 导入导出 ------------------------- */

  function exportToFile(resumes, activeId) {
    const payload = {
      type: 'resume-autofill-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeId,
      resumes
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    chrome.downloads.download({ url, filename: `简历备份_${stamp}.json`, saveAs: true }, () => {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
  }

  /** 解析导入的 JSON，兼容「直接是数组」和「带 envelopes 的备份文件」两种形态 */
  function parseImport(text) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed.resumes;
    if (!Array.isArray(list) || !list.length) throw new Error('文件中没有找到简历数据');
    return list
      .filter((item) => item && item.data)
      .map((item) => ({
        id: item.id || `resume_${Math.random().toString(36).slice(2, 10)}`,
        name: item.name || '导入的简历',
        updatedAt: Date.now(),
        data: item.data
      }));
  }

  RA.Store = {
    DEFAULT_SETTINGS,
    debounce,
    ensureInitialized,
    getResumes,
    getActiveId,
    getActiveResume,
    saveResume,
    deleteResume,
    setActiveId,
    createEmptyResumeData,
    getSettings,
    updateSettings,
    exportToFile,
    parseImport
  };
})();
