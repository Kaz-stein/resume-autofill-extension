/**
 * matcher.js —— 字段语义匹配引擎
 *
 * 职责：把页面上的输入框，映射到简历里的某个字段（姓名 / 手机号 / 学校 …）。
 *
 * 打分思路（权重从高到低）：
 *   autocomplete 属性 > 关联 label 文本 > aria-* > placeholder > name > id > class > 邻近文本
 * 命中后还要过两道消歧：
 *   1) 负向关键词（例如「昵称」不该被填成「姓名」）
 *   2) 区块语义（「毕业时间」在「工作经历」区块里应该降分，避免填错）
 */
(function () {
  'use strict';
  const RA = (globalThis.RA = globalThis.RA || {});

  /* 各来源的可信度权重 */
  const WEIGHT = {
    autocomplete: 6,
    label: 5,
    aria: 4.5,
    placeholder: 3.5,
    name: 3.2,
    id: 2.6,
    title: 2.4,
    nearby: 2.5,
    className: 1.4
  };

  const THRESHOLD = 3.0; // 低于该分数认为「不确定」，宁可不填也不乱填
  const SECTION_BONUS = 2.0; // 区块语义与字段分组一致时的加分
  const SECTION_PENALTY = 1.8; // 区块语义明确冲突时的扣分
  const NEGATIVE_NEARBY_PENALTY = 2; // 邻近文本命中负向词时的轻微降权

  /** autocomplete 属性 → 简历字段：这是最可靠的语义来源，浏览器标准定义 */
  const AUTOCOMPLETE_MAP = {
    name: 'name',
    'given-name': 'name',
    'family-name': 'name',
    tel: 'phone',
    'tel-national': 'phone',
    'tel-local': 'phone',
    email: 'email',
    organization: 'company',
    'organization-title': 'jobTitle',
    bday: 'birthday',
    sex: 'gender',
    url: 'website',
    'street-address': 'currentCity',
    'address-line1': 'currentCity',
    'address-level2': 'currentCity',
    'address-level1': 'hometown',
    country: 'hometown'
  };

  /** 明显不是简历字段的输入框，直接排除（验证码、搜索框等） */
  const BLOCKED_RE =
    /验证码|图形码|短信码|滑块|搜索|search|captcha|verifycode|verifcode|smscode|msgcode|validcode|authcode|检查|查询|筛选/;

  /* ------------------------------------------------------------------ *
   * 文本工具
   * ------------------------------------------------------------------ */

  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * 关键词匹配强度。
   * 中文：包含即算命中（中文没有词边界）
   * 英文：优先整词匹配；只命中子串时给低分，降低 company → companySize 这类误判
   */
  function matchStrength(text, keyword) {
    if (!text || !keyword) return 0;
    const t = String(text).toLowerCase();
    const k = String(keyword).toLowerCase();
    if (k.length < 2) return 0;

    if (/[\u4e00-\u9fa5]/.test(k)) return t.includes(k) ? 1 : 0;

    // camelCase / snake_case 先拆开，realName → real name
    const expanded = t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ');
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(k)}([^a-z0-9]|$)`, 'i');
    if (re.test(expanded) || re.test(t)) return 1;
    return t.includes(k) ? 0.3 : 0;
  }

  /** 一组关键词里的最强命中 */
  const bestMatch = (text, keywords) => {
    if (!text || !keywords) return 0;
    let best = 0;
    for (const kw of String(keywords).split(/\s+/)) {
      const s = matchStrength(text, kw);
      if (s > best) best = s;
      if (best === 1) break;
    }
    return best;
  };

  /* ------------------------------------------------------------------ *
   * 候选字段收集
   * ------------------------------------------------------------------ */

  const CANDIDATE_SELECTOR =
    'input, textarea, select, [contenteditable="true"], [role="combobox"], [aria-haspopup="listbox"]';

  /** 元素是否可见（注意：不能用 offsetParent，fixed 定位元素的 offsetParent 为 null） */
  function isVisible(el) {
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  /** 元素类型归类，填充阶段会按这个分支处理 */
  function isComboboxish(el) {
    if (el.getAttribute('role') === 'combobox') return true;
    if (el.getAttribute('aria-haspopup') === 'listbox') return true;
    if (el.hasAttribute('aria-expanded')) return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    return /(ant-select|el-select|arco-select|select2|combobox|dropdown|picker)/i.test(cls);
  }

  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (el.isContentEditable) return 'contenteditable';
    if (tag === 'input') {
      // 自定义下拉的输入框通常带 role=combobox / aria-haspopup，走单独的处理分支
      if (isComboboxish(el)) return 'combobox';
      const type = (el.type || 'text').toLowerCase();
      if (type === 'radio') return 'radio';
      if (type === 'checkbox') return 'checkbox';
      return 'input';
    }
    return 'combobox';
  }

  const SKIP_INPUT_TYPES = new Set([
    'hidden',
    'submit',
    'button',
    'reset',
    'file',
    'image',
    'password',
    'range',
    'color'
  ]);

  function isFillable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) return false;
    }
    if (el.disabled) return false;
    // readonly 的普通输入框跳过；但自定义下拉的输入框大多就是 readonly，必须放行
    if (el.readOnly && !isComboboxish(el)) return false;
    if (!isVisible(el)) return false;
    return true;
  }

  /**
   * 收集页面上所有可填字段。
   * 单选按钮按 name 分组：性别、婚姻状况这类字段，一组单选框只算「一个字段」，
   * 否则每个 radio 都会被当成独立候选，导致重复填充。
   */
  function collect(root = document) {
    const nodes = Array.from(root.querySelectorAll(CANDIDATE_SELECTOR));
    const result = [];
    const radioGroups = new Map();

    for (const el of nodes) {
      const kind = kindOf(el);

      if (kind === 'radio') {
        const key = `radio:${el.name || el.getAttribute('data-name') || 'anonymous'}`;
        let group = radioGroups.get(key);
        if (!group) {
          group = [];
          radioGroups.set(key, group);
          result.push({ el, kind: 'radio-group', members: group });
        }
        // 注意：当前这个 radio 也必须进组，否则组里会漏掉第一个选项
        group.push(el);
        continue;
      }

      if (!isFillable(el)) continue;

      if (kind === 'checkbox') {
        // 带 checkbox 的字段通常是「是否统招」这类单选项，按 label 文本参与匹配
        result.push({ el, kind: 'checkbox', members: [el] });
        continue;
      }

      result.push({ el, kind, members: [el] });
    }

    // 单选组只在首个元素入列，这里把同组其余成员补齐（上面已通过引用共享数组）
    return result.filter((item) => item.kind !== 'radio-group' || item.members.length >= 1);
  }

  /* ------------------------------------------------------------------ *
   * 语义描述：把一个字段身上所有「可能透露含义」的文本都收集起来
   * ------------------------------------------------------------------ */

  /** 关联 label：for= 指向、包裹式 label、表格布局的前置单元格 */
  function getLabelText(el) {
    const parts = [];

    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) parts.push(label.textContent);
      } catch {
        /* CSS.escape 在老浏览器可能不存在，忽略即可 */
      }
    }

    const wrapping = el.closest('label');
    if (wrapping) parts.push(wrapping.textContent);

    // 表格布局：<tr><td>姓名</td><td><input></td></tr>，招聘系统里非常常见
    const td = el.closest('td');
    if (td && td.previousElementSibling) parts.push(td.previousElementSibling.textContent);

    return clean(parts.join(' ')).slice(0, 120);
  }

  /** 邻近文本：自身前面的兄弟节点、父容器里排在自己前面的文本 */
  function getNearbyText(el) {
    const parts = [];
    const push = (text) => {
      const s = clean(text);
      if (s && s.length <= 40) parts.push(s);
    };

    // 逐层向上找「排在自己前面的文本」。
    // 这样既能覆盖 <div>姓名<input></div>，也能覆盖
    // <div class="form-item"><label>性别</label><div><input></div></div> 这类嵌套结构。
    let node = el;
    for (let depth = 0; node && depth < 4; depth += 1) {
      let sib = node.previousElementSibling;
      for (let hop = 0; sib && hop < 2; hop += 1) {
        push(sib.textContent);
        sib = sib.previousElementSibling;
      }

      const parent = node.parentElement;
      if (parent) {
        for (const child of Array.from(parent.childNodes)) {
          if (child === node) break;
          if (child.nodeType === Node.TEXT_NODE) push(child.textContent);
          else if (child.nodeType === Node.ELEMENT_NODE && !child.contains(node)) push(child.textContent);
        }
      }
      node = node.parentElement;
    }

    return clean(parts.join(' ')).slice(0, 160);
  }

  /** 区块语义：往上找 6 层，看看这个字段属于「教育经历」还是「工作经历」 */
  const SECTION_RULES = [
    { id: 'education', re: /教育经历|教育背景|学习经历|教育信息|学校信息/ },
    { id: 'work', re: /工作经历|工作经验|职业经历|实习经历|工作背景/ },
    { id: 'project', re: /项目经历|项目经验|项目信息|项目介绍/ },
    { id: 'skill', re: /技能|证书|荣誉|获奖/ },
    { id: 'summary', re: /自我评价|自我介绍|个人评价|个人优势/ },
    { id: 'basic', re: /基本信息|个人资料|个人信息/ },
    { id: 'job', re: /求职意向|期望|求职期望/ }
  ];

  /** 只取容器里的「标题类」文本，避免把整个表单的文本都算进来 */
  function getContainerTitle(node) {
    const parts = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent);
      else if (
        child.nodeType === Node.ELEMENT_NODE &&
        /^(H1|H2|H3|H4|H5|LEGEND|STRONG|LABEL|SPAN|DIV|P)$/.test(child.tagName) &&
        child.children.length === 0
      ) {
        parts.push(child.textContent);
      }
      if (parts.length >= 3) break;
    }
    return clean(parts.join(' ')).slice(0, 60);
  }

  function getSectionHint(el) {
    let node = el.parentElement;
    for (let depth = 0; node && depth < 6; depth += 1) {
      const title = getContainerTitle(node);
      for (const rule of SECTION_RULES) {
        if (rule.re.test(title)) return rule.id;
      }
      node = node.parentElement;
    }
    return '';
  }

  /** select / 单选组 / 自定义下拉里所有可选项的文本 */
  function getOptionTexts(item) {
    if (item.kind === 'select') {
      return Array.from(item.el.options)
        .map((o) => clean(o.textContent))
        .join(' ');
    }
    if (item.kind === 'radio-group' || item.kind === 'checkbox') {
      return item.members
        .map((input) => {
          const label = input.closest('label');
          return clean([input.value, label && label.textContent].filter(Boolean).join(' '));
        })
        .join(' ');
    }
    return '';
  }

  /** 把一个候选字段描述成一堆文本，供打分使用 */
  function describe(item) {
    const el = item.el;
    return {
      kind: item.kind,
      autocomplete: clean(el.getAttribute('autocomplete') || ''),
      label: getLabelText(el),
      aria: clean(
        [
          el.getAttribute('aria-label'),
          el.getAttribute('aria-labelledby') ? document.getElementById(el.getAttribute('aria-labelledby'))?.textContent : '',
          el.getAttribute('role') === 'combobox' ? 'combobox 下拉框' : ''
        ]
          .filter(Boolean)
          .join(' ')
      ),
      placeholder: clean(el.getAttribute('placeholder') || ''),
      title: clean(el.getAttribute('title') || ''),
      name: clean(el.getAttribute('name') || ''),
      id: clean(el.id || ''),
      className: typeof el.className === 'string' ? clean(el.className) : '',
      nearby: getNearbyText(el),
      section: getSectionHint(el),
      options: getOptionTexts(item),
      inputType: (el.getAttribute('type') || '').toLowerCase()
    };
  }

  /* ------------------------------------------------------------------ *
   * 打分
   * ------------------------------------------------------------------ */

  function scoreField(d, field) {
    // 负向关键词优先判定：本地语义明确冲突（如把「昵称」当「姓名」）时直接否决。
    // 这里必须「一票否决」而不是扣分，否则很容易被其他来源的分数抵消掉。
    const localText = [d.label, d.aria, d.placeholder, d.title, d.name, d.id]
      .filter(Boolean)
      .join(' ');
    if (bestMatch(localText, field.negative) > 0) return 0;

    let score = 0;
    let strongHit = false; // 是否在「强来源」上命中过

    // 1) autocomplete：命中即直接锁定，最高可信度
    if (d.autocomplete && AUTOCOMPLETE_MAP[d.autocomplete.toLowerCase()] === field.key) {
      score += WEIGHT.autocomplete;
      strongHit = true;
    }

    // 2~8) 各文本来源
    const sources = [
      ['label', d.label],
      ['aria', d.aria],
      ['placeholder', d.placeholder],
      ['name', d.name],
      ['id', d.id],
      ['nearby', d.nearby],
      ['title', d.title],
      ['className', d.className]
    ];
    for (const [key, text] of sources) {
      if (!text) continue;
      const strength = bestMatch(text, field.keywords);
      if (strength > 0) {
        score += WEIGHT[key] * strength;
        if (key === 'label' || key === 'aria' || key === 'placeholder') strongHit = true;
      }
    }

    // 枚举字段：如果输入框的可选值里出现了该字段的候选值（如「男/女」），这也是强信号
    if (field.options && field.options.length && d.options) {
      const hits = field.options.filter((opt) => d.options.includes(opt)).length;
      if (hits >= 2) {
        // 选项值本身就对上了（男/女、博士/硕士/本科），可信度很高
        score += 4.0;
        strongHit = true;
      }
    }

    if (score <= 0) return 0;

    // 邻近文本里出现负向词时只轻微降权：邻近文本常常混进相邻字段的标签，
    // 一刀切否决会把「离职时间」这种正确字段也误杀（它旁边就写着「离职原因」）
    if (bestMatch(d.nearby, field.negative) > 0) score -= NEGATIVE_NEARBY_PENALTY;

    // 区块语义：一致加分，冲突扣分（这是「毕业时间」vs「离职时间」的关键）
    if (d.section) {
      if (d.section === field.group) score += SECTION_BONUS;
      else if (RA.isRepeatable(d.section) || RA.isRepeatable(field.group)) score -= SECTION_PENALTY;
    }

    // 数字输入框不该塞文本型字段
    if (field.nonNumeric && (d.inputType === 'number' || d.inputType === 'tel')) {
      if (field.type === 'text' || field.type === 'textarea') score -= 4;
    }

    // 没在强来源上命中过的，最高只能算「勉强猜中」，压低到阈值边缘
    if (!strongHit && score > THRESHOLD) score = Math.min(score, THRESHOLD + 0.4);

    return score;
  }

  /* ------------------------------------------------------------------ *
   * 取值与配对
   * ------------------------------------------------------------------ */

  /** 从简历里取出某个字段的全部可用值（多条经历按顺序排列） */
  function collectValues(field, resume) {
    if (!resume || !resume.data) return [];
    const group = resume.data[field.group];
    if (group == null) return [];

    const values = [];
    if (Array.isArray(group)) {
      for (const entry of group.slice(0, RA.MAX_REPEAT_FILL)) {
        const v = entry && entry[field.key];
        if (v != null && String(v).trim() !== '') values.push(String(v).trim());
      }
    } else {
      const v = group[field.key];
      if (v != null && String(v).trim() !== '') values.push(String(v).trim());
    }
    return values;
  }

  /** 页面坐标，用于按文档顺序分配「第 1 条 / 第 2 条」经历 */
  function positionOf(el) {
    const rect = el.getBoundingClientRect();
    return rect.top + window.scrollY + rect.left * 0.001;
  }

  /**
   * 主入口：把页面字段和简历数据配对。
   * @returns {Array<{el, kind, members, field, score, value, descriptors}>}
   */
  function match(resume, root = document) {
    const candidates = collect(root);
    const pairs = [];

    for (const item of candidates) {
      const d = describe(item);

      // 验证码、搜索框这类直接不看
      const blockText = [d.label, d.placeholder, d.name, d.id, d.nearby, d.aria, d.title]
        .filter(Boolean)
        .join(' ');
      if (BLOCKED_RE.test(blockText)) continue;

      for (const field of RA.FIELDS) {
        const score = scoreField(d, field);
        if (score >= THRESHOLD) pairs.push({ item, d, field, score });
      }
    }

    // 全局贪心：分数高的先占坑，避免「手机号」被抢到「紧急联系人电话」上
    pairs.sort((a, b) => b.score - a.score);

    const usedElements = new Set();
    const fieldUseCount = new Map();
    const assigned = [];

    for (const pair of pairs) {
      if (usedElements.has(pair.item.el)) continue;

      const values = collectValues(pair.field, resume);
      const usedCount = fieldUseCount.get(pair.field.key) || 0;
      if (usedCount >= values.length) continue; // 该字段没有更多值可分，或值为空

      usedElements.add(pair.item.el);
      fieldUseCount.set(pair.field.key, usedCount + 1);

      assigned.push({
        el: pair.item.el,
        kind: pair.item.kind,
        members: pair.item.members,
        field: pair.field,
        score: Math.round(pair.score * 100) / 100,
        value: values[usedCount],
        valueIndex: usedCount,
        descriptors: pair.d
      });
    }

    // 按页面顺序返回：第 1 个「学校」填第 1 条教育经历，第 2 个填第 2 条
    assigned.sort((a, b) => positionOf(a.el) - positionOf(b.el));
    return assigned;
  }

  RA.Matcher = { collect, describe, scoreField, collectValues, match, THRESHOLD };
})();
