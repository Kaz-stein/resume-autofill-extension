/**
 * filler.js —— 填充执行器
 *
 * 这是整个插件最容易踩坑的地方，核心原则有三条：
 *   1) 绝不直接写 element.value —— React / Vue 的受控组件不会同步 state，
 *      表现就是「页面上看着填上了，提交时是空的」。必须走原生 setter 再派发事件。
 *   2) 能用 click 的场景就用 click（单选框、复选框），让页面自己的逻辑跑起来。
 *   3) 填完必须回读校验，不一致就如实报告失败，不要假装成功。
 */
(function () {
  'use strict';
  const RA = (globalThis.RA = globalThis.RA || {});

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* ------------------------------------------------------------------ *
   * 原生 setter：React 受控组件的正确打开方式
   * ------------------------------------------------------------------ */

  function setNativeValue(element, value) {
    const proto =
      element.tagName.toLowerCase() === 'textarea'
        ? HTMLTextAreaElement.prototype
        : element.tagName.toLowerCase() === 'select'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      // 关键点：绕过页面（React/Vue）在实例上挂的 value setter，直接写原型上的原生 setter
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
  }

  /** 依次派发 input / change / blur，让页面的校验与状态同步逻辑全部跑一遍 */
  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
  }

  /* ------------------------------------------------------------------ *
   * 值格式化
   * ------------------------------------------------------------------ */

  const normalizePhone = (value) => String(value).replace(/[\s\-()]/g, '').replace(/^\+?86/, '');

  /** 日期字段准备多种写法，按输入框的 placeholder 优先选最像的那种 */
  function dateVariants(value) {
    const raw = String(value).trim();
    const m = raw.match(/^(\d{4})[-/年.]?(\d{1,2})?[-/月.]?(\d{1,2})?/);
    if (!m) return [raw];

    const [, y, mo, d] = m;
    const MM = mo ? String(mo).padStart(2, '0') : '';
    const DD = d ? String(d).padStart(2, '0') : '';
    const variants = [];

    if (MM && DD) {
      variants.push(`${y}-${MM}-${DD}`, `${y}/${MM}/${DD}`, `${y}年${Number(mo)}月${Number(d)}日`);
    }
    if (MM) variants.push(`${y}-${MM}`, `${y}/${MM}`, `${y}年${Number(mo)}月`);
    variants.push(y, raw);

    // 已经是标准格式的原值放最前面（例如「至今」这类非日期文本）
    if (!variants.includes(raw)) variants.unshift(raw);
    return Array.from(new Set(variants));
  }

  /** 按输入框类型做最终取值 */
  function formatValue(element, field, value) {
    if (field.type === 'tel') return normalizePhone(value);
    if (element.type === 'number') {
      const num = String(value).replace(/[^\d.]/g, '');
      return num || String(value);
    }
    return value;
  }

  /* ------------------------------------------------------------------ *
   * 各类控件的填充
   * ------------------------------------------------------------------ */

  /** 文本类：input / textarea / contenteditable */
  async function fillText(element, value) {
    const text = String(value);
    element.focus();

    if (element.isContentEditable) {
      element.textContent = text;
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    } else {
      setNativeValue(element, text);
      dispatchInputEvents(element);
    }

    element.blur();
    await sleep(20);

    const current = element.isContentEditable ? element.textContent : element.value;
    // 有些输入框会自动格式化（去空格、转小写），这里做宽松比较
    const ok =
      String(current).trim() === text.trim() ||
      String(current).replace(/\s/g, '') === text.replace(/\s/g, '');
    return { ok, applied: current, reason: ok ? '' : `回读不一致（实际为「${String(current).slice(0, 20)}」）` };
  }

  /** 日期字段：逐个尝试格式变体，直到回读成功 */
  async function fillDate(element, value) {
    if (element.type === 'date') {
      const iso = String(value).match(/^(\d{4})[-/](\d{1,2})[-/]?(\d{1,2})?/);
      const normalized = iso
        ? `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3] || '01').padStart(2, '0')}`
        : value;
      const result = await fillText(element, normalized);
      if (result.ok) return result;
    }

    const variants = dateVariants(value);
    // placeholder 里出现哪种分隔符，就优先试哪种
    const hint = element.getAttribute('placeholder') || '';
    if (hint.includes('/')) variants.sort((a, b) => (b.includes('/') ? 1 : 0) - (a.includes('/') ? 1 : 0));
    if (hint.includes('年')) variants.sort((a, b) => (b.includes('年') ? 1 : 0) - (a.includes('年') ? 1 : 0));

    let last = { ok: false, applied: '', reason: '未找到可用格式' };
    for (const variant of variants) {
      last = await fillText(element, variant);
      if (last.ok) return last;
    }
    return last;
  }

  /** 原生 select：value 精确 → 文本精确 → 文本包含 */
  async function fillSelect(element, value) {
    const target = String(value).trim();
    const options = Array.from(element.options);

    let hit =
      options.find((o) => o.value === target) ||
      options.find((o) => o.textContent.trim() === target) ||
      options.find((o) => o.textContent.trim().includes(target) || target.includes(o.textContent.trim()));

    if (!hit) return { ok: false, applied: '', reason: '该下拉框没有匹配的选项' };

    element.focus();
    element.value = hit.value;
    dispatchInputEvents(element);
    element.blur();
    await sleep(20);

    const ok = element.value === hit.value;
    return { ok, applied: hit.textContent.trim(), reason: ok ? '' : '下拉框未接受该选项' };
  }

  /** 单选 / 复选框：按 value 或 label 文本找到那个选项，用 click 触发 */
  async function fillChoice(members, value) {
    const target = String(value).trim();

    const textOf = (input) => {
      const label = input.closest('label');
      return [input.value, label && label.textContent].filter(Boolean).join(' ').trim();
    };

    const hit =
      members.find((i) => String(i.value).trim() === target) ||
      members.find((i) => textOf(i).includes(target)) ||
      members.find((i) => target.includes(String(i.value).trim()) && String(i.value).trim().length >= 2);

    if (!hit) return { ok: false, applied: '', reason: '该选项组没有匹配项' };

    hit.click();
    await sleep(30);

    const ok = hit.checked || hit.getAttribute('aria-checked') === 'true';
    return { ok, applied: textOf(hit), reason: ok ? '' : '点击后选项仍未选中' };
  }

  /** 自定义下拉（Ant Design / Element UI / react-select 等）：展开面板后按文本点选 */
  async function fillCombobox(element, value) {
    const target = String(value).trim();

    // 先尝试直接输入：不少组件支持「可搜索的下拉框」，输入即筛选
    const before = element.value;
    await fillText(element, target);

    // 展开面板：某些组件必须点一下箭头才会出现选项
    element.click();
    await sleep(150);

    const OPTION_SELECTOR = [
      '[role="listbox"] [role="option"]',
      '.ant-select-item-option',
      '.el-select-dropdown__item',
      '.arco-select-option',
      '.next-menu-item',
      '[class*="dropdown"] li',
      '[class*="option"]'
    ].join(',');

    let options = [];
    for (let attempt = 0; attempt < 6 && !options.length; attempt += 1) {
      options = Array.from(document.querySelectorAll(OPTION_SELECTOR)).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && node.textContent.trim();
      });
      if (!options.length) await sleep(200);
    }

    if (!options.length) {
      // 面板没弹出来：如果刚才直接输入生效了，也算成功
      const ok = String(element.value).trim() === target;
      return { ok, applied: element.value, reason: ok ? '' : '自定义下拉未展开，且输入未生效' };
    }

    const hit =
      options.find((o) => o.textContent.trim() === target) ||
      options.find((o) => o.textContent.trim().includes(target));

    if (!hit) {
      document.body.click(); // 收起面板，保持页面干净
      return { ok: false, applied: '', reason: '下拉面板里没有匹配的选项' };
    }

    hit.click();
    await sleep(150);

    const applied = String(element.value).trim();
    const ok = applied.includes(target) || hit.textContent.trim() === target;
    return {
      ok,
      applied: applied || hit.textContent.trim(),
      reason: ok ? '' : '已点击选项，但输入框未更新（可能是异步组件，请人工确认）'
    };
  }

  /* ------------------------------------------------------------------ *
   * 高亮与撤销
   * ------------------------------------------------------------------ */

  /** 高亮刚填的字段：内存够用，注意不要破坏页面原有内联样式 */
  function highlight(element) {
    const previous = {
      outline: element.style.outline,
      outlineOffset: element.style.outlineOffset,
      transition: element.style.transition
    };
    element.style.transition = 'outline-color 0.3s ease';
    element.style.outline = '2px solid #16a34a';
    element.style.outlineOffset = '2px';

    setTimeout(() => {
      element.style.outline = previous.outline;
      element.style.outlineOffset = previous.outlineOffset;
      setTimeout(() => {
        element.style.transition = previous.transition;
      }, 320);
    }, 2000);
  }

  /** 记录撤销信息：记下改动前的值，撤销时才能回到最初状态 */
  function snapshot(item) {
    const { el, kind, members, field } = item;
    // 单选/复选要记录「整组」的选中状态，否则撤销时无法还原（单选按钮点了不能靠再点一次取消）
    if (kind === 'radio-group' || kind === 'checkbox') {
      return { kind, field, checks: (members || [el]).map((m) => ({ el: m, checked: m.checked })) };
    }
    if (el.isContentEditable) {
      return { kind: 'contenteditable', field, el, before: el.textContent };
    }
    if (el.tagName.toLowerCase() === 'select') {
      return { kind: 'select', field, el, before: el.value };
    }
    return { kind: 'value', field, el, before: el.value };
  }

  async function undo(snapshots) {
    let restored = 0;
    const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set;

    for (const snap of snapshots) {
      if (snap.kind === 'radio-group' || snap.kind === 'checkbox') {
        for (const item of snap.checks) {
          if (!item.el.isConnected || item.el.checked === item.checked) continue;
          checkedSetter.call(item.el, item.checked);
          item.el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          item.el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        }
        restored += 1;
        await sleep(10);
        continue;
      }

      const el = snap.el;
      if (!el || !el.isConnected) continue;
      if (snap.kind === 'contenteditable') {
        el.textContent = snap.before;
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      } else {
        setNativeValue(el, snap.before);
        dispatchInputEvents(el);
      }
      restored += 1;
      await sleep(10);
    }
    return restored;
  }

  /* ------------------------------------------------------------------ *
   * 对外主流程
   * ------------------------------------------------------------------ */

  /**
   * 执行一批填充。
   * @param {Array} assignments matcher 的输出
   * @param {Object} settings   { onlyEmpty, highlight }
   */
  async function fillAll(assignments, settings) {
    const results = [];
    const snapshots = [];

    for (const item of assignments) {
      const { el, kind, members, field, value } = item;

      // 只填空白字段：非空就跳过，避免覆盖用户已经填好或页面预填的内容
      if (settings.onlyEmpty && kind !== 'radio-group' && kind !== 'checkbox') {
        const current = el.isContentEditable ? el.textContent : el.value;
        if (current && String(current).trim() !== '' && String(current).trim() !== String(value).trim()) {
          results.push({ field, value, status: 'skipped', reason: '字段已有内容，按设置跳过' });
          continue;
        }
      }
      if (kind === 'radio-group' && members.some((m) => m.checked)) {
        results.push({ field, value, status: 'skipped', reason: '该选项组已选中，按设置跳过' });
        continue;
      }

      let snapshotItem = null;
      let outcome;

      try {
        // 快照也要放进 try：任何意外都不该中断整轮填充，只让这一个字段失败
        snapshotItem = snapshot(item);
        if (kind === 'select') outcome = await fillSelect(el, value);
        else if (kind === 'radio-group' || kind === 'checkbox') outcome = await fillChoice(members, value);
        else if (kind === 'combobox') outcome = await fillCombobox(el, value);
        else if (field.type === 'date') outcome = await fillDate(el, value);
        else outcome = await fillText(el, formatValue(el, field, value));
      } catch (err) {
        outcome = { ok: false, applied: '', reason: `执行异常：${err && err.message ? err.message : err}` };
      }

      if (outcome.ok) {
        snapshots.push(snapshotItem);
        results.push({ field, value, status: 'ok', applied: outcome.applied, reason: '' });
        if (settings.highlight) highlight(el);
      } else {
        results.push({ field, value, status: 'failed', reason: outcome.reason });
      }

      // 每填一个字段间隔一小段，避免一次性触发大量事件把页面卡死
      await sleep(40);
    }

    return { results, snapshots };
  }

  RA.Filler = {
    setNativeValue,
    dispatchInputEvents,
    dateVariants,
    normalizePhone,
    fillAll,
    undo,
    sleep
  };
})();
