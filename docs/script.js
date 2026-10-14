/**
 * script.js —— 演示区的「自动填一遍」动画
 *
 * 这一块是全站唯一的动效：让访问者亲眼看到匹配引擎逐字段判断的过程，
 * 而不是读一段自夸文案。规则和分数都来自扩展里真实跑的那套实现。
 *
 * 退让策略：
 *   - 用户开启「减少动态效果」时，直接呈现终态，不做逐条播放
 *   - 浏览器不支持 IntersectionObserver 时同样直接呈现终态
 *   - 脚本完全不发送网络请求，也不读取任何真实表单数据
 */
(() => {
  'use strict';

  const form = document.getElementById('demoForm');
  if (!form) return;

  const rows = Array.from(form.querySelectorAll('.row'));
  const resultEl = document.getElementById('demoResult');
  const replayBtn = document.getElementById('demoReplay');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ROW_DELAY = 190; // 每条字段之间的间隔，整体节奏约 1.7 秒

  /** 把「本次演示：填入 N 个 · 跳过 M 个」按 DOM 实际情况写出来，避免手写数字对不上 */
  function paintResult() {
    if (!resultEl) return;
    const filled = rows.filter((row) => row.dataset.fill).length;
    const skipped = rows.filter((row) => row.dataset.skip).length;

    resultEl.textContent = '本次演示：填入 ';
    const filledNum = document.createElement('b');
    filledNum.textContent = String(filled);
    resultEl.append(filledNum, ' 个 · 跳过 ');
    const skippedNum = document.createElement('b');
    skippedNum.textContent = String(skipped);
    resultEl.append(skippedNum, ' 个');
  }

  /** 填充单行：有 data-fill 就是填上，有 data-skip 就是跳过并给出理由 */
  function paintRow(row) {
    const why = row.querySelector('.row__why');
    const value = row.querySelector('.row__value');

    if (row.dataset.fill) {
      if (value) value.textContent = row.dataset.fill;
      if (why) why.textContent = row.dataset.why || '';
      row.classList.add('is-filled');
      return;
    }

    if (row.dataset.skip) {
      if (why) why.textContent = `跳过 · ${row.dataset.skip}`;
      row.classList.add('is-skipped');
    }
  }

  function clearRows() {
    for (const row of rows) {
      row.classList.remove('is-filled', 'is-skipped');
      const value = row.querySelector('.row__value');
      const why = row.querySelector('.row__why');
      if (value) value.textContent = '';
      if (why) why.textContent = '';
    }
  }

  function showFinalState() {
    for (const row of rows) paintRow(row);
  }

  let playing = false;

  async function play() {
    if (playing) return;
    playing = true;

    const delay = reduceMotion.matches ? 0 : ROW_DELAY;
    clearRows();

    for (const row of rows) {
      paintRow(row);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }

    playing = false;
  }

  paintResult();

  if (reduceMotion.matches || typeof IntersectionObserver !== 'function') {
    // 不做动画：直接把结果摆出来，信息一点不少
    showFinalState();
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect(); // 只自动播一次，滚动来回不反复触发
          play();
        }
      },
      // 用 threshold: 0 + 底部负边距，而不是要求“露出 35%”。
      // 演示区在小屏上会被折成很高的单列，按比例判定可能永远达不到阈值，
      // 结果就是动画不播、区块看起来是空的——那不如一进视口就播。
      { threshold: 0, rootMargin: '0px 0px -20% 0px' }
    );
    observer.observe(form);
  }

  // 用户切换系统的「减少动态效果」时立刻同步一次结果
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches && !playing) showFinalState();
  });

  if (replayBtn) {
    replayBtn.addEventListener('click', play);
  }
})();
