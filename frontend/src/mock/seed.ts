import type { CourseContent, StoreRef, UserRole } from '@/types/api'

/**
 * M1 附录 A 开发用户与测试数据（与 backend/app/seed_data.py 保持一致）。
 */
export interface MockUserSeed {
  id: string
  name: string
  role: UserRole
  title: string
  stores: StoreRef[]
  hint: string
}

export interface MockStoreSeed {
  id: string
  code: string
  name: string
  active: boolean
}

export interface RubricPriceFactRule {
  key: string
  label: string
  type: 'price'
  required?: boolean
  patterns: string[]
  negation_guard?: boolean
}

export interface RubricGroupsFactRule {
  key: string
  label: string
  type: 'groups'
  required?: boolean
  groups: string[][]
}

export type RubricFactRule = RubricPriceFactRule | RubricGroupsFactRule

export interface RubricRules {
  schema_version: number
  pass_threshold: number
  weights: Record<'selling' | 'objection' | 'cross_sell' | 'affinity', number>
  required_facts: RubricFactRule[]
  dimensions: Record<
    'selling' | 'objection' | 'cross_sell' | 'affinity',
    { label: string; keywords: string[] }
  >
  redlines: Array<{ term: string; reason: string }>
  scenario: {
    persona_name: string
    persona_style: string
    question: string
    alt_question: string
    happy_reply: string
    concern_reply: string
  }
  average_pitch: string
  demo_pitch: string
}

export const MOCK_STORES: MockStoreSeed[] = [
  { id: 'store_bj', code: 'BJ-001', name: '北京路旗舰店', active: true },
  { id: 'store_fs', code: 'FS-001', name: '佛山祖庙百货店', active: true },
]

export const DEV_USERS: MockUserSeed[] = [
  {
    id: 'usr_linxiaomei',
    name: '林小美',
    role: 'staff',
    title: '早班资深导购',
    stores: [{ id: 'store_bj', name: '北京路旗舰店', role: 'staff' }],
    hint: '主路径员工 · 完整学习与对练体验',
  },
  {
    id: 'usr_chenajie',
    name: '陈阿杰',
    role: 'staff',
    title: '晚班导购',
    stores: [{ id: 'store_bj', name: '北京路旗舰店', role: 'staff' }],
    hint: '补训样例 · 带「端盒 6 个不重复」待补训任务',
  },
  {
    id: 'usr_wangxiaoxue',
    name: '王晓雪',
    role: 'staff',
    title: '周末兼职',
    stores: [{ id: 'store_bj', name: '北京路旗舰店', role: 'staff' }],
    hint: '未开始样例 · 待学习状态',
  },
  {
    id: 'usr_zhoulin',
    name: '周琳',
    role: 'staff',
    title: '对照门店导购',
    stores: [{ id: 'store_fs', name: '佛山祖庙百货店', role: 'staff' }],
    hint: '非目标门店 · 验证佛山看不到北京发布批次',
  },
  {
    id: 'usr_hejing',
    name: '何静',
    role: 'staff',
    title: '晚班导购',
    stores: [{ id: 'store_fs', name: '佛山祖庙百货店', role: 'staff' }],
    hint: '非目标门店 · 对照隔离账号',
  },
  {
    id: 'usr_liming',
    name: '李明',
    role: 'store_manager',
    title: '北京路店长',
    stores: [{ id: 'store_bj', name: '北京路旗舰店', role: 'store_manager' }],
    hint: '主路径店长（T007 扩展入口）',
  },
  {
    id: 'usr_zhangtao',
    name: '张涛',
    role: 'store_manager',
    title: '值班副店长',
    stores: [{ id: 'store_bj', name: '北京路旗舰店', role: 'store_manager' }],
    hint: '第二店长（T007 扩展入口）',
  },
  {
    id: 'usr_linmin',
    name: '林敏',
    role: 'hq_ops',
    title: '总部培训师',
    stores: [],
    hint: '主路径总部审校人（T007 扩展入口）',
  },
  {
    id: 'usr_zhouyi',
    name: '周毅',
    role: 'hq_ops',
    title: '企划审校',
    stores: [],
    hint: '第二总部账号（T007 扩展入口）',
  },
]

export const CHIIKAWA_COURSE_CONTENT: CourseContent = {
  product: {
    name: 'Chiikawa 联名毛绒公仔盲盒',
    summary: '日系超人气正版 IP 盲盒 · 入口第一堆头引流爆款',
    price: '¥59.00',
    tag: 'IP 爆款必考',
    icon: 'box',
  },
  chapters: [
    {
      key: 'ch1',
      short: '01 核心卖点',
      title: '核心卖点与材质工艺',
      preview: '正版授权 · 超柔短毛绒 · 6常规+1隐藏',
      speech:
        '这款是门店当下最核心的引流 IP 爆款。切忌一上来就报 59 元价格，先讲清楚它是日本正版联名授权，面料做了定制超柔短毛绒，全套包含 6 个常规款和 1 个睡衣乌萨奇隐藏款。',
      actions: [
        '品质锚点：定制超柔短毛绒 + 环保 PP 棉，挂书包不易变形。',
        '稀缺规则：全套 6 常规 + 1 隐藏，拼端盒 6 个必不重复。',
      ],
      mantra: '记忆口诀：正版授权 + 软糯手感 + 隐藏惊喜',
    },
    {
      key: 'ch2',
      short: '02 陈列试样',
      title: '黄金陈列与试样动作',
      preview: '入口第一堆头 · 必须摆放拆封展示样品',
      speech:
        '盲盒靠的就是情绪价值和第一眼手感。货架必须固定在门店入口第一堆头或 IP 核心专区，前方一定要拆出 1 到 2 个实物样品，顾客靠近时主动递上手让对方捏一捏。',
      actions: [
        '陈列红线：入口第一堆头，正面露出乌萨奇/吉伊主视觉。',
        '破冰动作：主动递上拆封样品，触碰后成交率翻倍。',
      ],
      mantra: '门店红线：没拆样品 = 流失一半成交率',
    },
    {
      key: 'ch3',
      short: '03 连带应答',
      title: '收银连带与异议化解',
      preview: '9.9元防尘挂袋 · 化解 59 元嫌贵顾虑',
      speech:
        '顾客犹豫怕抽不到喜欢款时，引导摇盒挑手感或约朋友拼端盒；顾客准备结账时，顺手递上 9.9 元透明亚克力防尘痛包挂袋，解决浅色毛绒挂包易脏痛点。',
      actions: [
        '异议化解：强调正版工艺 + 可摇盒挑手感 / 拼端盒不重样。',
        '连带公式：盲盒 + 9.9 元防尘展示挂袋，轻松提客单。',
      ],
      mantra: '连带金句：加 9 块 9 配个防尘袋，挂包出片不怕脏',
    },
  ],
}

export const CHIIKAWA_RUBRIC: RubricRules = {
  schema_version: 1,
  pass_threshold: 85,
  weights: {
    selling: 0.35,
    objection: 0.3,
    cross_sell: 0.2,
    affinity: 0.15,
  },
  required_facts: [
    {
      key: 'fact_price',
      label: '零售价 59 元',
      type: 'price',
      patterns: ['59', '五十九'],
      negation_guard: true,
    },
    {
      key: 'fact_license',
      label: '正版联名授权',
      type: 'groups',
      groups: [
        ['正版', '官方'],
        ['授权', '联名'],
      ],
    },
    {
      key: 'fact_box_rule',
      label: '端盒 6 个不重复',
      type: 'groups',
      groups: [
        ['端盒', '整盒'],
        ['6', '六', '六个', '六只'],
        ['不重复', '不重样', '不会重复', '不会重样'],
      ],
    },
  ],
  dimensions: {
    selling: {
      label: '卖点准确',
      keywords: ['正版', '联名', '授权', '毛绒', '手感', '隐藏'],
    },
    objection: {
      label: '异议化解',
      keywords: ['端盒', '整盒', '不重复', '不重样', '摇盒', '挑选', '品质', '细腻'],
    },
    cross_sell: {
      label: '连带引导',
      keywords: ['样品', '摸', '防尘', '挂袋', '9.9', '加购', '搭配', '连带'],
    },
    affinity: {
      label: '服务亲和',
      keywords: ['您', '放心', '试试', '推荐', '舒服', '哦', '呢', '可以', '帮您'],
    },
  },
  redlines: [
    { term: '治病', reason: '禁止医疗功效宣称' },
    { term: '疗效', reason: '禁止医疗功效宣称' },
    { term: '杀菌', reason: '非消字号禁止宣称杀菌' },
    { term: '消毒', reason: '非消字号禁止宣称消毒' },
    { term: '绝对不过敏', reason: '禁止绝对化安全承诺' },
    { term: '永久不坏', reason: '禁止绝对化质保承诺' },
    { term: '买一送一', reason: '禁止未经授权的促销承诺' },
    { term: '保真退十', reason: '禁止未经授权的赔付承诺' },
  ],
  scenario: {
    persona_name: '潮流学生 · 小雨',
    persona_style: 'student',
    question:
      '这个挂件盲盒一个就要 59 块，比普通钥匙扣贵好多，万一抽不到乌萨奇岂不是亏了？',
    alt_question:
      '我打算买两个送闺蜜，59 元一个怎么挑才不会抽重？要是配防尘袋一起买怎么算？',
    happy_reply:
      '哇，摸起来确实超软糯！那我再挑两盒，顺便加 9 块 9 配个防尘挂袋挂包上。',
    concern_reply: '嗯……听起来还是有点拿不准，我再逛逛看看别的吧。',
  },
  average_pitch:
    '这个确实是 59 元，因为是热门联名盲盒所以会贵一点，抽盲盒嘛看运气，喜欢的话可以拿一个试试。',
  demo_pitch:
    '您摸摸我们拆好的样品，这款虽然 59 元但它是日本正版联名授权，定制超柔短毛绒手感非常软糯！如果想稳抽乌萨奇可以摇盒挑手感，或者和朋友拼端盒 6 个绝对不重复，结账还可以加 9.9 元换购防尘挂袋挂包不怕脏哦！',
}

/** M1 §8.5 标准验证样本（对应正确 99、同义表达 91、漏讲 99 未过、事实错误 69 红线） */
export const M1_SAMPLE_INPUTS = {
  correct: CHIIKAWA_RUBRIC.demo_pitch,
  synonym:
    '这款是日本正版授权的联名毛绒公仔，手感软糯，五十九块钱一个；端盒六个不重样，您要不要摸一下拆开的样品？加 9.9 元还能配防尘挂袋。',
  missing:
    '这款是正版联名授权毛绒公仔，手感软糯还有隐藏款，59 元一个。您放心，可以摇盒挑手感，品质细腻，再摸摸拆好的样品，加 9.9 元配防尘挂袋哦。',
  factual_error:
    '这款是正版联名毛绒公仔，59 元，端盒 6 个可能会重复，您摸摸样品，加 9.9 元配防尘挂袋，买一送一哦。',
} as const

/** 固定 Mock 发布时间锚点（符合 M1 §9.4 约定，不将当前时间直接作为发布时间） */
export const MOCK_ANCHOR_T0 = '2026-11-24T09:00:00.000Z'
export const MOCK_DEADLINE_T0 = '2026-11-26T09:00:00.000Z'
