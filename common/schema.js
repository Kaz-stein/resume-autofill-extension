/**
 * schema.js —— 简历字段定义与关键词词典
 *
 * 这是「填充引擎」的数据基础：页面上的一个输入框到底对应简历里的哪个字段，
 * 靠的就是这里的关键词词典。想支持新的招聘网站，优先在这里加词，而不是写 if (host === ...)。
 *
 * keywords  正向关键词，空格分隔（中英混排）
 * negative  负向关键词，命中后大幅降分（用于消歧，例如「昵称」不是「姓名」）
 * 说明：英文关键词在匹配时按「词元边界」处理，中文按「包含」处理，见 matcher.js。
 */
(function () {
  'use strict';
  const RA = (globalThis.RA = globalThis.RA || {});

  /** 分组定义：决定选项页的导航顺序 */
  RA.GROUPS = [
    { id: 'basic', label: '基本信息' },
    { id: 'job', label: '求职意向' },
    { id: 'education', label: '教育经历', repeatable: true },
    { id: 'work', label: '工作经历', repeatable: true },
    { id: 'project', label: '项目经历', repeatable: true },
    { id: 'skill', label: '技能与证书', repeatable: true },
    { id: 'summary', label: '自我评价' },
    { id: 'other', label: '其他信息' }
  ];

  /**
   * 字段定义。
   * type: text | textarea | date | tel | email | url | enum
   * options: type=enum 时的候选值，同时也是「下拉框/单选框」的匹配目标
   * nonNumeric: 该字段不该填进 <input type="number">（防止「公司规模」这类数字框被公司名污染）
   */
  RA.FIELDS = [
    /* ---------------- 基本信息 ---------------- */
    {
      key: 'name',
      label: '姓名',
      group: 'basic',
      type: 'text',
      nonNumeric: true,
      keywords: '姓名 真实姓名 中文姓名 姓名(中文) 本人姓名 应聘人姓名 name realname realName fullname fullName applicantName',
      negative: '昵称 nickname 用户名 username 英文名 englishname 拼音 曾用名 紧急联系人 联系人姓名 监护人 公司 单位 学校 项目 银行 company'
    },
    {
      key: 'gender',
      label: '性别',
      group: 'basic',
      type: 'enum',
      options: ['男', '女'],
      keywords: '性别 sex gender',
      negative: '性别要求 性别限制'
    },
    {
      key: 'birthday',
      label: '出生日期',
      group: 'basic',
      type: 'date',
      keywords: '出生 出生日期 出生年月 生日 birthday birth dateofbirth dob birthDate',
      negative: '出生地 籍贯 年龄'
    },
    {
      key: 'phone',
      label: '手机号',
      group: 'basic',
      type: 'tel',
      keywords: '手机 手机号 手机号码 联系电话 电话 联系方式 移动电话 常用电话 phone mobile tel telephone cellphone contactphone contact',
      negative: '座机 固定电话 固话 区号 areacode 紧急联系 紧急联系人 验证码 短信 captcha code 亲属 家长 单位电话 公司电话'
    },
    {
      key: 'email',
      label: '邮箱',
      group: 'basic',
      type: 'email',
      keywords: '邮箱 电子邮箱 电子邮件 email mail e-mail emailaddress',
      negative: '备用邮箱 公司邮箱'
    },
    {
      key: 'wechat',
      label: '微信号',
      group: 'basic',
      type: 'text',
      nonNumeric: true,
      keywords: '微信 微信号 微信账号 wechat weixin wx wechatid',
      negative: '微信群 公众号'
    },
    {
      key: 'currentCity',
      label: '现居住地',
      group: 'basic',
      type: 'text',
      nonNumeric: true,
      keywords: '现居 现居住地 居住地 现居城市 所在城市 目前城市 所在地 常住地 currentcity city address 现居住地址 居住地址',
      negative: '户籍 籍贯 家乡 出生地 期望城市 意向城市 公司地址 学校地址'
    },
    {
      key: 'hometown',
      label: '户籍所在地',
      group: 'basic',
      type: 'text',
      nonNumeric: true,
      keywords: '户籍 户籍所在地 籍贯 户口 户口所在地 生源地 hometown domicile nativeplace household',
      negative: '现居 居住地 期望城市'
    },
    {
      key: 'politicalStatus',
      label: '政治面貌',
      group: 'basic',
      type: 'enum',
      options: ['中共党员', '中共预备党员', '共青团员', '群众', '民主党派'],
      keywords: '政治面貌 政治面貌(请选择) political politicalStatus',
      negative: ''
    },
    {
      key: 'maritalStatus',
      label: '婚姻状况',
      group: 'basic',
      type: 'enum',
      options: ['未婚', '已婚', '离异'],
      keywords: '婚姻 婚姻状况 婚否 marital marriage',
      negative: ''
    },
    {
      key: 'idCard',
      label: '身份证号',
      group: 'basic',
      type: 'text',
      keywords: '身份证 身份证号 身份证号码 证件号码 idcard idCard identitycard idnumber certificate',
      negative: '有效期 签发 证件类型 身份证照片 上传'
    },
    {
      key: 'website',
      label: '个人主页',
      group: 'basic',
      type: 'url',
      keywords: '个人主页 个人网站 作品集 博客 主页 portfolio website homepage blog github 链接',
      negative: '公司网站 项目地址'
    },

    /* ---------------- 求职意向 ---------------- */
    {
      key: 'expectedPosition',
      label: '期望职位',
      group: 'job',
      type: 'text',
      nonNumeric: true,
      keywords: '期望职位 期望岗位 应聘职位 应聘岗位 意向岗位 意向职位 期望从事 求职岗位 申请职位 position job applyfor applyposition wantposition',
      negative: '当前职位 现任 职位描述 岗位职责'
    },
    {
      key: 'expectedCity',
      label: '期望城市',
      group: 'job',
      type: 'text',
      nonNumeric: true,
      keywords: '期望城市 意向城市 期望工作地 期望工作城市 工作城市 期望地区 expectcity',
      negative: '现居 户籍 籍贯 公司地址'
    },
    {
      key: 'expectedSalary',
      label: '期望薪资',
      group: 'job',
      type: 'text',
      keywords: '期望薪资 期望月薪 薪资要求 期望工资 薪酬要求 月薪要求 salary expectsalary 期望年薪',
      negative: '当前薪资 现薪 上家薪资'
    },
    {
      key: 'availableTime',
      label: '到岗时间',
      group: 'job',
      type: 'enum',
      options: ['随时到岗', '一周内', '一个月内', '离职交接中', '待定'],
      keywords: '到岗 到岗时间 入职时间 可到岗时间 最快到岗 available 预计到岗',
      negative: '离职时间 入职时间(历史)'
    },
    {
      key: 'jobStatus',
      label: '求职状态',
      group: 'job',
      type: 'enum',
      options: ['离职-随时到岗', '在职-月内到岗', '在职-暂不考虑', '在职-考虑机会', '在校生'],
      keywords: '求职状态 目前状态 在职状态 工作状态 jobstatus currentstatus',
      negative: ''
    },
    {
      key: 'jobType',
      label: '工作性质',
      group: 'job',
      type: 'enum',
      options: ['全职', '兼职', '实习', '校园招聘', '社会招聘'],
      keywords: '工作性质 工作类型 求职类型 工作性质(全职/兼职) jobtype',
      negative: ''
    },

    /* ---------------- 教育经历（可多条，按顺序对应页面上的第 1、2 条） ---------------- */
    {
      key: 'school',
      label: '学校',
      group: 'education',
      type: 'text',
      nonNumeric: true,
      keywords: '学校 学校名称 毕业院校 院校 就读学校 所在学校 school university college academy 院校名称',
      negative: '学校性质 学校地址 学校类型 学校排名'
    },
    {
      key: 'degree',
      label: '学历',
      group: 'education',
      type: 'enum',
      options: ['博士', '硕士', '本科', '大专', '高中', '中专', 'MBA'],
      keywords: '学历 最高学历 学历层次 学位 degree education 学历(最高)',
      negative: '学历要求 是否统招 学位证书'
    },
    {
      key: 'major',
      label: '专业',
      group: 'education',
      type: 'text',
      nonNumeric: true,
      keywords: '专业 所学专业 专业名称 就读专业 major 专业方向',
      negative: '专业要求 专业课 转专业'
    },
    {
      key: 'eduStart',
      label: '入学时间',
      group: 'education',
      type: 'date',
      keywords: '入学时间 入学 开始时间 就读起止 起止时间 eduStart educationStart',
      negative: '工作 离职'
    },
    {
      key: 'eduEnd',
      label: '毕业时间',
      group: 'education',
      type: 'date',
      keywords: '毕业时间 毕业 毕业日期 毕业年月 graduation eduEnd 结束时间',
      negative: '离职 工作结束 毕业院校 院校 学校名称'
    },
    {
      key: 'gpa',
      label: '成绩排名',
      group: 'education',
      type: 'text',
      keywords: 'gpa 绩点 平均分 成绩 排名 成绩排名 综合排名',
      negative: '高考成绩 笔试成绩'
    },
    {
      key: 'courses',
      label: '主修课程',
      group: 'education',
      type: 'textarea',
      keywords: '主修课程 主要课程 课程 courses 专业课程',
      negative: ''
    },

    /* ---------------- 工作经历 ---------------- */
    {
      key: 'company',
      label: '公司名称',
      group: 'work',
      type: 'text',
      nonNumeric: true,
      keywords: '公司 公司名称 单位 工作单位 所在公司 任职公司 company employer companyname organization 单位名称',
      negative: '公司规模 公司人数 公司性质 公司行业 公司地址 公司网站 公司电话 公司简介'
    },
    {
      key: 'jobTitle',
      label: '职位名称',
      group: 'work',
      type: 'text',
      nonNumeric: true,
      keywords: '职位 职位名称 岗位 职务 担任职位 任职岗位 jobtitle title position 职务名称',
      negative: '期望职位 应聘职位 意向岗位 职位描述 岗位职责 职位类别'
    },
    {
      key: 'department',
      label: '所属部门',
      group: 'work',
      type: 'text',
      nonNumeric: true,
      keywords: '部门 所属部门 所在部门 事业部 department 科室',
      negative: ''
    },
    {
      key: 'workStart',
      label: '在职开始时间',
      group: 'work',
      type: 'date',
      keywords: '入职时间 入职 在职开始 开始时间 工作起止 workStart 起始时间',
      negative: '入学 毕业 项目'
    },
    {
      key: 'workEnd',
      label: '离职时间',
      group: 'work',
      type: 'date',
      keywords: '离职时间 离职 在职结束 结束时间 至今 workEnd 离开时间',
      negative: '入学 毕业 项目 离职原因 离职理由 离开原因 原因'
    },
    {
      key: 'workDesc',
      label: '工作内容',
      group: 'work',
      type: 'textarea',
      keywords: '工作内容 工作描述 工作职责 主要职责 工作业绩 业绩描述 职责描述 jobdesc workcontent description 工作经历描述',
      negative: '离职原因 岗位职责要求'
    },
    {
      key: 'leaveReason',
      label: '离职原因',
      group: 'work',
      type: 'textarea',
      keywords: '离职原因 离职理由 离开原因 leavereason reason',
      negative: ''
    },

    /* ---------------- 项目经历 ---------------- */
    {
      key: 'projectName',
      label: '项目名称',
      group: 'project',
      type: 'text',
      nonNumeric: true,
      keywords: '项目名称 项目名 项目 project projectname',
      negative: '项目时间 项目周期 项目描述 项目简介 项目介绍 项目内容 项目职责 项目角色 技术栈 项目地址 项目成果'
    },
    {
      key: 'projectRole',
      label: '担任角色',
      group: 'project',
      type: 'text',
      nonNumeric: true,
      keywords: '担任角色 项目角色 角色 担任职务 projectrole role',
      negative: ''
    },
    {
      key: 'projectTime',
      label: '项目时间',
      group: 'project',
      type: 'date',
      keywords: '项目时间 项目起止 项目周期 projecttime',
      negative: ''
    },
    {
      key: 'projectDesc',
      label: '项目描述',
      group: 'project',
      type: 'textarea',
      keywords: '项目描述 项目简介 项目介绍 项目内容 projectdesc projectdescription',
      negative: '项目名称 项目职责'
    },
    {
      key: 'techStack',
      label: '技术栈',
      group: 'project',
      type: 'text',
      nonNumeric: true,
      keywords: '技术栈 技术 使用技术 开发环境 techstack technology 技术方案',
      negative: '技术难度'
    },
    {
      key: 'projectDuty',
      label: '个人职责',
      group: 'project',
      type: 'textarea',
      keywords: '个人职责 我的职责 负责内容 项目职责 主要工作 responsibility duty 承担工作',
      negative: '岗位职责要求'
    },

    /* ---------------- 技能与证书 ---------------- */
    {
      key: 'skillName',
      label: '技能名称',
      group: 'skill',
      type: 'text',
      nonNumeric: true,
      keywords: '技能 技能名称 专业技能 skill 掌握技能 技能特长',
      negative: '技能要求 技能等级'
    },
    {
      key: 'skillLevel',
      label: '熟练程度',
      group: 'skill',
      type: 'enum',
      options: ['精通', '熟练', '掌握', '了解', '一般'],
      keywords: '熟练程度 掌握程度 熟练度 技能等级 level 程度',
      negative: ''
    },
    {
      key: 'certificate',
      label: '证书名称',
      group: 'skill',
      type: 'text',
      nonNumeric: true,
      keywords: '证书 证书名称 资格证 职业资格 certificate 获奖 荣誉',
      negative: '证书编号 证书照片 上传'
    },
    {
      key: 'certDate',
      label: '获得时间',
      group: 'skill',
      type: 'date',
      keywords: '获得时间 发证时间 取得时间 获奖时间 certdate',
      negative: ''
    },

    /* ---------------- 自我评价 ---------------- */
    {
      key: 'selfEvaluation',
      label: '自我评价',
      group: 'summary',
      type: 'textarea',
      keywords: '自我评价 自我描述 自我介绍 个人优势 个人评价 个人简介 自我简介 个人自评 summary introduction aboutself selfevaluation 个人亮点 自我介绍(请填写)',
      negative: '评价他人 公司简介 项目简介'
    },

    /* ---------------- 其他 ---------------- */
    {
      key: 'emergencyContact',
      label: '紧急联系人',
      group: 'other',
      type: 'text',
      nonNumeric: true,
      keywords: '紧急联系人 紧急联系人姓名 emergencycontact 联系人',
      negative: '紧急联系人电话 联系电话'
    },
    {
      key: 'emergencyPhone',
      label: '紧急联系人电话',
      group: 'other',
      type: 'tel',
      keywords: '紧急联系人电话 紧急联系电话 紧急电话 emergencyphone',
      negative: '验证码'
    },
    {
      key: 'hobby',
      label: '特长爱好',
      group: 'other',
      type: 'textarea',
      keywords: '特长 爱好 兴趣爱好 特长爱好 hobby interest',
      negative: '专业特长要求'
    }
  ];

  /** 按 key 快速取字段定义 */
  RA.FIELD_MAP = RA.FIELDS.reduce((map, field) => {
    map[field.key] = field;
    return map;
  }, {});

  /** 取某个分组下的字段 */
  RA.fieldsOfGroup = (groupId) => RA.FIELDS.filter((f) => f.group === groupId);

  /** 该分组是否是多条目（数组）结构 */
  RA.isRepeatable = (groupId) => {
    const group = RA.GROUPS.find((g) => g.id === groupId);
    return Boolean(group && group.repeatable);
  };

  /** 多条目分组在填写时最多向页面提供几条（超出部分不填，避免把列表撑爆） */
  RA.MAX_REPEAT_FILL = 3;

  /**
   * 首次安装的示例数据。
   * 值统一用「示例」开头，避免用户误当成自己的真实信息直接投递。
   */
  RA.createSampleResume = () => ({
    id: `resume_${Date.now()}`,
    name: '示例简历（前端开发）',
    updatedAt: Date.now(),
    data: {
      basic: {
        name: '示例姓名',
        gender: '男',
        birthday: '1999-06-01',
        phone: '13800000000',
        email: 'example@example.com',
        wechat: 'example_wx',
        currentCity: '示例城市·示例区',
        hometown: '示例省示例市',
        politicalStatus: '共青团员',
        maritalStatus: '未婚',
        idCard: '',
        website: 'https://example.com'
      },
      job: {
        expectedPosition: '前端开发工程师',
        expectedCity: '示例城市',
        expectedSalary: '15-25K',
        availableTime: '一个月内',
        jobStatus: '在职-考虑机会',
        jobType: '全职'
      },
      education: [
        {
          school: '示例大学',
          degree: '本科',
          major: '计算机科学与技术',
          eduStart: '2017-09-01',
          eduEnd: '2021-06-30',
          gpa: '3.7/4.0，专业前 10%',
          courses: '数据结构、计算机网络、操作系统、数据库原理'
        }
      ],
      work: [
        {
          company: '示例科技有限公司',
          jobTitle: '前端开发工程师',
          department: '研发中心',
          workStart: '2021-07-01',
          workEnd: '至今',
          workDesc: '负责公司核心业务系统的前端开发与性能优化，主导前端工程化改造。',
          leaveReason: ''
        }
      ],
      project: [
        {
          projectName: '示例中台项目',
          projectRole: '前端负责人',
          projectTime: '2022-03-01',
          projectDesc: '面向内部运营的一站式数据管理平台，支撑日均十万级操作。',
          techStack: 'React、TypeScript、Vite',
          projectDuty: '负责整体前端架构设计、组件库建设与性能优化。'
        }
      ],
      skill: [
        { skillName: 'JavaScript / TypeScript', skillLevel: '精通' },
        { skillName: 'React', skillLevel: '熟练' },
        { skillName: '大学英语六级（CET-6）', skillLevel: '熟练' }
      ],
      summary: {
        selfEvaluation:
          '示例自我评价：具备扎实的前端基础与工程化经验，善于沟通协作，能独立负责模块从设计到上线的完整流程。'
      },
      other: {
        emergencyContact: '',
        emergencyPhone: '',
        hobby: '长跑、摄影'
      }
    }
  });
})();
