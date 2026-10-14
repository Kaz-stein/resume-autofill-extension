/**
 * options.js —— 简历管理页
 *
 * 表单不是手写的，而是根据 schema.js 里的字段定义动态渲染出来的。
 * 好处：以后要给某个字段加关键词、加新字段，只改 schema.js 一处，界面自动跟着变。
 */
(async function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const state = {
    resumes: [],
    activeId: null,
    currentGroup: RA.GROUPS[0].id
  };

  const activeResume = () =>
    state.resumes.find((r) => r.id === state.activeId) || state.resumes[0] || null;

  /* ---------------- 保存（防抖自动保存） ---------------- */

  let hintTimer = 0;
  const flashSaved = () => {
    const hint = $('save-hint');
    hint.textContent = '已保存';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.textContent = '';
    }, 1500);
  };

  const saveDebounced = RA.Store.debounce(async () => {
    const resume = activeResume();
    if (!resume) return;
    await RA.Store.saveResume(resume);
    renderResumeList();
    flashSaved();
  }, 500);

  /** 写入数据并安排一次自动保存 */
  function writeValue(groupId, entryIndex, key, value) {
    const resume = activeResume();
    if (!resume) return;
    const group = resume.data[groupId];
    if (Array.isArray(group)) {
      group[entryIndex][key] = value;
    } else {
      group[key] = value;
    }
    saveDebounced();
  }

  /* ---------------- 左侧：简历列表 ---------------- */

  function renderResumeList() {
    const list = $('resume-list');
    list.innerHTML = '';

    for (const resume of state.resumes) {
      const li = document.createElement('li');
      li.className = resume.id === state.activeId ? 'active' : '';
      li.addEventListener('click', async () => {
        state.activeId = resume.id;
        await RA.Store.setActiveId(resume.id);
        renderResumeList();
        renderForm();
      });

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = resume.name || '未命名简历';
      li.appendChild(title);

      if (resume.id === state.activeId) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '使用中';
        li.appendChild(badge);
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del';
      del.title = '删除这份简历';
      del.textContent = '×';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (state.resumes.length <= 1) {
          alert('至少要保留一份简历。');
          return;
        }
        if (!confirm(`确定删除「${resume.name}」吗？删除后无法恢复。`)) return;
        state.resumes = await RA.Store.deleteResume(resume.id);
        if (!state.resumes.some((r) => r.id === state.activeId)) {
          state.activeId = state.resumes[0].id;
          await RA.Store.setActiveId(state.activeId);
        }
        renderResumeList();
        renderForm();
      });
      li.appendChild(del);

      list.appendChild(li);
    }
  }

  /* ---------------- 左侧：分组导航 ---------------- */

  function renderGroupNav() {
    const list = $('group-list');
    list.innerHTML = '';

    for (const group of RA.GROUPS) {
      const li = document.createElement('li');
      li.className = group.id === state.currentGroup ? 'active' : '';
      li.textContent = group.label;
      li.addEventListener('click', () => {
        state.currentGroup = group.id;
        renderGroupNav();
        renderForm();
      });
      list.appendChild(li);
    }
  }

  /* ---------------- 右侧：字段表单 ---------------- */

  function buildField(groupId, entryIndex, field, value) {
    const wrap = document.createElement('div');
    wrap.className = `field${field.type === 'textarea' ? ' wide' : ''}`;

    const label = document.createElement('label');
    label.textContent = field.label;
    if (field.type === 'date') label.textContent += '（如 2021-07-01，或直接填「至今」）';
    wrap.appendChild(label);

    let input;
    if (field.type === 'enum') {
      input = document.createElement('select');
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '未填写';
      input.appendChild(empty);
      for (const option of field.options || []) {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        input.appendChild(opt);
      }
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      // 日期字段刻意用 type=text：离职时间经常要填「至今」，date 类型会卡住
      input = document.createElement('input');
      input.type = field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text';
    }

    input.value = value || '';
    input.addEventListener('input', (e) => writeValue(groupId, entryIndex, field.key, e.target.value));
    input.addEventListener('change', (e) => writeValue(groupId, entryIndex, field.key, e.target.value));

    wrap.appendChild(input);
    return wrap;
  }

  function renderForm() {
    const area = $('form-area');
    area.innerHTML = '';

    const resume = activeResume();
    if (!resume) {
      area.textContent = '还没有简历，点击左上角「＋」新建一份。';
      return;
    }

    $('resume-name-input').value = resume.name || '';

    const group = RA.GROUPS.find((g) => g.id === state.currentGroup);
    const fields = RA.fieldsOfGroup(group.id);

    const title = document.createElement('h2');
    title.className = 'group-title';
    title.innerHTML = `${group.label}<span class="group-desc">${
      group.repeatable ? '可添加多条，填写时按页面上的顺序依次对应' : ''
    }</span>`;
    area.appendChild(title);

    // 数据兜底：老版本数据或导入数据可能缺字段，这里补齐结构
    const groupData = resume.data[group.id];
    if (group.repeatable) {
      if (!Array.isArray(groupData) || !groupData.length) resume.data[group.id] = [{}];
    } else if (!groupData || typeof groupData !== 'object') {
      resume.data[group.id] = {};
    }

    if (group.repeatable) {
      resume.data[group.id].forEach((entry, index) => {
        const card = document.createElement('section');
        card.className = 'card';

        const head = document.createElement('div');
        head.className = 'card-head';
        head.textContent = `第 ${index + 1} 条`;

        const ops = document.createElement('div');
        ops.className = 'ops';

        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'mini';
        up.textContent = '↑';
        up.title = '上移';
        up.disabled = index === 0;
        up.addEventListener('click', () => {
          const list = resume.data[group.id];
          [list[index - 1], list[index]] = [list[index], list[index - 1]];
          saveDebounced();
          renderForm();
        });

        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'mini';
        down.textContent = '↓';
        down.title = '下移';
        down.disabled = index === resume.data[group.id].length - 1;
        down.addEventListener('click', () => {
          const list = resume.data[group.id];
          [list[index + 1], list[index]] = [list[index], list[index + 1]];
          saveDebounced();
          renderForm();
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mini';
        remove.textContent = '删除';
        remove.addEventListener('click', () => {
          if (resume.data[group.id].length <= 1) {
            alert('至少保留一条。');
            return;
          }
          resume.data[group.id].splice(index, 1);
          saveDebounced();
          renderForm();
        });

        ops.append(up, down, remove);
        head.appendChild(ops);
        card.appendChild(head);

        const grid = document.createElement('div');
        grid.className = 'grid';
        for (const field of fields) {
          grid.appendChild(buildField(group.id, index, field, entry[field.key]));
        }
        card.appendChild(grid);
        area.appendChild(card);
      });

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'add-entry';
      add.textContent = `＋ 添加一条${group.label}`;
      add.addEventListener('click', () => {
        const item = {};
        for (const field of fields) item[field.key] = '';
        resume.data[group.id].push(item);
        saveDebounced();
        renderForm();
      });
      area.appendChild(add);
    } else {
      const card = document.createElement('section');
      card.className = 'card';
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const field of fields) {
        grid.appendChild(buildField(group.id, 0, field, resume.data[group.id][field.key]));
      }
      card.appendChild(grid);
      area.appendChild(card);
    }
  }

  /* ---------------- 简历名称 ---------------- */

  $('resume-name-input').addEventListener('input', (e) => {
    const resume = activeResume();
    if (!resume) return;
    resume.name = e.target.value;
    saveDebounced();
  });

  /* ---------------- 新建 / 导入 / 导出 / 清空 ---------------- */

  $('btn-add-resume').addEventListener('click', async () => {
    const resume = {
      id: `resume_${Date.now()}`,
      name: `未命名简历 ${state.resumes.length + 1}`,
      updatedAt: Date.now(),
      data: RA.Store.createEmptyResumeData()
    };
    await RA.Store.saveResume(resume);
    state.resumes = await RA.Store.getResumes();
    state.activeId = resume.id;
    await RA.Store.setActiveId(resume.id);
    renderResumeList();
    renderForm();
  });

  $('btn-export').addEventListener('click', async () => {
    const resumes = await RA.Store.getResumes();
    RA.Store.exportToFile(resumes, state.activeId);
  });

  $('btn-import').addEventListener('click', () => $('file-input').click());

  $('file-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = RA.Store.parseImport(text);
      // 导入不覆盖现有数据，统一追加，避免误操作把已有简历冲掉
      for (const resume of imported) await RA.Store.saveResume(resume);
      state.resumes = await RA.Store.getResumes();
      state.activeId = imported[0].id;
      await RA.Store.setActiveId(state.activeId);
      renderResumeList();
      renderForm();
      alert(`已导入 ${imported.length} 份简历。`);
    } catch (err) {
      alert(`导入失败：${(err && err.message) || err}`);
    } finally {
      e.target.value = '';
    }
  });

  $('btn-clear').addEventListener('click', async () => {
    if (!confirm('将删除本机保存的全部简历数据（包括所有份简历和设置），且无法恢复。确定继续？')) return;
    if (!confirm('再次确认：真的要清空全部数据吗？')) return;
    await new Promise((resolve) => chrome.storage.local.clear(resolve));
    state.resumes = [];
    state.activeId = null;
    await RA.Store.ensureInitialized();
    state.resumes = await RA.Store.getResumes();
    state.activeId = await RA.Store.getActiveId();
    renderResumeList();
    renderForm();
  });

  /* ---------------- 欢迎条 ---------------- */

  if (new URLSearchParams(location.search).get('welcome') === '1') {
    $('welcome').hidden = false;
  }
  $('welcome-close').addEventListener('click', () => {
    $('welcome').hidden = true;
  });

  /* ---------------- 启动 ---------------- */

  const { resumes, activeId } = await RA.Store.ensureInitialized();
  state.resumes = resumes;
  state.activeId = activeId;

  renderResumeList();
  renderGroupNav();
  renderForm();
})();
