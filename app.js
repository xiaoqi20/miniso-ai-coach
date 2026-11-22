// ponytail: modularized client state, per-SKU chapter persistence, 5-state mission machine & heuristic 4D rubric; swap with backend auth/LLM SSE when ready
const DEMO_ACCOUNTS = [
  {
    id: "staff_beijing",
    role: "staff",
    label: "门店员工",
    userName: "林小美",
    storeName: "北京路旗舰店",
    storeLine: "北京路旗舰店 · 目标门店员工",
    staffKey: "linxiaomei",
    wheelTitle: "门店员工 · 北京路",
    wheelDesc: "目标门店导购：接收总部品类任务并学练",
    wheelCaps: ["目标门店", "学练打卡"],
    users: [
      { key: "linxiaomei", name: "林小美", title: "早班资深导购" },
      { key: "chenajie", name: "陈阿杰", title: "晚班导购" },
      { key: "wangxiaoxue", name: "王晓雪", title: "周末兼职" }
    ]
  },
  {
    id: "staff_foshan",
    role: "staff",
    label: "门店员工",
    userName: "周琳",
    storeName: "佛山祖庙百货店",
    storeLine: "佛山祖庙百货店 · 非目标门店员工",
    staffKey: "zhoulin",
    wheelTitle: "门店员工 · 佛山祖庙",
    wheelDesc: "对照门店导购：校验草稿与未下发品隔离",
    wheelCaps: ["对照门店", "隔离校验"],
    users: [
      { key: "zhoulin", name: "周琳", title: "对照门店导购" },
      { key: "hejing", name: "何静", title: "晚班导购" }
    ]
  },
  {
    id: "store_mgr",
    role: "store_mgr",
    label: "门店店长",
    userName: "李明",
    storeName: "北京路旗舰店",
    storeLine: "北京路旗舰店 · 管辖 12 人",
    staffKey: null,
    wheelTitle: "门店店长 · 北京路",
    wheelDesc: "看员工卡点，发起补训并复查结果",
    wheelCaps: ["卡点追踪", "补训复查"],
    users: [
      { key: "liming", name: "李明", title: "北京路店长" },
      { key: "zhangtao", name: "张涛", title: "值班副店长" }
    ]
  },
  {
    id: "hq_linmin",
    role: "hq_ops",
    label: "总部运营",
    userName: "林敏",
    storeName: "总部",
    storeLine: "商品企划与培训中心",
    staffKey: null,
    wheelTitle: "总部培训运营",
    wheelDesc: "录入审校新品，指定门店与截止时间",
    wheelCaps: ["审校发布", "跨端同步"],
    users: [
      { key: "linmin", name: "林敏", title: "总部培训师" },
      { key: "zhouyi", name: "周毅", title: "企划审校" }
    ]
  },
  {
    id: "area_zhanghua",
    role: "area_mgr",
    label: "区域经理",
    userName: "张华",
    storeName: "华南一区",
    storeLine: "华南一区 · 18 家门店",
    staffKey: null,
    wheelTitle: "区域经理 · 华南",
    wheelDesc: "看红黑榜与客单，下发大区必考",
    wheelCaps: ["门店榜单", "督导指令"],
    users: [
      { key: "zhanghua", name: "张华", title: "华南大区经理" }
    ]
  }
];

const ROLE_META = {
  staff: {
    label: "门店员工",
    userName: "林小美",
    storeName: "北京路旗舰店",
    storeLine: "北京路旗舰店 · 早班"
  },
  store_mgr: {
    label: "门店店长",
    userName: "李明",
    storeName: "北京路旗舰店",
    storeLine: "北京路旗舰店 · 管辖 12 人"
  },
  hq_ops: {
    label: "总部运营",
    userName: "林敏",
    storeName: "总部",
    storeLine: "商品企划与培训中心"
  },
  area_mgr: {
    label: "区域经理",
    userName: "张华",
    storeName: "华南一区",
    storeLine: "华南一区 · 18 家门店"
  }
};

const SLIDES = [
  {
    tag: "01 闪卡速记",
    title: "3 分钟吃透爆款卖点",
    desc: "IP 联名、大师香薰与连带公式拆解为 3D 翻转闪卡与渐进微课，早会碎片时间极速记牢。"
  },
  {
    tag: "02 虚拟语音对练",
    title: "拟人顾客开口实战陪练",
    desc: "与虚拟门店顾客实时语音对话，还原价格顾虑、成分安全等真实场景，反复练出金牌口才。"
  },
  {
    tag: "03 四维雷达评估",
    title: "量化能力短板与门店协同",
    desc: "从卖点、异议、连带、亲和四维雷达精准评分，店长催学、经理看榜形成培训闭环。"
  }
];

const SKU_ICONS = {
  box: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  aroma: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2h8"/><path d="M9 2v4l-3 4v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10l-3-4V2"/><path d="M6 14h12"/></svg>`,
  pillow: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17a7 7 0 0 1 14 0"/><path d="M4 14a8 8 0 0 1 16 0v3a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-4 0v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3z"/></svg>`,
  cup: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M6 6h12"/><path d="M7 6l1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/><path d="M7.5 11h9"/></svg>`,
  towel: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M8 12h8"/><path d="M8 15h5"/></svg>`,
  scarf: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5h10a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 12v8l3-2 3 2v-8"/><path d="M15 12v5"/><path d="M7 8.5h10"/></svg>`
};

/** 通用文本 HTML 转义，防止用户输入内容注入 */
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 门店通用话术红线词库（医疗/绝对化/未授权促销承诺） */
const GLOBAL_REDLINES = [
  { term: "治病", reason: "禁止医疗功效宣称" },
  { term: "疗效", reason: "禁止医疗功效宣称" },
  { term: "杀菌", reason: "非消字号禁止宣称杀菌" },
  { term: "消毒", reason: "非消字号禁止宣称消毒" },
  { term: "绝对不过敏", reason: "禁止绝对化安全承诺" },
  { term: "永久不坏", reason: "禁止绝对化质保承诺" },
  { term: "买一送一", reason: "禁止未经授权的促销承诺" },
  { term: "保真退十", reason: "禁止未经授权的赔付承诺" }
];

const PRODUCTS = [
  {
    id: "chiikawa",
    icon: "box",
    tag: "IP 爆款必考",
    name: "Chiikawa 联名毛绒公仔盲盒",
    summary: "日系超人气正版 IP 盲盒 · 入口第一堆头引流爆款",
    price: "¥59.00",
    passed: false,
    lastScore: null,
    bestScore: null,
    completedChapters: [false, false, false],
    points: [
      "日本超人气 IP 正版授权，6 款常规 + 1 款隐藏，端盒 6 个必不重复",
      "超柔短毛绒手感软糯，入口第一堆头必须陈列拆封样品",
      "连带公式：加 9.9 元换购亚克力防尘展示挂袋"
    ],
    chapters: [
      {
        short: "01 核心卖点",
        title: "核心卖点与材质工艺",
        preview: "正版授权 · 超柔短毛绒 · 6常规+1隐藏",
        speech: "这款是门店当下最核心的引流 IP 爆款。切忌一上来就报 59 元价格，先讲清楚它是日本正版联名授权，面料做了定制超柔短毛绒，全套包含 6 个常规款和 1 个睡衣乌萨奇隐藏款。",
        actions: [
          "品质锚点：定制超柔短毛绒 + 环保 PP 棉，挂书包不易变形。",
          "稀缺规则：全套 6 常规 + 1 隐藏，拼端盒 6 个必不重复。"
        ],
        mantra: "记忆口诀：正版授权 + 软糯手感 + 隐藏惊喜"
      },
      {
        short: "02 陈列试样",
        title: "黄金陈列与试样动作",
        preview: "入口第一堆头 · 必须摆放拆封展示样品",
        speech: "盲盒靠的就是情绪价值和第一眼手感。货架必须固定在门店入口第一堆头或 IP 核心专区，前方一定要拆出 1 到 2 个实物样品，顾客靠近时主动递上手让对方捏一捏。",
        actions: [
          "陈列红线：入口第一堆头，正面露出乌萨奇/吉伊主视觉。",
          "破冰动作：主动递上拆封样品，触碰后成交率翻倍。"
        ],
        mantra: "门店红线：没拆样品 = 流失一半成交率"
      },
      {
        short: "03 连带应答",
        title: "收银连带与异议化解",
        preview: "9.9元防尘挂袋 · 化解 59 元嫌贵顾虑",
        speech: "顾客犹豫怕抽不到喜欢款时，引导摇盒挑手感或约朋友拼端盒；顾客准备结账时，顺手递上 9.9 元透明亚克力防尘痛包挂袋，解决浅色毛绒挂包易脏痛点。",
        actions: [
          "异议化解：强调正版工艺 + 可摇盒挑手感 / 拼端盒不重样。",
          "连带公式：盲盒 + 9.9 元防尘展示挂袋，轻松提客单。"
        ],
        mantra: "连带金句：加 9 块 9 配个防尘袋，挂包出片不怕脏"
      }
    ],
    persona: {
      name: "潮流学生 · 小雨",
      style: "student",
      question: "这个挂件盲盒一个就要 59 块，比普通钥匙扣贵好多，万一抽不到乌萨奇岂不是亏了？",
      altQuestion: "我打算买两个送闺蜜，59 元一个怎么挑才不会抽重？要是配防尘袋一起买怎么算？",
      happyReply: "哇，摸起来确实超软糯！那我再挑两盒，顺便加 9 块 9 配个防尘挂袋挂包上。",
      concernReply: "嗯……听起来还是有点拿不准，我再逛逛看看别的吧。"
    },
    flashcards: [
      {
        category: "核心卖点",
        front: "这款盲盒最打动年轻人的 3 个硬核卖点是什么？",
        back: "日本超人气 IP 正版授权；定制超柔短毛绒 + 环保 PP 棉填充，挂包出片；全套 6 常规 + 1 隐藏（睡衣乌萨奇）。",
        mantra: "口诀：正版授权 + 软糯手感 + 隐藏惊喜",
        mastered: false
      },
      {
        category: "价格异议",
        front: "顾客嫌 59 元太贵、怕抽不到喜欢款怎么化解？",
        back: "先递拆封样品让顾客亲手捏质感，强调正版联名工艺，并告知可以轻摇挑手感或与朋友拼端盒 6 个绝对不重样。",
        mantra: "动作：先递样品 -> 讲正版 -> 推拼端盒",
        mastered: false
      },
      {
        category: "黄金陈列",
        front: "Chiikawa 联名盲盒在门店必须放在什么位置？",
        back: "门店入口第一堆头 / IP 核心专区，货架前方必须固定摆放 1–2 个拆封展示样品供顾客触摸拍照。",
        mantra: "红线：没拆样品 = 流失一半成交率",
        mastered: false
      },
      {
        category: "收银连带",
        front: "顾客决定买盲盒时，顺口推哪款连带商品转化最高？",
        back: "自然引导加 9.9 元换购透明亚克力防尘痛包挂袋，解决浅色毛绒挂书包易落灰痛点。",
        mantra: "连带话术：配个 9.9 元防尘袋，挂包不怕脏",
        mastered: false
      }
    ],
    rubric: {
      selling: ["正版", "联名", "授权", "毛绒", "手感", "隐藏"],
      objection: ["端盒", "不重复", "不重样", "摇盒", "挑选", "品质", "细腻"],
      crossSell: ["样品", "摸", "防尘", "挂袋", "9.9", "加购", "搭配", "连带"],
      facts: [
        { label: "零售价 59 元", required: true, priceValue: "59", patterns: ["59"] },
        { label: "正版联名授权", required: true, requiredGroups: [["正版", "授权", "联名"]] },
        { label: "端盒 6 个不重复", required: true, requiredGroups: [["端盒", "整盒"], ["6", "六个", "六只"], ["不重复", "不重样"]] }
      ],
      avgPitch: "这个确实是 59 元，因为是热门联名盲盒所以会贵一点，抽盲盒嘛看运气，喜欢的话可以拿一个试试。",
      demoPitch: "您摸摸我们拆好的样品，这款虽然 59 元但它是日本正版联名授权，定制超柔短毛绒手感非常软糯！如果想稳抽乌萨奇可以摇盒挑手感，或者和朋友拼端盒 6 个绝对不重复，结账还可以加 9.9 元换购防尘挂袋挂包不怕脏哦！"
    }
  },
  {
    id: "aroma",
    icon: "aroma",
    tag: "高毛利主推",
    name: "大师创香 · 山野茶韵无火香薰",
    summary: "奇华顿大牌同源调香 · 0 酒精孕婴家庭安心款",
    price: "¥39.90",
    passed: false,
    lastScore: null,
    bestScore: null,
    completedChapters: [true, false, false],
    points: [
      "奇华顿（Givaudan）调香师联合研制，白茶与雪松木质尾调",
      "植物大豆溶剂配方，0 酒精添加，孕婴与宠物家庭安心可用",
      "100ml 容量持续散香 60 至 90 天，连带 15 元同香型织物喷雾"
    ],
    chapters: [
      {
        short: "01 调香成分",
        title: "大牌调香与安全成分",
        preview: "奇华顿联合研制 · 植物大豆溶剂 0 酒精",
        speech: "大师创香是门店高毛利王牌。推荐时直接抛出两个信任锚点：一是国际大牌同源的奇华顿调香师调制，前调清雅白茶、尾调雪松木质；二是采用植物大豆溶剂，0 酒精温和不刺鼻。",
        actions: [
          "品质背书：奇华顿（Givaudan）同源香料，告别廉价香精感。",
          "安全卖点：0 酒精植物基底，孕婴与宠物家庭安心使用。"
        ],
        mantra: "安心三连：奇华顿调香 · 植物溶剂 · 0 酒精"
      },
      {
        short: "02 试闻陈列",
        title: "黄金视线位与试闻规范",
        preview: "1.2–1.5m 黄金层 · 试闻石每周换新",
        speech: "香薰属于强体验品类，必须摆放在香薰区 1.2 至 1.5 米黄金视线层，并配齐试闻杯。试闻杯内的扩香石每周必须滴液换新，引导顾客轻扇瓶口试闻，避免直接贴鼻深吸。",
        actions: [
          "陈列标准：主推山野茶韵放中间视觉焦点，藤条插 3–5 根展示。",
          "体验话术：引导顾客先试闻白茶清香，再算 90 天留香账。"
        ],
        mantra: "算账法：100ml 用满 3 个月，日均不到 5 毛钱"
      },
      {
        short: "03 连带组合",
        title: "收银连带与场景组合",
        preview: "搭配 15 元同香型织物喷雾 · 全屋留香",
        speech: "顾客认可味道后，直接用场景拓展法做连带：无火香薰放客厅卧室持久散香，顺手带一瓶 15 元同香型织物喷雾，出门前喷衣柜、外套和窗帘，全家统一高级茶香。",
        actions: [
          "异议化解：宝妈问安全 -> 立刻强调 0 酒精植物大豆溶剂。",
          "连带公式：39.9 元无火香薰 + 15 元织物喷雾 = 居家香氛套。"
        ],
        mantra: "连带金句：香薰放卧室，15 元喷雾喷衣柜外套"
      }
    ],
    persona: {
      name: "精致宝妈 · 安琪",
      style: "mom",
      question: "味道是挺清新的，但家里有刚满周岁的宝宝，39 块 9 的香薰放卧室安全吗？会不会刺鼻？",
      altQuestion: "我卧室平时关着门开空调，这瓶不到 40 块的香薰真不会呛头吗？大概能扩香几个月？",
      happyReply: "0 酒精植物溶剂确实让人放心多了，日均才几毛钱，那我带一瓶香薰再配一瓶同香型喷雾！",
      concernReply: "家里有小宝宝我还是挺谨慎的，成分没听明白的话我先不买了。"
    },
    flashcards: [
      {
        category: "品牌背书",
        front: "这款 39.9 元香薰凭什么敢叫「大师创香」？",
        back: "联合全球顶级香料巨头奇华顿（Givaudan）大牌同源调香师调制，白茶前调 + 雪松木质尾调，高级不廉价。",
        mantra: "关键词：奇华顿大牌同源 · 白茶雪松",
        mastered: false
      },
      {
        category: "安全异议",
        front: "宝妈或养宠顾客担心刺鼻、不安全怎么解答？",
        back: "采用天然植物大豆溶剂基底，0 酒精添加，挥发温和不呛鼻，孕婴与宠物家庭放在客厅卧室都安心。",
        mantra: "安心三连：植物溶剂 · 0 酒精 · 孕婴可用",
        mastered: false
      },
      {
        category: "性价比拆解",
        front: "怎么用数字让顾客觉得 39.9 元特别划算？",
        back: "100ml 大容量可持续稳定散香 60 至 90 天，折合每天不到 5 毛钱，就能享受专柜级居家香氛。",
        mantra: "算账法：用满 3 个月，日均不到 5 毛钱",
        mastered: false
      },
      {
        category: "连带搭售",
        front: "买香薰的顾客最容易连带哪款 15 元单品？",
        back: "顺带推荐 15 元同香型织物香氛喷雾，香薰放客厅卧室，喷雾用来喷窗帘衣柜和外套，全家统一留香。",
        mantra: "连带组合：无火香薰 + 15 元织物喷雾",
        mastered: false
      }
    ],
    rubric: {
      selling: ["奇华顿", "大牌", "白茶", "调香", "90", "60", "大容量"],
      objection: ["植物", "大豆", "酒精", "孕婴", "安全", "温和", "不刺鼻", "放心"],
      crossSell: ["喷雾", "15", "织物", "衣柜", "搭配", "试闻", "连带", "一套"],
      facts: [
        { label: "零售价 39.9 元", required: true, priceValue: "39.9", patterns: ["39.9", "39块9"] },
        { label: "0 酒精植物大豆溶剂", required: true, requiredGroups: [["0 酒精", "0酒精", "无酒精", "不含酒精"], ["植物", "大豆"]] },
        { label: "奇华顿调香 / 持久散香", required: true, requiredGroups: [["奇华顿"], ["两三个月", "60", "90", "散香"]] }
      ],
      avgPitch: "这款香薰卖得很好的，味道清淡不会难闻，放卧室应该没问题的，39.9 元挺便宜的。",
      demoPitch: "您完全放心！这款 39.9 元是国际大牌同源的奇华顿调香师研制的，采用植物大豆溶剂、0 酒精添加，温和不刺鼻，孕婴家庭放卧室也很安全。一瓶能散香两三个月，您也可以搭配 15 元同香型织物喷雾喷衣柜外套呢！"
    }
  },
  {
    id: "sanrio",
    icon: "pillow",
    tag: "收银凑单王",
    name: "三丽鸥玉桂狗云朵 U 型枕",
    summary: "3 秒慢回弹记忆棉 · 办公午休与差旅常青爆品",
    price: "¥29.90",
    passed: true,
    lastScore: 95,
    bestScore: 95,
    completedChapters: [true, true, true],
    points: [
      "高密度慢回弹记忆棉内芯，3 秒回弹护颈久压不塌",
      "背面隐形拉链设计，毛绒外套可随时拆下机洗",
      "自带按扣方便挂行李箱，连带同款 15 元蒸汽眼罩"
    ],
    chapters: [
      {
        short: "01 核心材质",
        title: "记忆棉内芯与可拆洗结构",
        preview: "3 秒慢回弹护颈 · 隐形拉链可机洗",
        speech: "很多顾客觉得浅色 U 型枕好看但怕脏、怕睡塌。我们这款精准解决两大痛点：内芯采用高密度慢回弹记忆棉，背面自带隐形拉链，绒布外套随时能拆下来清洗。",
        actions: [
          "内芯优势：贴合颈椎曲线，久压不变形。",
          "清洁卖点：隐形拉链不硌脖子，外套直接机洗。"
        ],
        mantra: "两大杀手锏：3 秒慢回弹 + 外套可拆洗"
      },
      {
        short: "02 现场演示",
        title: "陈列与双动作现场演示",
        preview: "立式挂架露脸部 · 按压内芯 + 拉开拉链",
        speech: "在出行配件区立式挂架陈列，保证玉桂狗立体大耳朵正面朝外。接待顾客时不必多说废话，直接当面做两个动作：用力按压展示 3 秒慢回弹，翻转拉开隐形拉链。",
        actions: [
          "动作一：按压内芯让顾客亲眼看 3 秒匀速回弹。",
          "动作二：展示前端按扣，可轻松扣在行李箱拉杆或书包上。"
        ],
        mantra: "演示口诀：一按看回弹，二拉看拆洗"
      },
      {
        short: "03 差旅连带",
        title: "午休与差旅两件套连带",
        preview: "连带 15 元三丽鸥蒸汽眼罩 · 客单立涨 50%",
        speech: "拿 U 型枕的客人大多是上班午休或准备出差旅游，顺势递上 15 元同系列三丽鸥蒸汽眼罩，组成 44.9 元「差旅舒睡两件套」，接受度极高。",
        actions: [
          "连带场景：办公室午休 / 高铁飞机长途出行。",
          "收银话术：配一盒同款 15 元热敷眼罩，午睡解乏一步到位。"
        ],
        mantra: "连带公式：29.9 元 U 型枕 + 15 元蒸汽眼罩"
      }
    ],
    persona: {
      name: "职场白领 · 林凯",
      style: "office",
      question: "白色毛绒拿去办公室午睡很容易弄脏吧？而且睡几次会不会就压扁塌掉了？",
      altQuestion: "我看网上很多二十多块的 U 型枕睡一个月就塌了，这只 29.9 元的白毛绒又该怎么洗？",
      happyReply: "可以拆洗又不会压塌那就太实用了，帮我拿一个再加盒蒸汽眼罩，正好出差用！",
      concernReply: "要是洗不了或者睡几天就塌了那还是算了。"
    },
    flashcards: [
      {
        category: "耐脏顾虑",
        front: "顾客嫌白色毛绒容易脏怎么一秒打消顾虑？",
        back: "直接翻转枕头拉开背面隐形拉链，展示绒布外套可随时轻松拆下机洗，保持洁白干净。",
        mantra: "现场动作：拉开隐形拉链 -> 可拆洗",
        mastered: true
      },
      {
        category: "塌陷异议",
        front: "如何证明这款 U 型枕不会睡几天就压扁？",
        back: "现场用力按压内芯松手，演示高密度记忆棉 3 秒慢回弹，贴合颈椎支撑力强、久压不变形。",
        mantra: "现场动作：用力按压 -> 3 秒慢回弹",
        mastered: true
      },
      {
        category: "出行卖点",
        front: "除了办公室午睡，还能推荐什么高频使用场景？",
        back: "前端自带稳固按扣，出差高铁/飞机可直接扣在行李箱拉杆或背包上，解放双手不占包内空间。",
        mantra: "场景拓展：午休 + 高铁差旅挂箱",
        mastered: true
      },
      {
        category: "连带搭售",
        front: "买 U 型枕时最自然的收银连带单品是什么？",
        back: "连带 15 元同系列三丽鸥蒸汽眼罩，组成「44.9 元差旅午休舒睡两件套」，客单立涨 50%。",
        mantra: "连带组合：U 型枕 + 15 元蒸汽眼罩",
        mastered: true
      }
    ],
    rubric: {
      selling: ["记忆棉", "高密度", "慢回弹", "三丽鸥", "按扣", "护颈"],
      objection: ["拆洗", "拉链", "机洗", "3秒", "回弹", "不塌", "不变形"],
      crossSell: ["眼罩", "15", "蒸汽", "午休", "套装", "搭配", "按压", "试试"],
      facts: [
        { label: "零售价 29.9 元", required: true, priceValue: "29.9", patterns: ["29.9", "29块9"] },
        { label: "隐形拉链可拆洗", required: true, requiredGroups: [["拉链"], ["拆洗", "机洗", "拆下"]] },
        { label: "记忆棉 3 秒慢回弹", required: true, requiredGroups: [["记忆棉"], ["3 秒", "3秒", "慢回弹", "回弹"]] }
      ],
      avgPitch: "白色是稍微容易脏一点，不过平时注意下就好，里面海绵挺软的，29.9 元买一个挺值的。",
      demoPitch: "您看它才 29.9 元还做了背面隐形拉链，白色绒套随时能拆下来机洗！内芯是高密度慢回弹记忆棉，您按一下试试，3 秒回弹久用不塌，再搭配 15 元同款蒸汽眼罩，办公室午休或出差坐高铁特别舒服哦！"
    }
  },
  {
    id: "loopy_cup",
    icon: "cup",
    tag: "IP 联名水具",
    name: "ZANMANG LOOPY 可露解忧季吸管保温杯（510ml）",
    summary: "正版赞萌露比联名 · 304不锈钢内胆 + 硅胶密封防漏双饮",
    price: "¥59.90",
    passed: false,
    lastScore: null,
    bestScore: null,
    completedChapters: [false, false, false],
    points: [
      "名创优品品牌大使 ZANMANG LOOPY 正版授权，工位吸睛解忧设计",
      "食品级 304 不锈钢内胆长效保温保冷，510ml 恰配日常通勤桌面容量",
      "食品级硅胶密封圈 + 可拆洗 PP 吸管，连带 9.9 元防尘吸管帽"
    ],
    chapters: [
      {
        short: "01 材质工艺",
        title: "304 不锈钢内胆与双饮结构",
        preview: "食品级 304 内胆 · 510ml 黄金办公容量",
        speech: "很多顾客以为 IP 联名水杯只是卖颜值，推荐这款时要立刻打消顾虑：它是正版 ZANMANG LOOPY 授权，内胆采用食品级 304 不锈钢，装热美式、冰椰水都不串味，510ml 刚好满足一上午办公饮水需求。",
        actions: [
          "安全材质：304 不锈钢内胆 + 食品级 PP 吸管与硅胶密封圈。",
          "饮用体验：吸管/直饮双模式，加冰不凝水不弄湿桌面文件。"
        ],
        mantra: "硬核卖点：304 不锈钢 + 510ml 黄金容量 + 硅胶防漏"
      },
      {
        short: "02 试样演示",
        title: "水具区陈列与防漏拆洗演示",
        preview: "1.2m IP 水具专架 · 拧盖展示可拆洗吸管与密封圈",
        speech: "陈列在水具 IP 专架 1.2 至 1.5 米黄金视线位，旁边必须放 1 只拆封样品。顾客担心吸管难洗或漏水时，当面旋开杯盖展示可拆卸硅胶密封圈与直通吸管，证明清洗无死角、倒置不漏水。",
        actions: [
          "动作一：旋开杯盖取出 PP 吸管，演示 3 秒拆洗无卫生死角。",
          "动作二：合盖展示加厚硅胶密封圈，通勤放包里安心防漏。"
        ],
        mantra: "演示动作：一拧看内胆，二拆看吸管清洗"
      },
      {
        short: "03 连带搭售",
        title: "异议化解与桌面治愈套装连带",
        preview: "加 9.9 元硅胶吸管帽 / LOOPY 毛绒包挂 · 提升客单",
        speech: "顾客纠结 59.9 元价格时，把正版联名情绪价值和 304 保温内胆拆开讲；结账时顺手推荐 9.9 元硅胶防尘吸管帽或同系列 LOOPY 毛绒挂件，直接组成工位解忧套装。",
        actions: [
          "异议化解：对比普通塑料杯，304 不锈钢四季可用且带正版 IP。",
          "连带公式：59.9 元保温杯 + 9.9 元硅胶防尘吸管帽 / 杯刷。"
        ],
        mantra: "连带金句：配个 9 块 9 防尘吸管帽，放工位干净不落灰"
      }
    ],
    persona: {
      name: "职场白领 · 林凯",
      style: "office",
      question: "这个露比吸管杯要 59 块 9 啊？吸管用久了会不会很难清洗，而且装包里通勤容易漏水吧？",
      altQuestion: "将近 60 块买个联名杯子，装热水放包里真不漏水吗？里面什么材质、容量够喝吗？",
      happyReply: "内胆是 304 不锈钢、吸管还能整个拆下来洗就太省心了，帮我拿一个再配个防尘吸管帽！",
      concernReply: "要是洗不干净或者装包漏水弄湿电脑就麻烦了，我再看看普通水杯吧。"
    },
    flashcards: [
      {
        category: "材质硬实力",
        front: "顾客觉得 59.9 元买 IP 吸管杯只是买颜值，怎么用材质说服？",
        back: "强调它是食品级 304 不锈钢保温保冷内胆 + 食品级硅胶密封圈，510ml 黄金容量四季通用，装冰饮不凝水、装热饮保温久。",
        mantra: "硬核卖点：304 不锈钢 + 510ml + 四季保温保冷",
        mastered: false
      },
      {
        category: "卫生与防漏",
        front: "顾客担心吸管难洗、放包里漏水，门店现场怎么演示？",
        back: "拿起拆封样品当面旋开杯盖，抽出可拆洗 PP 吸管展示无死角冲洗，并指明加厚硅胶密封圈卡槽，倒置晃动安心防漏。",
        mantra: "现场动作：旋盖抽吸管 + 展示硅胶密封圈",
        mastered: false
      },
      {
        category: "黄金陈列",
        front: "ZANMANG LOOPY 吸管保温杯在门店陈列的核心要求是什么？",
        back: "摆放在水具区 IP 联名专架 1.2–1.5m 黄金视线层，固定拆封 1 只展示杯盖密封结构，露比主视觉正面朝向过道。",
        mantra: "陈列规范：露比正面朝外 + 固定拆封样杯",
        mastered: false
      },
      {
        category: "连带搭售",
        front: "买 LOOPY 保温杯时最顺手的连带单品是什么？",
        back: "推荐加购 9.9 元硅胶防尘吸管帽或同系列 LOOPY 毛绒挂件，既解决桌面防灰痛点又拉升工位仪式感。",
        mantra: "连带话术：配个 9.9 元防尘吸管帽，放工位不落灰",
        mastered: false
      }
    ],
    rubric: {
      selling: ["304", "不锈钢", "510ml", "正版", "露比", "保温", "保冷"],
      objection: ["拆洗", "拆卸", "清洗", "硅胶", "密封", "防漏", "不漏水"],
      crossSell: ["样品", "吸管帽", "9.9", "挂件", "杯刷", "搭配", "连带", "试试"],
      facts: [
        { label: "零售价 59.9 元", required: true, priceValue: "59.9", patterns: ["59.9", "59块9"] },
        { label: "304 不锈钢 + 510ml", required: true, requiredGroups: [["304"], ["510ml", "510毫升", "510"]] },
        { label: "可拆洗吸管 + 硅胶防漏", required: true, requiredGroups: [["拆洗", "拆卸", "清洗"], ["硅胶", "防漏", "密封"]] }
      ],
      avgPitch: "这个是露比联名新款，外观挺可爱的，59.9 元质量还可以，平时喝水装包里小心一点就行。",
      demoPitch: "您放心看看这只拆封样品！这款 59.9 元是正版露比联名，内胆是食品级 304 不锈钢、510ml 保温保冷都能用。杯盖做了加厚硅胶密封圈倒置防漏，吸管也能整个拆洗不藏污纳垢，推荐您顺便配个 9.9 元硅胶防尘吸管帽放工位特别干净！"
    }
  },
  {
    id: "facial_towel",
    icon: "towel",
    tag: "日用复购王",
    name: "AB 双面植物纤维一次性洗脸巾（100抽）",
    summary: "100% 植物纤维 0 荧光剂 · A 面珍珠纹洁面 B 面平纹湿敷",
    price: "¥15.00",
    passed: false,
    lastScore: null,
    bestScore: null,
    completedChapters: [false, false, false],
    points: [
      "100% 优质植物纤维（粘胶纤维），0 荧光增白剂、0 香精，敏感肌安心",
      "AB 双面加厚工艺：A 面珍珠纹深层卸妆洁面，B 面细腻平纹温和湿敷",
      "100 抽大规格湿水韧性强不掉絮，连带 10 元便携压缩毛巾"
    ],
    chapters: [
      {
        short: "01 材质工艺",
        title: "植物纤维与 AB 双面纹理",
        preview: "0 荧光剂 · A面珍珠纹 + B面平纹 · 100抽",
        speech: "一次性洗脸巾是门店复购率最高的刚需引流品。推荐时抓住两个核心：第一，100% 植物纤维，不含荧光增白剂和香精；第二，AB 双面设计，一面珍珠纹摩擦力强适合洁面卸妆，另一面平纹细腻用来轻擦或湿敷。",
        actions: [
          "成分安心：通过无荧光剂检测，孕妇和敏感肌宝宝都能放心用。",
          "一巾两用：洗完脸还能顺手擦拭洗手台和镜子，一张抵两张。"
        ],
        mantra: "核心口诀：植物纤维 0 荧光 · AB 双面不掉絮"
      },
      {
        short: "02 撕拉试样",
        title: "主通道陈列与撕拉韧性演示",
        preview: "洗护主通道/收银凑单堆 · 现场展示湿水不破不掉絮",
        speech: "在个护洗护主通道和收银台前凑单堆头同步陈列。遇到犹豫的顾客，直接拿起剪开展示的样品巾体，让对方轻拉测试它的纵横交叉铺网韧性，再摸一摸 A/B 两面不同的立体纹路。",
        actions: [
          "动作一：请顾客轻拉试样巾体，直观感受加厚植物纤维不易撕破。",
          "动作二：用手背体验 A 面珍珠纹清洁力与 B 面平纹亲肤柔滑感。"
        ],
        mantra: "试样动作：一摸双面纹，二拉看韧性"
      },
      {
        short: "03 囤货连带",
        title: "性价比算账与出行连带组合",
        preview: "100 抽日均仅 1 毛 5 · 连带 10 元便携压缩毛巾",
        speech: "顾客觉得用一次性洗脸巾不如传统毛巾划算时，用「卫生+算账」两步化解：潮湿毛巾易滋生螨虫，15 元 100 抽每天仅 1 毛 5；准备出游或囤货时，顺手连带 10 元独立装便携压缩毛巾或 3 包装组合。",
        actions: [
          "异议化解：湿毛巾易长菌致痘，100 抽每张才 1 毛 5 更卫生。",
          "连带公式：15 元抽取式洗脸巾 + 10 元便携压缩毛巾 / 分装瓶。"
        ],
        mantra: "连带金句：家里用抽取款，出差配 10 元压缩毛巾"
      }
    ],
    persona: {
      name: "精致宝妈 · 安琪",
      style: "mom",
      question: "15 块一包的洗脸巾会不会擦脸掉毛絮、含荧光剂啊？天天用完就扔，感觉不如买条纯棉毛巾省钱？",
      altQuestion: "我脸容易泛红过敏，15 元这包洗脸巾是纯化纤还是植物纤维？一面擦脸一面卸妆够用吗？",
      happyReply: "100 抽每张才一毛五还 0 荧光剂，拉起来这么结实真不掉絮！给我拿三包再带一份压缩毛巾。",
      concernReply: "给宝宝和敏感肌用的东西我还是怕刺激掉絮，我再考虑看看吧。"
    },
    flashcards: [
      {
        category: "成分与工艺",
        front: "名创优品这款 100 抽洗脸巾的「AB 双面」分别用来做什么？",
        back: "A 面立体珍珠纹摩擦力强，适合深层洁面和卸妆；B 面细腻平纹触感柔软，适合温和擦拭、护肤湿敷以及宝宝娇嫩肌。",
        mantra: "AB 双面：A 面珍珠洁面 · B 面平纹湿敷",
        mastered: false
      },
      {
        category: "安全与掉絮",
        front: "敏感肌顾客担心含荧光剂、擦脸掉毛絮怎么解答？",
        back: "采用 100% 优质植物纤维交叉铺网工艺，0 荧光增白剂、0 香精，现场拉扯试样展示加厚韧性，湿水揉搓也不易破、不掉絮。",
        mantra: "安心三连：植物纤维 · 0 荧光剂 · 湿水不破",
        mastered: false
      },
      {
        category: "性价比异议",
        front: "顾客觉得一次性洗脸巾不如传统毛巾划算，怎么用算账法化解？",
        back: "浴室湿毛巾极易滋生细菌导致反复长痘，这款 15 元足足 100 抽，折合每张仅 1 毛 5，洗完脸还能顺手擦拭镜台实现二次利用。",
        mantra: "算账法：100 抽每张 1 毛 5，擦脸擦台一巾两用",
        mastered: false
      },
      {
        category: "连带搭售",
        front: "买抽纸式洗脸巾的顾客，收银台最适合连带什么？",
        back: "顺手推荐 10 元独立包装便携压缩毛巾（适合差旅/健身），或者引导直接拼 3 包装家庭囤货更划算。",
        mantra: "连带组合：抽取洗脸巾 + 10 元便携压缩毛巾",
        mastered: false
      }
    ],
    rubric: {
      selling: ["植物纤维", "AB", "珍珠纹", "平纹", "100抽", "双面"],
      objection: ["荧光", "不掉絮", "不易破", "细菌", "1毛5", "敏感肌", "划算"],
      crossSell: ["试样", "拉", "压缩毛巾", "10元", "囤货", "3包", "擦台", "搭配"],
      facts: [
        { label: "零售价 15 元 / 100 抽", required: true, priceValue: "15", requiredGroups: [["15"], ["100抽", "100 抽"]] },
        { label: "植物纤维 0 荧光剂", required: true, requiredGroups: [["植物纤维"], ["0 荧光", "0荧光", "无荧光", "不含荧光"]] },
        { label: "A 珍珠纹 / B 平纹", required: true, requiredGroups: [["珍珠纹"], ["平纹"]] }
      ],
      avgPitch: "这款洗脸巾卖得可好了，15 块钱挺大一包的，平时洗脸用起来挺方便的，买回去试试吧。",
      demoPitch: "您拉一下我们展示的样品感受下！这款 15 元 100 抽，是 100% 植物纤维、0 荧光剂和香精添加，敏感肌和宝宝都能放心用。A 面珍珠纹洁面卸妆、B 面平纹湿敷，湿水完全不掉絮不易破，每张才 1 毛 5 比潮湿毛巾卫生多啦，推荐您再搭一份 10 元便携压缩毛巾出差用哦！"
    }
  },
  {
    id: "hp_scarf",
    icon: "scarf",
    tag: "魔法爆款穿搭",
    name: "哈利·波特霍格沃茨学院条纹针织围巾",
    summary: "华纳正版授权 · 四大学院经典配色复刻 + 亲肤保暖针织",
    price: "¥59.00",
    passed: false,
    lastScore: null,
    bestScore: null,
    completedChapters: [false, false, false],
    points: [
      "华纳兄弟《哈利·波特》正版授权，精准复刻格兰芬多/斯莱特林等四大学院配色",
      "软糯亲肤针织混纺面料，垂坠感好不扎脖子，兼顾秋冬保暖与拍照出片",
      "仅售 59 元实现影城百元同款魔法穿搭，连带哈利·波特盲盒挂件"
    ],
    chapters: [
      {
        short: "01 学院卖点",
        title: "正版学院复刻与亲肤针织",
        preview: "华纳正版授权 · 四大学院条纹 · 59元高性价比",
        speech: "哈利·波特是超级长青的顶流 IP。推这款围巾时记住三个记忆点：第一是华纳官方正版授权，还原霍格沃茨四大学院经典撞色条纹；第二是加密亲肤针织面料不扎脖；第三是 59 元性价比极高，是影城同款周边几分之一的价格。",
        actions: [
          "情怀还原：格兰芬多红金、斯莱特林墨绿银两大爆款色优先推荐。",
          "亲肤质感：细密针织锁温保暖，佩戴出片率极高。"
        ],
        mantra: "核心卖点：华纳正版 + 四大学院色 + 59 元影城平替"
      },
      {
        short: "02 试戴陈列",
        title: "主题区挂样与试戴递镜动作",
        preview: "红金/墨绿主色平铺挂样 · 主动邀试戴并整理院徽",
        speech: "在 IP 服配专区垂直挂样陈列，必须将最热门的格兰芬多红金、斯莱特林绿银两色摆在最前排。看到顾客驻足看院徽时，立刻取下样品围巾邀请试戴，并顺手帮整理好学院刺绣/徽章正面露出的位置。",
        actions: [
          "陈列重点：四大学院色系按色块整齐垂挂，搭配魔法屋灯箱海报。",
          "试戴破冰：帮顾客把院徽朝前整理好，方便对方对镜自拍。"
        ],
        mantra: "门店动作：取下样巾邀试戴 + 整理院徽正面"
      },
      {
        short: "03 魔法连带",
        title: "起球顾虑化解与学院礼盒连带",
        preview: "连带哈利·波特盲盒挂件 / 学院陶瓷杯 · 送礼自用两相宜",
        speech: "遇到学生党担心 59 元针织围巾扎脖子或不如影城精致时，用亲肤手感试戴化解；确定购买后，顺势推荐搭配 39–59 元哈利·波特魔法屋盲盒挂件或学院陶瓷杯，一套百元左右就是超体面的魔法生日礼。",
        actions: [
          "异议化解：邀请贴脖试戴感受亲肤针织，强调正版吊牌工艺。",
          "连带公式：学院针织围巾 + 哈利·波特盲盒挂件 / 学院马克杯。"
        ],
        mantra: "连带金句：围巾配个同款魔法盲盒挂件，送礼仪式感拉满"
      }
    ],
    persona: {
      name: "潮流学生 · 小雨",
      style: "student",
      question: "哇，名创竟然有哈利波特学院围巾！不过 59 块钱的针织围巾戴起来会不会扎脖子、洗两次就变形啊？",
      altQuestion: "下周去环球影城拍照，你们 59 块的学院围巾是正版吗？会不会很薄不保暖、跟影城差很多？",
      happyReply: "试戴确实挺软糯不扎脖！红金配色拍照太出片了，帮我拿一条格兰芬多，再抽一个魔法盲盒挂件！",
      concernReply: "要是面料扎皮肤或者做工太粗糙，我还是攒钱去影城买算了。"
    },
    flashcards: [
      {
        category: "IP 与性价比",
        front: "面对哈迷顾客，这款 59 元学院围巾最核心的吸引力是什么？",
        back: "华纳官方正版授权，精准还原格兰芬多、斯莱特林等霍格沃茨四大学院经典条纹，用 59 元实现影城两三百元周边的同款魔法穿搭。",
        mantra: "关键词：华纳正版 · 四大学院 · 59 元影城平替",
        mastered: false
      },
      {
        category: "材质顾虑",
        front: "顾客担心 59 元针织围巾扎脖子、没质感怎么化解？",
        back: "立刻取下展示样巾邀请贴肤试戴，感受细密亲肤针织混纺的软糯保暖度，并展示正版授权吊牌与精致院徽细节。",
        mantra: "破冰动作：邀请贴脖试戴 + 指认正版吊牌",
        mastered: false
      },
      {
        category: "陈列与配色",
        front: "四大学院围巾在门店陈列时，哪两款配色必须放最前面？",
        back: "最畅销的「格兰芬多红金」和「斯莱特林绿银」必须垂挂在最前排视觉中心，并让学院徽章正面清晰露出。",
        mantra: "陈列法则：红金绿银居 C 位，院徽正面朝外",
        mastered: false
      },
      {
        category: "魔法连带",
        front: "买哈利·波特围巾时，怎样一句话自然连带提升客单？",
        back: "推荐搭配同系列哈利·波特魔法盲盒挂件或霍格沃茨陶瓷杯，整套百元出头，无论冬天自用还是送朋友都很有魔法氛围感。",
        mantra: "连带公式：学院围巾 + 魔法盲盒挂件 / 陶瓷杯",
        mastered: false
      }
    ],
    rubric: {
      selling: ["华纳", "正版", "霍格沃茨", "学院", "格兰芬多", "斯莱特林", "59"],
      objection: ["亲肤", "不扎", "软糯", "针织", "保暖", "吊牌", "影城"],
      crossSell: ["试戴", "盲盒", "挂件", "陶瓷杯", "搭配", "送礼", "一套", "试试"],
      facts: [
        { label: "零售价 59 元", required: true, priceValue: "59", patterns: ["59"] },
        { label: "华纳正版学院配色", required: true, requiredGroups: [["华纳", "正版"], ["学院", "格兰芬多", "斯莱特林"]] },
        { label: "亲肤保暖不扎脖", required: true, requiredGroups: [["亲肤", "软糯", "针织"], ["不扎", "保暖"]] }
      ],
      avgPitch: "这条哈利波特围巾 59 块钱很便宜了，颜色挺好看的，平时随便戴戴拍照效果不错。",
      demoPitch: "您拿样品试戴贴脖子感受下！这款是华纳正版授权的霍格沃茨学院围巾，加密针织特别亲肤软糯、保暖不扎脖，格兰芬多和斯莱特林配色复刻得超级正。59 元就能买到影城同款质感，您还可以顺便搭配一个同系列魔法盲盒挂件，这套穿搭或送礼都很赞哦！"
    }
  }
];

let selectedRole = "staff";
let currentSlide = 0;
let slideTimer = null;
let currentSku = PRODUCTS[0];
let currentScreen = "onboarding"; // 'onboarding' | 'home' | 'detail' | 'roleplay'
let staffReminded = false;

/* 首页激励与竞品模块状态 */
let userPoints = 860;
let userStreak = 5;
let homeFcFilter = "all";
let homeFcIndex = 0;
let homeFcFlipped = false;
let briefingIndex = 0;
let showBriefingAnswer = false;
let mgrCreateExpanded = false;
let floorTasksExpanded = true;
let supervisedStores = {};

const FLOOR_TASKS = [
  { id: "ft1", text: "核对入口堆头 Chiikawa 拆封样品", checkLabel: "样品已拆封摆正，且价签 ¥59.00 清晰朝外", pts: 15, done: false },
  { id: "ft2", text: "更换香薰区山野茶韵试闻扩香石", checkLabel: "已更换试闻扩香石，瓶身无渗漏且价签 ¥39.90 准确", pts: 15, done: false }
];
let floorTaskProofs = {};
let activeFloorProofId = "";
let floorProofDrafts = {};

const BRIEFING_QUIZZES = [
  {
    q: "早会抽查 1：顾客嫌 Chiikawa 盲盒 59 元贵，第一句话说什么，做什么动作？",
    a: "动作：立刻递拆封样品让顾客捏手感；话术：强调日本正版联名，拼端盒 6 个必不重样。"
  },
  {
    q: "早会抽查 2：宝妈问山野茶韵香薰放卧室是否安全，怎么用 3 个词消除顾虑？",
    a: "标准应答：奇华顿大牌调香 · 天然植物大豆溶剂 · 0 酒精孕婴家庭可用。"
  },
  {
    q: "早会抽查 3：顾客买三丽鸥 U 型枕，收银台最推荐顺手连带什么？",
    a: "连带公式：加 15 元搭配同系列蒸汽眼罩，组成 44.9 元差旅午休舒睡两件套。"
  },
  {
    q: "早会抽查 4：顾客嫌 LOOPY 吸管保温杯 59.9 元贵且怕吸管难洗、漏水怎么拆解？",
    a: "动作：旋开杯盖抽吸管+指明硅胶密封圈；话术：食品级 304 不锈钢内胆，可拆洗防漏，加 9.9 元配吸管帽。"
  },
  {
    q: "早会抽查 5：敏感肌问 15 元洗脸巾会掉絮吗，AB 双面分别怎么用？",
    a: "标准应答：100% 植物纤维 0 荧光剂，湿水不破不掉絮；A 面珍珠纹深层洁面卸妆，B 面平纹轻擦湿敷。"
  },
  {
    q: "早会抽查 6：哈利·波特学院围巾 59 元，哪个动作最容易打动哈迷成交并连带？",
    a: "动作：递格兰芬多/斯莱特林样巾试戴并整理院徽；连带：搭配同系列魔法盲盒挂件或学院陶瓷杯送礼。"
  }
];

const ROLE_WHEEL_ITEMS = DEMO_ACCOUNTS.map(acc => ({
  id: acc.id,
  role: acc.role,
  title: acc.wheelTitle,
  desc: acc.wheelDesc,
  caps: acc.wheelCaps,
  icon: acc.role === "staff"
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    : acc.role === "store_mgr"
      ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
      : acc.role === "hq_ops"
        ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10h8"/><path d="M8 14h5"/></svg>`
        : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`
}));
let roleWheelIndex = 0;
let selectedAccountId = DEMO_ACCOUNTS[0].id;

/* 产品细节讲解状态 */
let activeChapterIdx = 0;
let expandedSpeechIdx = -1;
let detailQaExpanded = false;
let detailQaMessages = [];

/* 虚拟形象语音对练状态 */
let ttsEnabled = true;
let isSpeaking = false;
let isRecording = false;
let recordSeconds = 0;
let recordTimer = null;
let speechRec = null;
let liveTranscript = "";
let avatarMood = "concern"; // 'concern' | 'listening' | 'happy'
let avatarSubtitle = "";
let lastUserSpeech = "";
let lastEvalResult = null;
let lastEvalIsDemo = false;
let roleplayUseAlt = false;
let showRoleplayTextBox = false;
let showUserTranscript = false;
let showCoachDetail = false;
let speakFallbackTimer = null;

/** P1/P2/先验发布：多账号隔离 + 门店严格可见性 + 服务端共享状态同步 */
const PILOT_STORAGE_KEY = "miniso_pilot_state_v1";
const TAB_ACCOUNT_SESSION_KEY = "miniso_tab_account_id";
const TAB_USER_SESSION_KEY = "miniso_tab_user_key";
let selectedUserByAccount = {};
const PILOT_STORES = ["北京路旗舰店", "深圳壹方城黑金店", "佛山祖庙百货店"];
const PILOT_STAFF_ROSTER = [
  { key: "linxiaomei", name: "林小美", role: "早班资深导购" },
  { key: "chenajie", name: "陈阿杰", role: "晚班导购" },
  { key: "wangxiaoxue", name: "王晓雪", role: "周末兼职" }
];
const MGR_AUDIT_REASONS = ["价格/规则讲错", "未做试样动作", "触发话术红线"];
const BASE_PRODUCT_IDS = new Set(PRODUCTS.map(p => p.id));
const BASE_SKU_SNAPSHOTS = {};
PRODUCTS.forEach(p => {
  BASE_SKU_SNAPSHOTS[p.id] = {
    passed: Boolean(p.passed),
    lastScore: p.lastScore ?? null,
    bestScore: p.bestScore ?? null,
    completedChapters: p.completedChapters.slice(),
    fcMastered: p.flashcards.map(f => ({ mastered: Boolean(f.mastered), rewardClaimed: Boolean(f.rewardClaimed), weakHint: "" }))
  };
});

function getSelectedUserForAccount(acc) {
  const users = Array.isArray(acc.users) && acc.users.length
    ? acc.users
    : [{ key: acc.staffKey || acc.id, name: acc.userName, title: acc.label }];
  const pickedKey = selectedUserByAccount[acc.id];
  return users.find(u => u.key === pickedKey) || users[0];
}

function getActiveAccount() {
  const base = DEMO_ACCOUNTS.find(a => a.id === selectedAccountId) || DEMO_ACCOUNTS[0];
  const user = getSelectedUserForAccount(base);
  return {
    ...base,
    userName: user.name,
    userTitle: user.title,
    selectedUserKey: user.key,
    staffKey: base.role === "staff" ? user.key : null,
    storeLine: `${base.storeName} · ${user.title}`
  };
}

function getCurrentStoreName() {
  return getActiveAccount().storeName;
}

function getCurrentStaffKey() {
  return getActiveAccount().staffKey || "linxiaomei";
}

function resolveAccountSlot(accOrUserId) {
  if (!accOrUserId) return null;
  if (accOrUserId === "mgr_beijing") return DEMO_ACCOUNTS.find(a => a.id === "store_mgr") || null;
  const direct = DEMO_ACCOUNTS.find(a => a.id === accOrUserId);
  if (direct) return direct;
  return DEMO_ACCOUNTS.find(a => Array.isArray(a.users) && a.users.some(u => u.key === accOrUserId)) || null;
}

function setActiveAccountById(accId, explicitUserKey) {
  const slot = resolveAccountSlot(accId);
  if (!slot) return;
  const idx = DEMO_ACCOUNTS.findIndex(a => a.id === slot.id);
  roleWheelIndex = idx;
  selectedAccountId = slot.id;
  selectedRole = slot.role;
  const userKeyToUse = explicitUserKey || (slot.id !== accId && accId !== "mgr_beijing" ? accId : "");
  if (userKeyToUse && Array.isArray(slot.users) && slot.users.some(u => u.key === userKeyToUse)) {
    selectedUserByAccount[slot.id] = userKeyToUse;
  }
  const activeUser = getSelectedUserForAccount(slot);
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem(TAB_ACCOUNT_SESSION_KEY, selectedAccountId);
      window.sessionStorage.setItem(TAB_USER_SESSION_KEY, activeUser.key);
    }
  } catch (_) {}
  syncCurrentAccountView();
}

let rolloutTasks = [
  {
    id: "task_chiikawa_48h",
    skuId: "chiikawa",
    stores: ["北京路旗舰店", "深圳壹方城黑金店"],
    deadlineHours: 48,
    deadlineLabel: "48小时内",
    deadlineAt: Date.now() + 48 * 3600 * 1000,
    status: "published",
    reviewer: "总部培训师 · 林敏",
    checklistConfirmed: true,
    publishedAt: "今日 09:00"
  },
  {
    id: "task_aroma_72h",
    skuId: "aroma",
    stores: ["北京路旗舰店"],
    deadlineHours: 72,
    deadlineLabel: "72小时内",
    deadlineAt: Date.now() + 72 * 3600 * 1000,
    status: "published",
    reviewer: "总部培训师 · 林敏",
    checklistConfirmed: true,
    publishedAt: "今日 09:00"
  }
];

let staffTaskRecords = {
  task_chiikawa_48h: {
    linxiaomei: {
      completedChapters: [false, false, false],
      lastScore: null,
      bestScore: null,
      passed: false,
      attempts: [],
      retrain: null,
      mgrAudit: null
    },
    chenajie: {
      completedChapters: [true, true, true],
      lastScore: 76,
      bestScore: 76,
      passed: false,
      attempts: [
        {
          score: 76,
          passed: false,
          missedFacts: ["端盒 6 个不重复"],
          weakestName: "异议化解",
          redlineHits: [],
          questionVariant: "原问法",
          at: "今天 10:15"
        }
      ],
      retrain: {
        focusPoint: "端盒 6 个不重复",
        beforeScore: 76,
        status: "pending",
        afterScore: null,
        afterMissedFacts: [],
        issuedAt: "今天 10:30"
      },
      mgrAudit: { status: "retrain", reason: "价格/规则讲错" }
    },
    wangxiaoxue: {
      completedChapters: [false, false, false],
      lastScore: null,
      bestScore: null,
      passed: false,
      attempts: [],
      retrain: null,
      mgrAudit: null
    }
  },
  task_aroma_72h: {
    linxiaomei: {
      completedChapters: [true, false, false],
      lastScore: null,
      bestScore: null,
      passed: false,
      attempts: [],
      retrain: null,
      mgrAudit: null
    }
  }
};

/** 独立按员工账号隔离积分、老品进度与闪卡状态 */
let staffPoints = { linxiaomei: 860, chenajie: 690, wangxiaoxue: 740, zhoulin: 720, hejing: 680 };
let staffProductStates = {};
let staffFlashcards = {};
let selectedMgrTaskId = "task_chiikawa_48h";
let mgrRetrainDraftReason = {};
let mgrManualScoreDraft = {};
let mgrSubPage = ""; // "" | "briefing" | "metrics" | "staff:<key>"
/** 首轮试点同口径业务收益对照记录（待试点实测更新，不虚构为已完成效果） */
let pilotBenchmarks = {
  hqMinsPilot: 12,
  hqMinsLegacy: 120,
  mgrMinsPilot: 18,
  mgrMinsLegacy: 55
};
let hqSelectedStores = ["北京路旗舰店", "深圳壹方城黑金店"];
let hqDeadlineHours = 48;
let hqChecklistConfirmed = true;
let lastServerUpdatedAt = 0;

function getSafeStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch (_) {}
  return null;
}

function nowTimeLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDeadlineLabel(task) {
  if (!task) return "48小时内";
  const diffMs = task.deadlineAt - Date.now();
  if (diffMs <= 0) return "已截止（需加急）";
  const hrs = Math.ceil(diffMs / 3600000);
  return hrs <= 24 ? `剩 ${hrs} 小时` : (task.deadlineLabel || `剩 ${hrs} 小时`);
}

function ensureStaffRecord(taskId, staffKey) {
  if (!staffTaskRecords[taskId]) staffTaskRecords[taskId] = {};
  if (!staffTaskRecords[taskId][staffKey]) {
    const task = rolloutTasks.find(t => t.id === taskId);
    const sku = task ? PRODUCTS.find(p => p.id === task.skuId) : null;
    const chLen = sku ? sku.chapters.length : 3;
    staffTaskRecords[taskId][staffKey] = {
      completedChapters: Array(chLen).fill(false),
      lastScore: null,
      bestScore: null,
      passed: false,
      attempts: [],
      retrain: null,
      mgrAudit: null,
      auditHistory: []
    };
  }
  if (!Array.isArray(staffTaskRecords[taskId][staffKey].auditHistory)) {
    staffTaskRecords[taskId][staffKey].auditHistory = [];
  }
  return staffTaskRecords[taskId][staffKey];
}

function getTasksForStore(storeName, includeDraft = false) {
  return rolloutTasks
    .filter(t => (includeDraft || t.status === "published") && t.stores.includes(storeName))
    .slice()
    .sort((a, b) => a.deadlineAt - b.deadlineAt);
}

function getActiveTaskForSku(skuId, storeName = getCurrentStoreName()) {
  const list = getTasksForStore(storeName);
  return list.find(t => t.skuId === skuId) || null;
}

/** 判断 SKU 是否受上新任务发布门禁管控（包含所有总部/店长新建商品及任务绑定商品） */
function isSkuTaskManaged(skuId) {
  return rolloutTasks.some(t => t.skuId === skuId) || skuId.startsWith("hq_") || skuId.startsWith("sku_");
}

/** 严格门禁：门店员工与店长只能访问已发布且指定到本人所在门店的任务商品 */
function canCurrentUserAccessSku(sku) {
  if (!sku) return false;
  if (selectedRole === "hq_ops" || selectedRole === "area_mgr") return true;
  if (!isSkuTaskManaged(sku.id)) return true;
  return Boolean(getActiveTaskForSku(sku.id, getCurrentStoreName()));
}

function getVisibleProducts() {
  return PRODUCTS.filter(canCurrentUserAccessSku);
}

function getCurrentUserPoints() {
  const key = getCurrentStaffKey();
  if (typeof staffPoints[key] !== "number") staffPoints[key] = 720;
  return staffPoints[key];
}

function addCurrentUserPoints(delta) {
  const key = getCurrentStaffKey();
  staffPoints[key] = Math.max(0, getCurrentUserPoints() + delta);
  userPoints = staffPoints[key];
}

/** 将当前操作过的 SKU 进度写回当前登录员工账号的独立记录 */
function syncLinRecordFromSku(sku) {
  if (!sku) return;
  const staffKey = getCurrentStaffKey();
  const storeName = getCurrentStoreName();
  if (!staffProductStates[staffKey]) staffProductStates[staffKey] = {};
  staffProductStates[staffKey][sku.id] = {
    passed: Boolean(sku.passed),
    lastScore: sku.lastScore ?? null,
    bestScore: sku.bestScore ?? null,
    completedChapters: sku.completedChapters.slice()
  };
  if (!staffFlashcards[staffKey]) staffFlashcards[staffKey] = {};
  staffFlashcards[staffKey][sku.id] = sku.flashcards.map(f => ({
    mastered: Boolean(f.mastered),
    rewardClaimed: Boolean(f.rewardClaimed),
    weakHint: f.weakHint || ""
  }));

  rolloutTasks.forEach(t => {
    if (t.skuId === sku.id && t.stores.includes(storeName)) {
      const rec = ensureStaffRecord(t.id, staffKey);
      rec.completedChapters = sku.completedChapters.slice();
      rec.lastScore = sku.lastScore;
      rec.bestScore = sku.bestScore;
      rec.passed = sku.passed;
    }
  });
}

function syncAllSkusFromLinRecords() {
  syncCurrentAccountView();
}

/** 按当前激活账号恢复其独立的学习进度、积分与闪卡状态，彻底隔离跨账号状态 */
function syncCurrentAccountView() {
  const staffKey = getCurrentStaffKey();
  const storeName = getCurrentStoreName();
  userPoints = getCurrentUserPoints();

  PRODUCTS.forEach(sku => {
    const snap = BASE_SKU_SNAPSHOTS[sku.id];
    const perStaff = staffProductStates[staffKey] && staffProductStates[staffKey][sku.id];
    const task = getActiveTaskForSku(sku.id, storeName);
    const taskRec = task ? ensureStaffRecord(task.id, staffKey) : null;

    if (taskRec) {
      sku.completedChapters = taskRec.completedChapters.slice();
      sku.lastScore = taskRec.lastScore;
      sku.bestScore = taskRec.bestScore;
      sku.passed = taskRec.passed;
    } else if (perStaff) {
      sku.completedChapters = perStaff.completedChapters.slice();
      sku.lastScore = perStaff.lastScore ?? null;
      sku.bestScore = perStaff.bestScore ?? null;
      sku.passed = Boolean(perStaff.passed);
    } else if (snap && staffKey === "linxiaomei") {
      sku.completedChapters = snap.completedChapters.slice();
      sku.lastScore = snap.lastScore;
      sku.bestScore = snap.bestScore;
      sku.passed = snap.passed;
    } else {
      sku.completedChapters = Array(sku.chapters.length).fill(false);
      sku.lastScore = null;
      sku.bestScore = null;
      sku.passed = false;
    }

    const fcSaved = staffFlashcards[staffKey] && staffFlashcards[staffKey][sku.id];
    sku.flashcards.forEach((fc, idx) => {
      if (fcSaved && fcSaved[idx]) {
        fc.mastered = Boolean(fcSaved[idx].mastered);
        fc.rewardClaimed = Boolean(fcSaved[idx].rewardClaimed);
        fc.weakHint = fcSaved[idx].weakHint || "";
      } else if (snap && snap.fcMastered[idx] && staffKey === "linxiaomei") {
        fc.mastered = snap.fcMastered[idx].mastered;
        fc.rewardClaimed = snap.fcMastered[idx].rewardClaimed;
        fc.weakHint = "";
      } else {
        fc.mastered = false;
        fc.rewardClaimed = false;
        fc.weakHint = "";
      }
    });
  });

  const visible = getVisibleProducts();
  if (visible.length && !canCurrentUserAccessSku(currentSku)) {
    currentSku = visible[0];
  }
}

function serializeSharedState() {
  const customProducts = PRODUCTS.filter(p => !BASE_PRODUCT_IDS.has(p.id));
  return {
    customProducts,
    rolloutTasks,
    staffTaskRecords,
    staffProductStates,
    staffFlashcards,
    staffPoints,
    userStreak,
    floorTaskProofs,
    selectedMgrTaskId,
    pilotBenchmarks
  };
}

function applySharedState(data) {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data.customProducts)) {
    // 保留最新定制商品集合并避免重复插入
    for (let i = PRODUCTS.length - 1; i >= 0; i--) {
      if (!BASE_PRODUCT_IDS.has(PRODUCTS[i].id)) PRODUCTS.splice(i, 1);
    }
    data.customProducts.slice().reverse().forEach(cp => {
      if (cp && cp.id && !PRODUCTS.some(p => p.id === cp.id)) {
        PRODUCTS.unshift(cp);
      }
    });
  }
  if (Array.isArray(data.rolloutTasks)) rolloutTasks = data.rolloutTasks;
  if (data.staffTaskRecords) staffTaskRecords = data.staffTaskRecords;
  if (data.staffProductStates) staffProductStates = data.staffProductStates;
  if (data.staffFlashcards) staffFlashcards = data.staffFlashcards;
  if (data.staffPoints) staffPoints = data.staffPoints;
  if (typeof data.userStreak === "number") userStreak = data.userStreak;
  if (data.floorTaskProofs && typeof data.floorTaskProofs === "object") {
    floorTaskProofs = data.floorTaskProofs;
  }
  if (data.selectedMgrTaskId) selectedMgrTaskId = data.selectedMgrTaskId;
  if (data.pilotBenchmarks && typeof data.pilotBenchmarks === "object") {
    pilotBenchmarks = { ...pilotBenchmarks, ...data.pilotBenchmarks };
  }
  if (typeof data.serverUpdatedAt === "number") lastServerUpdatedAt = data.serverUpdatedAt;
  syncCurrentAccountView();
}

function isHttpServerMode() {
  return typeof location !== "undefined" && /^https?:$/.test(location.protocol) && typeof fetch === "function";
}

function savePilotState() {
  if (selectedRole === "staff") {
    syncLinRecordFromSku(currentSku);
  }
  const payload = serializeSharedState();
  const storage = getSafeStorage();
  if (storage) {
    try { storage.setItem(PILOT_STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
  }
  if (isHttpServerMode()) {
    try {
      fetch("/api/pilot-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(r => r.json())
        .then(res => {
          if (res && res.serverUpdatedAt) lastServerUpdatedAt = res.serverUpdatedAt;
        })
        .catch(() => {});
    } catch (_) {}
  }
}

function loadPilotState() {
  const storage = getSafeStorage();
  if (storage) {
    try {
      const raw = storage.getItem(PILOT_STORAGE_KEY);
      if (raw) applySharedState(JSON.parse(raw));
    } catch (_) {}
  }
  syncCurrentAccountView();
}

async function fetchPilotStateFromServer(renderIfChanged = true) {
  if (!isHttpServerMode()) return;
  try {
    const res = await fetch("/api/pilot-state", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.initialized || !data.state) {
      savePilotState();
      return;
    }
    const incomingTs = data.state.serverUpdatedAt || 0;
    if (incomingTs !== lastServerUpdatedAt) {
      applySharedState(data.state);
      const storage = getSafeStorage();
      if (storage) {
        try { storage.setItem(PILOT_STORAGE_KEY, JSON.stringify(serializeSharedState())); } catch (_) {}
      }
      if (renderIfChanged && currentScreen === "home") {
        renderHome();
      } else if (renderIfChanged && currentScreen === "roleplay") {
        renderRoleplaySkuStrip();
      }
    }
  } catch (_) {}
}

function startServerSyncLoop() {
  if (!isHttpServerMode()) return;
  setInterval(() => {
    if (isRecording || currentScreen === "onboarding") return;
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;
    fetchPilotStateFromServer(true);
  }, 2500);
}

function resetPilotState() {
  const storage = getSafeStorage();
  if (storage) {
    try { storage.removeItem(PILOT_STORAGE_KEY); } catch (_) {}
  }
  const doReload = () => {
    showToast("已重置试点数据，正在刷新页面");
    if (typeof location !== "undefined" && location.reload) {
      setTimeout(() => location.reload(), 250);
    }
  };
  if (isHttpServerMode()) {
    fetch("/api/pilot-reset", { method: "POST" }).finally(doReload);
  } else {
    doReload();
  }
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 2300);
}

function stopAllAudio() {
  clearTimeout(speakFallbackTimer);
  clearInterval(recordTimer);
  isSpeaking = false;
  isRecording = false;
  if (window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  if (speechRec) {
    try { speechRec.abort(); } catch (_) {}
    speechRec = null;
  }
}

function showOnlyScreen(name) {
  currentScreen = name;
  ["onboarding", "home", "detail", "roleplay"].forEach(s => {
    const el = document.getElementById("screen-" + s);
    if (el) el.classList.toggle("hidden", s !== name);
  });
  document.getElementById("bottom-nav").classList.toggle("hidden", name === "onboarding");
  document.getElementById("status-bar").className = (name === "onboarding" || name === "home") ? "status-bar dark" : "status-bar light";
  if (name === "home") setNavActive("tab-home");
  if (name === "roleplay") setNavActive("tab-roleplay");
  if (name === "detail") setNavActive("");
}

/* ==================== P0 必考事实核对 & P2 补训三态共享辅助函数 ==================== */
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** P0：必考事实严格匹配（支持多组 AND 规则 + 价格否定防护） */
function matchFactRule(text, fact) {
  const src = String(text || "");
  if (!src || !fact) return false;

  if (fact.priceValue) {
    const pv = escapeRegex(fact.priceValue);
    const hasNegatedPrice = new RegExp(`(?:不是|并非|不只|不止|别报|错报成|不是卖)\\s*¥?${pv}`).test(src);
    const hasAffirmedPrice = new RegExp(`(?:^|[^0-9.])¥?${pv}(?:\\s*(?:元|块|块钱|元左右))?(?=$|[^0-9.])`).test(src)
      && !new RegExp(`^(?:.*(?:不是|并非|不只|不止)\\s*¥?${pv})(?!.*(?:零售价|售价|只要|就卖|卖|是)\\s*¥?${pv})`).test(src);
    if (hasNegatedPrice && !hasAffirmedPrice) return false;
  }

  if (Array.isArray(fact.requiredGroups) && fact.requiredGroups.length) {
    return fact.requiredGroups.every(group =>
      Array.isArray(group) && group.some(pt => pt && src.includes(pt))
    );
  }
  if (Array.isArray(fact.patterns) && fact.patterns.length) {
    return fact.patterns.some(pt => pt && src.includes(pt));
  }
  return false;
}

/** 规范化补训 4 态：pending / submitted_unfixed / fixed_pending_review / verified（兼容历史 done 状态） */
function normalizeRetrainStatus(rt) {
  if (!rt) return "";
  if (rt.status === "done") return rt.verified ? "verified" : "fixed_pending_review";
  return rt.status || "";
}

/** 员工侧是否仍必须留在首页与错项队列中 */
function isRetrainStillRequiredForStaff(rec) {
  const st = normalizeRetrainStatus(rec && rec.retrain);
  return st === "pending" || st === "submitted_unfixed";
}

/** P2：校验员工本次正式复练是否真正改正了店长指派的目标考点 */
function isRetrainFocusFixed(focusPoint, evalRes, sku, speechText) {
  if (!evalRes || (evalRes.redlineHits && evalRes.redlineHits.length > 0)) return false;
  const focus = String(focusPoint || "").trim();
  if (!focus) return Boolean(evalRes.passed);

  if (focus === "价格/规则讲错") {
    return evalRes.missedRequiredFacts.length === 0 && evalRes.missedFacts.length === 0;
  }
  if (focus === "未做试样动作") {
    const hasDemoAction = /(试|摸|按|拉|戴|看|展示|样品|样巾|试闻|拆开)/.test(String(speechText || ""));
    const objScore = evalRes.dims.find(d => d.key === "objection")?.score || 0;
    const crossScore = evalRes.dims.find(d => d.key === "crossSell")?.score || 0;
    return hasDemoAction && Math.max(objScore, crossScore) >= 75;
  }
  if (focus === "触发话术红线") {
    return evalRes.redlineHits.length === 0 && evalRes.missedRequiredFacts.length === 0 && evalRes.total >= 80;
  }

  const factChecks = Array.isArray(evalRes.factChecks) ? evalRes.factChecks : [];
  const matchedFact = factChecks.find(fc => {
    if (fc.label === focus || fc.label.includes(focus) || focus.includes(fc.label)) return true;
    const tokens = focus.split(/[\s/+·,，、]+/).filter(t => t.length >= 2);
    return tokens.some(tk => fc.label.includes(tk));
  });
  if (matchedFact) return Boolean(matchedFact.ok);

  const matchedDim = evalRes.dims.find(d => d.name === focus || focus.includes(d.name));
  if (matchedDim) return matchedDim.score >= 85 && evalRes.missedRequiredFacts.length === 0;

  return evalRes.missedRequiredFacts.length === 0 && evalRes.total >= 85;
}

/* ==================== 每件商品的学习进度与 5 态任务机 ==================== */
function getSkuProgressState(sku) {
  const total = sku.chapters.length;
  const doneCount = sku.completedChapters.filter(Boolean).length;
  const nextIdx = sku.completedChapters.findIndex(done => !done);
  const task = getActiveTaskForSku(sku.id, getCurrentStoreName());
  const rec = task ? ensureStaffRecord(task.id, getCurrentStaffKey()) : null;
  const deadlineTxt = task ? ` · 截止：${formatDeadlineLabel(task)}` : "";
  const rtStatus = normalizeRetrainStatus(rec && rec.retrain);

  if (rec && (rtStatus === "pending" || rtStatus === "submitted_unfixed")) {
    const isUnfixedRetry = rtStatus === "submitted_unfixed";
    return {
      code: "retrain",
      tagText: `${isUnfixedRetry ? "复练已提交 · 目标考点仍未改正" : "店长指派补训"}${deadlineTxt}`,
      badgeText: isUnfixedRetry ? "未改正 · 需复练" : "待补练",
      badgeClass: "status-warn",
      detailText: `${isUnfixedRetry ? "仍未改正考点" : "补训考点"}：${rec.retrain.focusPoint}${rec.lastScore !== null ? ` · 最近 ${rec.lastScore} 分` : ""}`,
      ctaLabel: "去补练",
      action: "roleplay",
      nextChapterIdx: nextIdx === -1 ? total - 1 : nextIdx,
      doneCount,
      total,
      task
    };
  }

  if (rec && rtStatus === "fixed_pending_review") {
    const recentScore = sku.lastScore !== null && sku.lastScore !== undefined ? sku.lastScore : (sku.bestScore || rec.retrain.afterScore || 85);
    return {
      code: "retrain_review",
      tagText: `目标考点已改正 · 待店长复查${deadlineTxt}`,
      badgeText: "已改正待复查",
      badgeClass: "status-ok",
      detailText: `考点「${rec.retrain.focusPoint}」已改正（最近 ${recentScore} 分），等待店长现场复查通过`,
      ctaLabel: sku.passed ? "再练巩固" : "继续冲刺",
      action: "roleplay",
      nextChapterIdx: nextIdx === -1 ? total - 1 : nextIdx,
      doneCount,
      total,
      task
    };
  }

  if (sku.passed) {
    const recentScore = sku.lastScore !== null && sku.lastScore !== undefined ? sku.lastScore : (sku.bestScore || 90);
    const highScore = sku.bestScore || recentScore;
    return {
      code: "passed",
      tagText: `任务已达标${deadlineTxt}`,
      badgeText: `已通关 ${highScore} 分`,
      badgeClass: "status-ok",
      detailText: `细节 ${doneCount}/${total} 节 · 最近对练 ${recentScore} 分（最高 ${highScore} 分）`,
      ctaLabel: "复习课程",
      action: "detail",
      nextChapterIdx: 0,
      doneCount,
      total,
      task
    };
  }
  if (sku.lastScore !== null && sku.lastScore !== undefined) {
    const allChaptersDone = doneCount === total;
    return {
      code: "failed",
      tagText: `${allChaptersDone ? "未通关 · 待复练" : "未通关 · 先补细节"}${deadlineTxt}`,
      badgeText: `未通关 ${sku.lastScore} 分`,
      badgeClass: "status-warn",
      detailText: allChaptersDone
        ? `细节 ${total}/${total} 已学完 · 最近 ${sku.lastScore} 分（最高 ${sku.bestScore} 分，>=85 分通关）`
        : `细节已学 ${doneCount}/${total} 节 · 最近对练 ${sku.lastScore} 分（>=85 分通关）`,
      ctaLabel: allChaptersDone ? "去对练" : "继续学",
      action: allChaptersDone ? "roleplay" : "detail",
      nextChapterIdx: nextIdx === -1 ? 0 : nextIdx,
      doneCount,
      total,
      task
    };
  }
  if (doneCount === total) {
    return {
      code: "ready_roleplay",
      tagText: `待对练 · 检验开口话术${deadlineTxt}`,
      badgeText: "去对练",
      badgeClass: "status-warn",
      detailText: `细节 ${total}/${total} 已学完 · 下一步语音通关`,
      ctaLabel: "去对练",
      action: "roleplay",
      nextChapterIdx: total - 1,
      doneCount,
      total,
      task
    };
  }
  if (doneCount > 0) {
    return {
      code: "learning",
      tagText: `学习中 · 已学 ${doneCount}/${total} 节${deadlineTxt}`,
      badgeText: `继续学 ${doneCount}/${total}`,
      badgeClass: "status-warn",
      detailText: `已学 ${doneCount}/${total} 节 · 下一步：${sku.chapters[nextIdx].short}`,
      ctaLabel: "继续学",
      action: "detail",
      nextChapterIdx: nextIdx,
      doneCount,
      total,
      task
    };
  }
  return {
    code: "todo",
    tagText: `${task ? "总部上新任务" : "待学习 · 本周新品"}${deadlineTxt}`,
    badgeText: `待学习 0/${total}`,
    badgeClass: "status-warn",
    detailText: `0/${total} 节 · 约 3 分钟吃透卖点与连带`,
    ctaLabel: "继续学",
    action: "detail",
    nextChapterIdx: 0,
    doneCount,
    total,
    task
  };
}

/** 按实际下发到本店的已发布任务、补训优先级和截止时间排序 */
function getDailyMission() {
  const storeName = getCurrentStoreName();
  const staffKey = getCurrentStaffKey();
  const storeTasks = getTasksForStore(storeName)
    .map(task => ({
      task,
      sku: PRODUCTS.find(p => p.id === task.skuId),
      rec: ensureStaffRecord(task.id, staffKey)
    }))
    .filter(item => Boolean(item.sku));

  const actionable = storeTasks.filter(item => {
    const needRetrain = isRetrainStillRequiredForStaff(item.rec);
    return needRetrain || !item.sku.passed;
  });

  if (actionable.length > 0) {
    actionable.sort((a, b) => {
      const aRetrain = isRetrainStillRequiredForStaff(a.rec) ? 0 : 1;
      const bRetrain = isRetrainStillRequiredForStaff(b.rec) ? 0 : 1;
      if (aRetrain !== bRetrain) return aRetrain - bRetrain;
      const aBucket = Math.round(a.task.deadlineAt / 3600000);
      const bBucket = Math.round(b.task.deadlineAt / 3600000);
      if (aBucket !== bBucket) return aBucket - bBucket;
      return rolloutTasks.indexOf(a.task) - rolloutTasks.indexOf(b.task);
    });
    const chosen = actionable[0];
    return {
      allDone: false,
      noTask: false,
      task: chosen.task,
      sku: chosen.sku,
      state: getSkuProgressState(chosen.sku)
    };
  }

  const visibleList = getVisibleProducts();
  const latestTask = storeTasks[0]?.task || null;
  const fallbackSku = storeTasks[0]?.sku || visibleList[0] || PRODUCTS[0];
  if (storeTasks.length === 0) {
    return {
      allDone: true,
      noTask: true,
      task: null,
      sku: fallbackSku,
      state: {
        code: "no_task",
        tagText: `${storeName} · 暂无总部上新任务`,
        badgeText: "等待总部发布",
        badgeClass: "status-warn",
        detailText: "总部尚未向本店发布或仅存草稿的新品任务均不会显示，可先复习常规商品。",
        ctaLabel: "复习常规品",
        action: "detail",
        task: null
      }
    };
  }

  return {
    allDone: true,
    noTask: false,
    task: latestTask,
    sku: fallbackSku,
    state: {
      code: "all_done",
      tagText: "门店上新任务已达标",
      badgeText: `${storeTasks.length}/${storeTasks.length} 全部通关`,
      badgeClass: "status-ok",
      detailText: `本店 ${storeTasks.length} 项总部上新任务已全部达标（最近截止：${formatDeadlineLabel(latestTask)}）`,
      ctaLabel: "复习课程",
      action: "detail",
      task: latestTask
    }
  };
}

function triggerSkuNextStep(id) {
  const sku = PRODUCTS.find(p => p.id === id);
  if (!sku || !canCurrentUserAccessSku(sku)) {
    showToast("当前门店暂无该商品的已发布任务");
    return;
  }
  const st = getSkuProgressState(sku);
  if (st.action === "roleplay") {
    openRoleplay(sku.id);
  } else {
    openCourse(sku.id);
  }
}

/* ==================== 引导页轮播与横向角色选择 ==================== */
function renderSlide() {
  const s = SLIDES[currentSlide];
  document.getElementById("ob-slide-card").innerHTML = `
    <div class="ob-slide-tag">${s.tag}</div>
    <div class="ob-slide-title">${s.title}</div>
    <div class="ob-slide-desc">${s.desc}</div>
  `;
  document.querySelectorAll(".ob-bar-btn").forEach((bar, idx) => {
    bar.classList.toggle("active", idx === currentSlide);
  });
}

function setSlide(idx) {
  currentSlide = idx;
  renderSlide();
  startSlideAutoPlay();
}

function startSlideAutoPlay() {
  clearInterval(slideTimer);
  slideTimer = setInterval(() => {
    currentSlide = (currentSlide + 1) % SLIDES.length;
    renderSlide();
  }, 4200);
}

let wheelMounted = false;
let suppressWheelClick = false;

function mountRoleWheel() {
  const slotsEl = document.getElementById("role-wheel-slots");
  const dotsEl = document.getElementById("role-wheel-dots");
  if (!slotsEl || !dotsEl) return;

  slotsEl.innerHTML = ROLE_WHEEL_ITEMS.map((item, idx) => `
    <div class="wheel-card" id="wheel-card-${idx}" onclick="onWheelCardClick(${idx})">
      <div class="wheel-card-inner">
        <div class="wheel-card-top">
          <div class="role-icon-box">${item.icon}</div>
          <span class="status-badge status-ok" id="wheel-badge-${idx}">已选身份</span>
        </div>
        <div>
          <div class="role-title">${item.title}</div>
          <div class="role-desc">${item.desc}</div>
        </div>
        <div class="role-caps">
          ${item.caps.map(c => `<span class="role-cap-pill">${c}</span>`).join("")}
        </div>
      </div>
    </div>
  `).join("");

  dotsEl.innerHTML = ROLE_WHEEL_ITEMS.map((item, idx) => `
    <button class="wheel-dot-btn" id="wheel-dot-${idx}" onclick="setRoleWheelIndex(${idx})" aria-label="选择${item.title}"></button>
  `).join("");

  wheelMounted = true;
}

function renderRoleWheel() {
  if (!wheelMounted) mountRoleWheel();
  const n = ROLE_WHEEL_ITEMS.length;
  const leftIdx = (roleWheelIndex - 1 + n) % n;
  const rightIdx = (roleWheelIndex + 1) % n;

  ROLE_WHEEL_ITEMS.forEach((item, idx) => {
    const card = document.getElementById("wheel-card-" + idx);
    const badge = document.getElementById("wheel-badge-" + idx);
    const dot = document.getElementById("wheel-dot-" + idx);
    const pos = idx === roleWheelIndex
      ? "pos-center"
      : (idx === leftIdx ? "pos-left" : (idx === rightIdx ? "pos-right" : "pos-back"));

    if (card) card.className = `wheel-card ${pos}`;
    if (badge) badge.style.visibility = idx === roleWheelIndex ? "visible" : "hidden";
    if (dot) dot.classList.toggle("active", idx === roleWheelIndex);
  });

  const acc = DEMO_ACCOUNTS[roleWheelIndex] || DEMO_ACCOUNTS[0];
  selectedAccountId = acc.id;
  selectedRole = acc.role;
  const activeUser = getSelectedUserForAccount(acc);
  renderObUserPicker(acc, activeUser);
  const btnSpan = document.querySelector("#ob-enter-btn span");
  if (btnSpan) {
    btnSpan.textContent = `以「${activeUser.name} · ${acc.wheelTitle}」进入`;
  }
}

function renderObUserPicker(acc, activeUser) {
  const pickerEl = document.getElementById("ob-user-picker");
  if (!pickerEl) return;
  const users = Array.isArray(acc.users) && acc.users.length
    ? acc.users
    : [{ key: acc.staffKey || acc.id, name: acc.userName, title: acc.label }];

  pickerEl.innerHTML = `
    <span class="ob-user-lbl">选择用户：</span>
    <div class="ob-user-pills">
      ${users.map(u => `
        <button type="button" class="ob-user-pill ${u.key === activeUser.key ? "active" : ""}" onclick="setSelectedUserForRole('${u.key}')">
          ${escapeHtml(u.name)}${users.length <= 2 && u.title ? ` · ${escapeHtml(u.title.replace(/^北京路|^华南|^总部|^对照门店/, "") || u.title)}` : ""}
        </button>
      `).join("")}
    </div>
  `;
}

function setSelectedUserForRole(userKey) {
  const acc = DEMO_ACCOUNTS[roleWheelIndex] || DEMO_ACCOUNTS[0];
  if (!acc) return;
  selectedUserByAccount[acc.id] = userKey;
  renderRoleWheel();
}

function onWheelCardClick(idx) {
  if (suppressWheelClick) {
    suppressWheelClick = false;
    return;
  }
  setRoleWheelIndex(idx);
}

function stepRoleWheel(delta) {
  const n = ROLE_WHEEL_ITEMS.length;
  roleWheelIndex = (roleWheelIndex + (delta > 0 ? 1 : -1) + n) % n;
  renderRoleWheel();
}

function setRoleWheelIndex(idx) {
  if (idx === roleWheelIndex) return;
  roleWheelIndex = idx;
  renderRoleWheel();
}

function initRoleWheelEvents() {
  const wrap = document.getElementById("role-wheel-wrap");
  if (!wrap) return;
  let wheelLock = 0;
  wrap.addEventListener("wheel", e => {
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock < 200) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 4) return;
    wheelLock = now;
    stepRoleWheel(delta > 0 ? 1 : -1);
  }, { passive: false });

  let dragStartX = null;
  const startDrag = x => { dragStartX = x; };
  const moveDrag = x => {
    if (dragStartX === null) return;
    const dx = dragStartX - x;
    if (Math.abs(dx) >= 34) {
      suppressWheelClick = true;
      stepRoleWheel(dx > 0 ? 1 : -1);
      dragStartX = x;
    }
  };
  const endDrag = () => { dragStartX = null; };

  wrap.addEventListener("touchstart", e => startDrag(e.touches[0].clientX), { passive: true });
  wrap.addEventListener("touchmove", e => moveDrag(e.touches[0].clientX), { passive: true });
  wrap.addEventListener("touchend", endDrag);

  wrap.addEventListener("mousedown", e => startDrag(e.clientX));
  window.addEventListener("mousemove", e => moveDrag(e.clientX));
  window.addEventListener("mouseup", () => {
    endDrag();
    setTimeout(() => { suppressWheelClick = false; }, 40);
  });
}

function enterHome() {
  clearInterval(slideTimer);
  stopAllAudio();
  const targetAcc = DEMO_ACCOUNTS[roleWheelIndex] || getActiveAccount();
  const activeUser = getSelectedUserForAccount(targetAcc);
  setActiveAccountById(targetAcc.id, activeUser.key);
  showOnlyScreen("home");
  renderHome();
  fetchPilotStateFromServer(true);
}

function backToOnboarding() {
  stopAllAudio();
  showOnlyScreen("onboarding");
  renderRoleWheel();
  startSlideAutoPlay();
}

function setNavActive(id) {
  document.getElementById("tab-home").classList.toggle("active", id === "tab-home");
  document.getElementById("tab-roleplay").classList.toggle("active", id === "tab-roleplay");
}

function goHomeTab() {
  stopAllAudio();
  syncCurrentAccountView();
  showOnlyScreen("home");
  renderHome();
  fetchPilotStateFromServer(true);
}

/** P2：收集当前员工待巩固的真实错项（优先取待补训考点与最近失分漏讲事实） */
function getEmployeeWeakFocuses() {
  const list = [];
  const storeName = getCurrentStoreName();
  const staffKey = getCurrentStaffKey();
  getTasksForStore(storeName).forEach(task => {
    const rec = ensureStaffRecord(task.id, staffKey);
    if (isRetrainStillRequiredForStaff(rec) && rec.retrain && rec.retrain.focusPoint) {
      list.push({ skuId: task.skuId, focus: rec.retrain.focusPoint, taskId: task.id });
    }
    const lastAttempt = rec.attempts[0];
    if (lastAttempt && !lastAttempt.passed && Array.isArray(lastAttempt.missedFacts)) {
      lastAttempt.missedFacts.forEach(f => {
        if (!list.some(x => x.skuId === task.skuId && x.focus === f)) {
          list.push({ skuId: task.skuId, focus: f, taskId: task.id });
        }
      });
    }
  });
  return list;
}

/** 计算闪卡与错项的匹配度，用于错项优先推送 */
function scoreCardAgainstFocus(card, focus) {
  if (!focus) return 0;
  const hay = `${card.category} ${card.front} ${card.back} ${card.mantra}`;
  const tokens = focus.split(/[\s/+·,，、]+/).filter(t => t.length >= 2);
  let score = 0;
  tokens.forEach(tk => {
    if (hay.includes(tk)) score += 2;
  });
  if (card.weakHint === focus) score += 4;
  return score;
}

/** 将与当前错项最匹配的对应闪卡唤醒至未掌握队列，驱动首页优先推荐 */
function flagWeakFlashcards(sku, missedFacts) {
  if (!sku || !Array.isArray(missedFacts) || !missedFacts.length) return;
  missedFacts.forEach(focus => {
    let bestCard = null;
    let bestScore = -1;
    sku.flashcards.forEach(fc => {
      const s = scoreCardAgainstFocus(fc, focus);
      if (s > bestScore) {
        bestScore = s;
        bestCard = fc;
      }
    });
    if (bestCard) {
      bestCard.mastered = false;
      bestCard.weakHint = focus;
    }
  });
}

/* ==================== 首页内嵌闪卡与店面清单逻辑 ==================== */
function getFilteredFlashcards() {
  const weakList = getEmployeeWeakFocuses();
  const visibleSkus = getVisibleProducts();
  const list = [];
  visibleSkus.forEach(p => {
    if (homeFcFilter === "all" || p.id === homeFcFilter) {
      const skuWeaks = weakList.filter(w => w.skuId === p.id);
      let topMatchIdx = -1;
      let topMatchScore = 0;
      if (skuWeaks.length) {
        p.flashcards.forEach((fc, idx) => {
          const sc = Math.max(...skuWeaks.map(w => scoreCardAgainstFocus(fc, w.focus)));
          if (sc > topMatchScore) {
            topMatchScore = sc;
            topMatchIdx = idx;
          }
        });
        if (topMatchIdx === -1 && p.flashcards.length) topMatchIdx = 0;
      }
      p.flashcards.forEach((fc, idx) => {
        const matchedWeak = skuWeaks.length
          ? (fc.weakHint || (idx === topMatchIdx ? skuWeaks[0].focus : ""))
          : "";
        list.push({
          skuId: p.id,
          skuName: p.name,
          idx,
          card: fc,
          priorityReason: matchedWeak
        });
      });
    }
  });
  // P2：存在错项且未掌握的闪卡优先排在复习队列最前
  list.sort((a, b) => {
    const aPri = a.priorityReason && !a.card.mastered ? 0 : 1;
    const bPri = b.priorityReason && !b.card.mastered ? 0 : 1;
    return aPri - bPri;
  });
  return list;
}

function setHomeFcFilter(filterId) {
  homeFcFilter = filterId;
  homeFcIndex = 0;
  homeFcFlipped = false;
  renderHome();
}

function flipHomeFlashcard() {
  homeFcFlipped = !homeFcFlipped;
  const el = document.getElementById("home-fc-card");
  if (el) {
    el.classList.toggle("flipped", homeFcFlipped);
    el.setAttribute("aria-pressed", String(homeFcFlipped));
  }
}

function markHomeFlashcard(isMastered) {
  const deck = getFilteredFlashcards();
  if (!deck.length) return;
  const safeIdx = Math.min(homeFcIndex, deck.length - 1);
  const card = deck[safeIdx].card;
  const wasMastered = card.mastered;
  if (wasMastered) card.rewardClaimed = true;
  card.mastered = isMastered;
  homeFcFlipped = false;

  if (isMastered && !wasMastered && !card.rewardClaimed) {
    card.rewardClaimed = true;
    card.weakHint = "";
    addCurrentUserPoints(10);
    showToast("已掌握本张闪卡，积分 +10");
  } else if (isMastered && !wasMastered) {
    card.weakHint = "";
    showToast("已重新巩固错项闪卡，建议去换问法复练");
  }

  const nextUnmastered = deck.findIndex((item, i) => i > safeIdx && !item.card.mastered);
  const anyUnmastered = deck.findIndex(item => !item.card.mastered);

  if (deck.every(item => item.card.mastered)) {
    homeFcIndex = deck.length;
    showToast("当前闪卡组已全部掌握，可进入语音对练");
  } else if (nextUnmastered !== -1) {
    homeFcIndex = nextUnmastered;
  } else if (anyUnmastered !== -1) {
    homeFcIndex = anyUnmastered;
  } else {
    homeFcIndex = (safeIdx + 1) % deck.length;
  }
  savePilotState();
  renderHome();
}

function resetHomeFlashcards() {
  const deck = getFilteredFlashcards();
  deck.forEach(item => { item.card.mastered = false; });
  homeFcIndex = 0;
  homeFcFlipped = false;
  savePilotState();
  renderHome();
}

function getFloorProofKey(storeName, taskId) {
  return `${storeName || getCurrentStoreName()}_${taskId}`;
}

function getFloorProof(taskId, storeName = getCurrentStoreName()) {
  return floorTaskProofs[getFloorProofKey(storeName, taskId)] || null;
}

function getFloorDraft(taskId) {
  if (!floorProofDrafts[taskId]) {
    floorProofDrafts[taskId] = { photoUrl: "", photoName: "", isDemoPhoto: false, checked: false, note: "" };
  }
  return floorProofDrafts[taskId];
}

function toggleFloorTask(taskId) {
  activeFloorProofId = activeFloorProofId === taskId ? "" : taskId;
  renderHome();
}

function buildDemoFloorPhotoUrl(taskId) {
  const title = taskId === "ft1" ? "Chiikawa 堆头实拍样例" : "山野茶韵试闻石实拍样例";
  const sub = `${getCurrentStoreName()} · 仅演示样例`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" rx="12" fill="#FFF1F2"/><rect x="14" y="14" width="292" height="152" rx="10" fill="#FFFFFF" stroke="#ED1C24" stroke-width="2" stroke-dasharray="6 4"/><circle cx="62" cy="70" r="24" fill="#FFE4E6"/><path d="M50 72l8 8 16-16" stroke="#ED1C24" stroke-width="3.5" fill="none" stroke-linecap="round"/><text x="102" y="66" font-size="16" font-weight="700" fill="#1A1A1A" font-family="sans-serif">${title}</text><text x="102" y="92" font-size="12" fill="#6B7280" font-family="sans-serif">${sub}</text><text x="102" y="118" font-size="11" fill="#ED1C24" font-family="sans-serif">已拍价签与陈列面 · 示例凭证</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function onFloorPhotoSelected(taskId, inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  const draft = getFloorDraft(taskId);
  const reader = new FileReader();
  reader.onload = ev => {
    const rawUrl = String(ev.target.result || "");
    if (typeof Image === "undefined" || typeof document === "undefined") {
      draft.photoUrl = rawUrl;
      draft.photoName = file.name;
      draft.isDemoPhoto = false;
      renderHome();
      return;
    }
    const img = new Image();
    img.onload = () => {
      const maxW = 360;
      const scale = img.width > maxW ? maxW / img.width : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        draft.photoUrl = canvas.toDataURL("image/jpeg", 0.65);
      } else {
        draft.photoUrl = rawUrl;
      }
      draft.photoName = file.name;
      draft.isDemoPhoto = false;
      renderHome();
    };
    img.onerror = () => {
      draft.photoUrl = rawUrl;
      draft.photoName = file.name;
      draft.isDemoPhoto = false;
      renderHome();
    };
    img.src = rawUrl;
  };
  reader.readAsDataURL(file);
}

function useDemoFloorPhoto(taskId) {
  const draft = getFloorDraft(taskId);
  draft.photoUrl = buildDemoFloorPhotoUrl(taskId);
  draft.photoName = `现场实拍_${taskId}.svg`;
  draft.isDemoPhoto = true;
  renderHome();
}

function toggleFloorDraftCheck(taskId) {
  const draft = getFloorDraft(taskId);
  draft.checked = !draft.checked;
  renderHome();
}

function updateFloorDraftNote(taskId, val) {
  const draft = getFloorDraft(taskId);
  draft.note = val;
}

function submitFloorProof(taskId) {
  const t = FLOOR_TASKS.find(item => item.id === taskId);
  if (!t) return;
  const draft = getFloorDraft(taskId);
  if (!draft.photoUrl) {
    showToast("请先拍照或上传现场实拍照片作为打卡依据");
    return;
  }
  if (!draft.checked) {
    showToast("请先勾选实物与价签核对确认");
    return;
  }
  const acc = getActiveAccount();
  const storeName = getCurrentStoreName();
  const key = getFloorProofKey(storeName, taskId);
  const existing = floorTaskProofs[key];
  const wasDone = Boolean(existing && existing.done);

  floorTaskProofs[key] = {
    done: true,
    photoUrl: draft.photoUrl,
    photoName: draft.photoName || "现场实拍.jpg",
    isDemoPhoto: Boolean(draft.isDemoPhoto),
    checked: true,
    note: String(draft.note || "").trim(),
    byName: acc.userName,
    byKey: getCurrentStaffKey(),
    at: nowTimeLabel(),
    verifyStatus: "pending_review",
    rejectReason: ""
  };
  if (!wasDone) {
    addCurrentUserPoints(t.pts);
  }
  activeFloorProofId = "";
  if (FLOOR_TASKS.every(item => Boolean(getFloorProof(item.id, storeName)?.done))) {
    floorTasksExpanded = false;
  }
  savePilotState();
  showToast(`已提交实拍凭证并打卡，积分 +${t.pts}（待店长核验）`);
  renderHome();
}

function revokeFloorProof(taskId) {
  const t = FLOOR_TASKS.find(item => item.id === taskId);
  const storeName = getCurrentStoreName();
  const key = getFloorProofKey(storeName, taskId);
  const existing = floorTaskProofs[key];
  if (!t || !existing || !existing.done) return;
  if (existing.verifyStatus === "verified") {
    showToast("店长已核销该实操凭证，不可撤回");
    return;
  }
  delete floorTaskProofs[key];
  addCurrentUserPoints(-t.pts);
  activeFloorProofId = taskId;
  savePilotState();
  showToast("已撤回打卡凭证并退回积分");
  renderHome();
}

function verifyFloorProof(storeName, taskId, approved) {
  const t = FLOOR_TASKS.find(item => item.id === taskId);
  const key = getFloorProofKey(storeName, taskId);
  const rec = floorTaskProofs[key];
  if (!t || !rec) return;
  if (approved) {
    rec.verifyStatus = "verified";
    rec.verifiedAt = nowTimeLabel();
    rec.rejectReason = "";
    showToast("已核验通过该实操凭证");
  } else {
    const prevKey = rec.byKey;
    if (rec.done && prevKey) {
      staffPoints[prevKey] = Math.max(0, (staffPoints[prevKey] ?? 720) - t.pts);
    }
    rec.done = false;
    rec.verifyStatus = "rejected";
    rec.rejectReason = "照片或陈列依据不清，请重新实拍提交";
    showToast("已退回重拍并扣回本次打卡积分");
  }
  savePilotState();
  renderHome();
}

function toggleFloorTasksExpand() {
  floorTasksExpanded = !floorTasksExpanded;
  renderHome();
}

function nextBriefing() {
  briefingIndex = (briefingIndex + 1) % BRIEFING_QUIZZES.length;
  showBriefingAnswer = false;
  renderHome();
}

function toggleBriefingAnswer() {
  showBriefingAnswer = !showBriefingAnswer;
  renderHome();
}

function toggleMgrCreatePanel() {
  mgrCreateExpanded = !mgrCreateExpanded;
  renderHome();
}

function superviseStore(storeName) {
  supervisedStores[storeName] = true;
  showToast(`已向「${storeName}」店长推送督导任务`);
  renderHome();
}

const PRODUCT_SHORT_NAMES = {
  chiikawa: "Chiikawa",
  aroma: "大师香薰",
  sanrio: "三丽鸥U枕",
  loopy_cup: "Loopy杯",
  facial_towel: "洗脸巾",
  hp_scarf: "哈利围巾"
};

/** 返回适配窄屏单行胶囊筛选栏的紧凑商品名 */
function getProductShortName(p) {
  if (PRODUCT_SHORT_NAMES[p.id]) return PRODUCT_SHORT_NAMES[p.id];
  const cleaned = p.name.replace(/^(MINISO|名创优品)[\s×·]*/i, "").split(" · ")[0].trim();
  return (cleaned || p.name).slice(0, 5);
}

function renderHomeFlashcardSection() {
  const visibleSkus = getVisibleProducts();
  if (homeFcFilter !== "all" && !visibleSkus.some(p => p.id === homeFcFilter)) {
    homeFcFilter = "all";
  }
  const deck = getFilteredFlashcards();
  const masteredCount = deck.filter(d => d.card.mastered).length;
  const pct = deck.length ? Math.round((masteredCount / deck.length) * 100) : 0;

  const filterPills = [
    { id: "all", label: "全部" },
    ...visibleSkus.map(p => ({ id: p.id, label: getProductShortName(p) }))
  ].map(f => `
    <button type="button" class="fc-filter-pill ${homeFcFilter === f.id ? "active" : ""}" onclick="setHomeFcFilter('${f.id}')">${escapeHtml(f.label)}</button>
  `).join("");

  if (deck.length && masteredCount === deck.length && homeFcIndex >= deck.length) {
    const fallbackSkuId = homeFcFilter === "all" ? (visibleSkus[0]?.id || PRODUCTS[0].id) : homeFcFilter;
    return `
      <div class="card fc-card-shell">
        <div class="fc-head-row">
          <div class="card-title">闪卡速记</div>
          <span class="status-badge status-ok">已全部掌握 ${masteredCount}/${deck.length}</span>
        </div>
        <div class="fc-filter-row">${filterPills}</div>
        <div style="background:var(--bg);border-radius:14px;padding:16px 14px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">
          <div style="font-size:15px;font-weight:800">本组 ${deck.length} 张考点闪卡已通关</div>
          <div style="font-size:13px;color:var(--text-secondary)">卖点、陈列与连带公式已熟记，建议直接开口实战。</div>
          <div class="fc-actions" style="width:100%;margin-top:4px">
            <button type="button" class="fc-btn-again" onclick="resetHomeFlashcards()">再刷一遍</button>
            <button type="button" class="fc-btn-master" onclick="openRoleplay('${fallbackSkuId}')">去对练</button>
          </div>
        </div>
      </div>
    `;
  }

  if (homeFcIndex >= deck.length) homeFcIndex = 0;
  const current = deck[homeFcIndex];
  const c = current.card;
  const hasWeakPriority = Boolean(current.priorityReason && !c.mastered);

  return `
    <div class="card fc-card-shell">
      <div class="fc-head-row">
        <div class="card-title">${hasWeakPriority ? "错项优先复习闪卡" : "闪卡速记"} · 第 ${homeFcIndex + 1}/${deck.length} 张</div>
        <span class="status-badge ${masteredCount === deck.length ? "status-ok" : "status-warn"}">已掌握 ${masteredCount}/${deck.length}</span>
      </div>

      ${hasWeakPriority ? `
        <div class="retrain-focus-banner" style="margin-bottom:8px">错项驱动优先推 · 针对「${escapeHtml(current.priorityReason)}」先记再换问法复练</div>
      ` : ""}

      <div class="fc-filter-row">${filterPills}</div>

      <div class="progress-track">
        <div class="progress-fill" style="width:${Math.max(10, pct)}%"></div>
      </div>

      <div class="fc-stage">
        <button type="button" class="fc-card ${homeFcFlipped ? "flipped" : ""}" id="home-fc-card" aria-pressed="${homeFcFlipped}" aria-label="闪卡：${escapeHtml(c.front)}，点击或按回车键翻转查看答案" onclick="flipHomeFlashcard()">
          <span class="fc-face fc-front">
            <span style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <span class="tag-pill">${escapeHtml(current.skuName.slice(0, 8))} · ${escapeHtml(c.category)}</span>
              <span style="font-size:12px;color:var(--muted);font-weight:600">${c.mastered ? "已掌握" : "点击翻转"}</span>
            </span>
            <span class="fc-question">${escapeHtml(c.front)}</span>
            <span class="fc-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              <span>点击或按空格/回车翻面</span>
            </span>
          </span>

          <span class="fc-face fc-back">
            <span style="display:flex;justify-content:space-between;align-items:center;gap:8px">
              <span class="tag-pill" style="background:var(--red);color:#FFFFFF">标准卖点与应答</span>
              <span style="font-size:12px;color:var(--red);font-weight:700">${escapeHtml(c.category)}</span>
            </span>
            <span class="fc-answer">${escapeHtml(c.back)}</span>
            <span class="fc-mantra">${escapeHtml(c.mantra)}</span>
          </span>
        </button>
      </div>

      <div class="fc-actions">
        <button type="button" class="fc-btn-again" onclick="markHomeFlashcard(false)">需再巩固</button>
        <button type="button" class="fc-btn-master" onclick="markHomeFlashcard(true)">已掌握${c.rewardClaimed ? "" : " · +10 分"}</button>
      </div>
      ${hasWeakPriority ? `
        <button type="button" class="btn-secondary-soft" style="width:100%;height:38px;margin-top:8px" onclick="openRoleplay('${current.skuId}', { useAlt: true })">练完这卡 → 换一种顾客问法复练</button>
      ` : ""}
    </div>
  `;
}

/** 计算与页面展示完全一致的门店积分榜单与个人排名 */
function getStoreLeaderboard() {
  const acc = getActiveAccount();
  const pts = getCurrentUserPoints();
  const myKey = acc.staffKey || acc.selectedUserKey;
  const peers = PILOT_STAFF_ROSTER
    .filter(s => s.key !== myKey)
    .map(s => ({
      name: s.name,
      role: s.role,
      score: typeof staffPoints[s.key] === "number" ? staffPoints[s.key] : 720,
      isMe: false
    }));
  const rows = [
    { name: `${acc.userName}（我）`, role: `${acc.storeName} · 连学 ${userStreak} 天`, score: pts, isMe: true },
    ...peers
  ].sort((a, b) => b.score - a.score || (a.isMe ? -1 : 1));
  const myIndex = rows.findIndex(r => r.isMe);
  const topScore = rows[0].score;
  return { rows, myRankNum: myIndex + 1, gapToTop: Math.max(0, topScore - pts) };
}

/** 共享构建结构化 SKU 课程对象（供总部发课与店长快速补充微课共用） */
function buildStructuredSku({ id, tag, name, rawPrice, crossItem, desc, factLabels }) {
  const priceMatch = rawPrice.match(/\d+(?:\.\d+)?/);
  const priceNum = priceMatch ? priceMatch[0] : "";
  const priceShort = priceNum.replace(/\.00$/, "");
  const formattedPrice = rawPrice.startsWith("¥") ? rawPrice : `¥${priceNum || rawPrice}`;
  const cross = crossItem || "门店收银凑单小件";
  const parts = desc.split(/[，。；,]/).map(s => s.trim()).filter(Boolean);

  // 拆出干净、无重复的短关键词，避免命中词截断重复
  const extractTokens = txt => String(txt || "")
    .split(/[\s，。；,、·×]+/)
    .flatMap(seg => seg.length > 6 ? [seg.slice(0, 2), seg.slice(2, 6), seg.slice(-2)] : [seg])
    .map(s => s.trim())
    .filter(s => s.length >= 2);
  const uniq = arr => [...new Set(arr.filter(Boolean))];

  const facts = [];
  if (priceShort) {
    const pricePatterns = uniq([priceNum, priceShort]);
    facts.push({ label: `零售价 ${priceShort} 元`, required: true, priceValue: priceShort, patterns: pricePatterns });
  }
  const makeLabelGroups = label => {
    const segs = String(label || "").split(/[\s/+·,，、]+/).map(s => s.trim()).filter(s => s.length >= 2);
    if (segs.length >= 2) return segs.map(sg => uniq([sg, sg.slice(0, 2), sg.slice(-2)]));
    const clean = String(label || "").trim();
    if (clean.length >= 6) {
      const mid = Math.floor(clean.length / 2);
      return [
        uniq([clean.slice(0, 4), clean.slice(0, 2)]),
        uniq([clean.slice(-4), clean.slice(-2), clean.slice(mid, mid + 2)])
      ];
    }
    return [uniq([clean, clean.slice(0, 4), clean.slice(-4)])];
  };
  if (Array.isArray(factLabels) && factLabels.length) {
    factLabels.forEach(fl => {
      if (!fl) return;
      if (priceShort && (fl.includes(priceShort) || fl.includes(priceNum)) && facts.some(f => f.patterns.includes(priceShort))) return;
      const flTokens = uniq([fl, fl.slice(0, 4), fl.slice(-4)]);
      facts.push({ label: fl, required: true, requiredGroups: makeLabelGroups(fl), patterns: flTokens });
    });
  } else if (parts[0]) {
    facts.push({ label: parts[0].slice(0, 12), required: true, patterns: [parts[0].slice(0, 4)] });
  }

  const factTokens = uniq(facts.flatMap(f => f.patterns));
  const descTokens = uniq(extractTokens(desc));
  const crossPriceMatch = cross.match(/\d+(?:\.\d+)?/);
  const crossPrice = crossPriceMatch ? crossPriceMatch[0].replace(/\.00$/, "") : "";
  const crossNameClean = cross.replace(/¥?\d+(?:\.\d+)?\s*元?/g, "").trim();

  const sellingKws = uniq([
    ...(priceShort ? [priceShort] : []),
    ...factTokens.slice(0, 3),
    ...descTokens
  ]).slice(0, 6);

  const objectionKws = uniq([
    "正版", "授权", "软糯", "材质", "规格", "背带", "肩带", "放心", "性价比",
    ...descTokens.slice(1, 5)
  ]).slice(0, 6);

  const crossSellKws = uniq([
    "配", "搭", "搭配", "连带", "展示", "试试",
    ...(crossPrice ? [crossPrice] : []),
    ...(crossNameClean ? [crossNameClean, crossNameClean.slice(-2)] : [])
  ]).slice(0, 7);

  return {
    id,
    icon: "box",
    tag: tag || "总部上新任务",
    name,
    summary: parts.slice(0, 2).join(" · ") || "门店新上架主推单品",
    price: formattedPrice,
    passed: false,
    lastScore: null,
    bestScore: null,
    completedChapters: [false, false, false],
    points: parts.length ? parts : [desc],
    chapters: [
      {
        short: "01 核心卖点",
        title: "核实零售价与核心卖点",
        preview: `${formattedPrice} · ${parts[0] || "核心规格卖点"}`,
        speech: `本次门店新上架【${name}】，零售价 ${formattedPrice}。介绍时严格按审校资料陈述：${desc}。`,
        actions: (parts.length ? parts.slice(0, 2) : [desc]).map(pt => `核心事实：${pt}。`),
        mantra: `必背要点：${formattedPrice} · ${parts[0] || name}`
      },
      {
        short: "02 陈列试样",
        title: "黄金陈列位与实物体验",
        preview: "主通道/收银重点位 · 主动递上样品或展示实物",
        speech: `将【${name}】陈列在门店核心视线位或收银周边，顾客驻足时主动展示实物细节并复述核心规格：${parts[0] || desc}。`,
        actions: [
          `陈列要求：保证价签清晰准确（${formattedPrice}），主视觉正面朝外。`,
          "体验动作：引导顾客近距离查看材质与包装规格，禁止做未授权功效承诺。"
        ],
        mantra: "动作要领：先让顾客看实物，再讲核实规格"
      },
      {
        short: "03 连带异议",
        title: "价格异议与收银连带推荐",
        preview: `${formattedPrice} 价值拆解 · 连带 ${cross}`,
        speech: `顾客犹豫价格时，用【${parts[0] || desc}】解释性价比；结账时自然连带推荐【${cross}】，提升客单价。`,
        actions: [
          `异议化解：围绕 ${formattedPrice} 与经审校材质/规格讲清实际使用价值。`,
          `收银连带：顺手搭配「${cross}」推荐给顾客。`
        ],
        mantra: `连带公式：${name.slice(0, 8)} + ${cross}`
      }
    ],
    persona: {
      name: "到店顾客 · 思琪",
      style: "student",
      question: `这个 ${name} 卖 ${formattedPrice}，具体有什么特点和优势，值得买吗？`,
      altQuestion: `听朋友说这款 ${name} 只要 ${formattedPrice}，如果自用或送人，核心规格和搭配怎么挑最值？`,
      happyReply: `原来是这样，${formattedPrice} 讲得很清楚，那我拿一个再看看 ${cross}！`,
      concernReply: "核心参数和价格没太听明白，我先再逛逛看吧。"
    },
    flashcards: [
      {
        category: "核心事实",
        front: `【${name}】的零售价与核心卖点是什么？`,
        back: `零售价 ${formattedPrice}；核心卖点：${desc}`,
        mantra: `核对要点：${formattedPrice} · ${parts[0] || name}`,
        mastered: false
      },
      {
        category: "实操展示",
        front: `向顾客介绍【${name}】时，第一动作和话术红线是什么？`,
        back: `先展示实物与清晰价签（${formattedPrice}），严格按审校参数讲解，严禁虚构功效或超范围承诺。`,
        mantra: "红线：只讲审校事实，不做绝对化承诺",
        mastered: false
      },
      {
        category: "收银连带",
        front: `顾客买【${name}】时，最推荐连带哪款商品？`,
        back: `在讲解完本品价值后，自然引导搭配「${cross}」一起带走。`,
        mantra: `连带推荐：${cross}`,
        mastered: false
      }
    ],
    rubric: {
      selling: sellingKws,
      objection: objectionKws,
      crossSell: crossSellKws,
      facts,
      avgPitch: `这款商品价格是 ${formattedPrice}，卖得还可以，您喜欢的话可以拿一个。`,
      demoPitch: `您看看这款【${name}】实物，零售价 ${formattedPrice}，重点在于${desc}，正版材质手感很放心！您还可以顺便搭配「${cross}」一起带走试试哦！`
    }
  };
}

function getRetrainFocusOptions(sku, lastAttempt) {
  const opts = [];
  if (lastAttempt && Array.isArray(lastAttempt.missedFacts)) {
    lastAttempt.missedFacts.forEach(f => { if (!opts.includes(f)) opts.push(f); });
  }
  if (sku && sku.rubric && Array.isArray(sku.rubric.facts)) {
    sku.rubric.facts.forEach(f => { if (!opts.includes(f.label)) opts.push(f.label); });
  }
  MGR_AUDIT_REASONS.forEach(r => { if (!opts.includes(r)) opts.push(r); });
  return opts.slice(0, 4);
}

/** 店长：切换查看门店的上新任务 */
function selectMgrTask(taskId) {
  selectedMgrTaskId = taskId;
  mgrSubPage = "";
  savePilotState();
  renderHome();
}

function openMgrSubPage(page) {
  mgrSubPage = page || "";
  renderHome();
}

function closeMgrSubPage() {
  mgrSubPage = "";
  renderHome();
}

function openMgrStaffDetail(staffKey) {
  openMgrSubPage(staffKey ? `staff:${staffKey}` : "");
}

function closeMgrStaffDetail() {
  closeMgrSubPage();
}

function selectMgrRetrainFocus(taskId, staffKey, optIdx) {
  const task = rolloutTasks.find(t => t.id === taskId);
  const sku = task ? PRODUCTS.find(p => p.id === task.skuId) : null;
  const rec = ensureStaffRecord(taskId, staffKey);
  const opts = getRetrainFocusOptions(sku, rec.attempts[0]);
  if (opts[optIdx]) {
    mgrRetrainDraftReason[`${taskId}_${staffKey}`] = opts[optIdx];
    renderHome();
  }
}

function selectMgrManualScore(taskId, staffKey, score) {
  mgrManualScoreDraft[`${taskId}_${staffKey}`] = score;
  renderHome();
}

/** 持久记录 AI 评分与店长人工抽查的对比分歧（不因后续复查通过而覆盖历史分歧） */
function recordMgrAuditDiff(rec, mgrPassed, manualScore, reason) {
  if (!Array.isArray(rec.auditHistory)) rec.auditHistory = [];
  const lastAttempt = rec.attempts && rec.attempts[0] ? rec.attempts[0] : null;
  const aiScore = lastAttempt ? lastAttempt.score : rec.lastScore;
  const aiPassed = lastAttempt ? Boolean(lastAttempt.passed) : Boolean(rec.passed);
  const hasAiEval = aiScore !== null && aiScore !== undefined;

  let mismatchType = "manual_only";
  if (hasAiEval) {
    if (aiPassed && !mgrPassed) mismatchType = "ai_overrated";
    else if (!aiPassed && mgrPassed) mismatchType = "ai_underrated";
    else mismatchType = "aligned";
  }

  rec.auditHistory.unshift({
    at: nowTimeLabel(),
    aiPassed,
    aiScore,
    mgrPassed,
    mgrScore: manualScore,
    mismatchType,
    reason: reason || ""
  });
  return { aiScore, aiPassed, mismatchType };
}

function updatePilotBenchmark(key, value) {
  const num = Math.max(1, Math.min(999, Number(value) || 0));
  if (!num) return;
  pilotBenchmarks[key] = num;
  savePilotState();
  renderHome();
}

/** 渲染首轮试点同口径业务收益对照卡（48h 抽查覆盖/通过、AI 与店长分歧、总部/店长工时） */
function renderPilotValueCard(tasks, isHqView) {
  const scopedTasks = (tasks || []).filter(t => t.status === "published");
  let totalStaffSlots = 0;
  let auditedSlots = 0;
  let auditedPassedSlots = 0;
  let totalDiffEvents = 0;
  let overratedEvents = 0;
  let underratedEvents = 0;
  let alignedEvents = 0;

  scopedTasks.forEach(t => {
    PILOT_STAFF_ROSTER.forEach(s => {
      totalStaffSlots += 1;
      const rec = ensureStaffRecord(t.id, s.key);
      if (rec.mgrAudit && rec.mgrAudit.status) {
        auditedSlots += 1;
        if (rec.mgrAudit.status === "approved") auditedPassedSlots += 1;
      }
      if (Array.isArray(rec.auditHistory)) {
        rec.auditHistory.forEach(h => {
          if (h.mismatchType === "ai_overrated") {
            totalDiffEvents += 1;
            overratedEvents += 1;
          } else if (h.mismatchType === "ai_underrated") {
            totalDiffEvents += 1;
            underratedEvents += 1;
          } else if (h.mismatchType === "aligned") {
            alignedEvents += 1;
          }
        });
      }
    });
  });

  const covPct = totalStaffSlots ? Math.round((auditedSlots / totalStaffSlots) * 100) : 0;
  const passPct = auditedSlots ? Math.round((auditedPassedSlots / auditedSlots) * 100) : 0;
  const hqSavedPct = pilotBenchmarks.hqMinsLegacy > 0
    ? Math.max(0, Math.round((1 - pilotBenchmarks.hqMinsPilot / pilotBenchmarks.hqMinsLegacy) * 100))
    : 0;
  const mgrSavedPct = pilotBenchmarks.mgrMinsLegacy > 0
    ? Math.max(0, Math.round((1 - pilotBenchmarks.mgrMinsPilot / pilotBenchmarks.mgrMinsLegacy) * 100))
    : 0;

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">首轮试点同口径验证指标</div>
          <div class="card-sub">聚焦「员工能否 48h 讲对」与「店长/总部是否省时」</div>
        </div>
        <span class="status-badge ${totalDiffEvents ? "status-warn" : "status-ok"}">判定分歧 ${totalDiffEvents} 次</span>
      </div>
      <div class="kpi-grid">
        <div class="kpi-item">
          <div class="kpi-num">${covPct}%</div>
          <div class="kpi-label">48h抽查覆盖(${auditedSlots}/${totalStaffSlots})</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-num">${passPct}%</div>
          <div class="kpi-label">抽查通过(${auditedPassedSlots}/${Math.max(1, auditedSlots)})</div>
        </div>
        <div class="kpi-item">
          <div class="kpi-num">${totalDiffEvents}/${totalDiffEvents + alignedEvents}</div>
          <div class="kpi-label">AI/人工分歧(高${overratedEvents}/严${underratedEvents})</div>
        </div>
      </div>
      <div class="list-row" style="margin-top:8px">
        <div>
          <div class="list-row-main">总部单款审校发布工时</div>
          <div class="list-row-sub">试点 ${pilotBenchmarks.hqMinsPilot} 分钟 vs 现行 ${pilotBenchmarks.hqMinsLegacy} 分钟（降本 ${hqSavedPct}%）</div>
        </div>
        ${isHqView ? `<input type="number" min="1" max="999" aria-label="总部试点工时(分钟)" class="input-field" style="width:74px;margin:0;padding:6px 8px;text-align:center" value="${pilotBenchmarks.hqMinsPilot}" onchange="updatePilotBenchmark('hqMinsPilot', this.value)" />` : `<span class="status-badge status-ok">省 ${pilotBenchmarks.hqMinsLegacy - pilotBenchmarks.hqMinsPilot} 分钟</span>`}
      </div>
      <div class="list-row">
        <div>
          <div class="list-row-main">店长单款新品带教工时</div>
          <div class="list-row-sub">试点 ${pilotBenchmarks.mgrMinsPilot} 分钟 vs 现行 ${pilotBenchmarks.mgrMinsLegacy} 分钟（省时 ${mgrSavedPct}%）</div>
        </div>
        ${!isHqView ? `<input type="number" min="1" max="999" aria-label="店长带教工时(分钟)" class="input-field" style="width:74px;margin:0;padding:6px 8px;text-align:center" value="${pilotBenchmarks.mgrMinsPilot}" onchange="updatePilotBenchmark('mgrMinsPilot', this.value)" />` : `<span class="status-badge status-ok">省 ${pilotBenchmarks.mgrMinsLegacy - pilotBenchmarks.mgrMinsPilot} 分钟</span>`}
      </div>
    </div>
  `;
}

/** 店长：针对员工卡点发起补训 */
function issueMgrRetrain(taskId, staffKey) {
  const task = rolloutTasks.find(t => t.id === taskId);
  const sku = task ? PRODUCTS.find(p => p.id === task.skuId) : null;
  const rec = ensureStaffRecord(taskId, staffKey);
  const lastAttempt = rec.attempts[0];
  const draftKey = `${taskId}_${staffKey}`;
  const opts = getRetrainFocusOptions(sku, lastAttempt);
  const defaultFocus = mgrRetrainDraftReason[draftKey] || opts[0] || MGR_AUDIT_REASONS[0];
  const manualScore = mgrManualScoreDraft[draftKey] ?? null;
  const diffMeta = recordMgrAuditDiff(rec, false, manualScore, defaultFocus);

  rec.retrain = {
    focusPoint: defaultFocus,
    beforeScore: rec.lastScore,
    status: "pending",
    afterScore: null,
    afterMissedFacts: [],
    attemptCount: 0,
    focusFixed: false,
    issuedAt: nowTimeLabel()
  };
  rec.mgrAudit = {
    status: "retrain",
    reason: defaultFocus,
    manualScore,
    aiScoreSnapshot: diffMeta.aiScore,
    aiOverrated: diffMeta.mismatchType === "ai_overrated",
    mismatchType: diffMeta.mismatchType,
    calibratedAt: nowTimeLabel()
  };
  if (rec.passed) {
    rec.passed = false;
    if (!staffProductStates[staffKey]) staffProductStates[staffKey] = {};
    if (task && staffProductStates[staffKey][task.skuId]) {
      staffProductStates[staffKey][task.skuId].passed = false;
    }
  }
  savePilotState();
  showToast(`已发起补训（考点：${defaultFocus}）`);
  renderHome();
}

/** 店长：人工抽查校准或复查确认补训通过 */
function setMgrAudit(taskId, staffKey, status, reason, explicitScore) {
  const task = rolloutTasks.find(t => t.id === taskId);
  const rec = ensureStaffRecord(taskId, staffKey);
  const draftKey = `${taskId}_${staffKey}`;
  const rtStatus = normalizeRetrainStatus(rec.retrain);

  if (status === "approved") {
    if (rtStatus === "pending" || rtStatus === "submitted_unfixed") {
      showToast(rtStatus === "submitted_unfixed"
        ? "该员工复练后目标考点仍未改正，请先让员工练对再复查"
        : "该员工尚未完成补训复练，暂不可直接复查通过");
      return;
    }
    const manualScore = explicitScore ?? mgrManualScoreDraft[draftKey] ?? 92;
    const diffMeta = recordMgrAuditDiff(rec, true, manualScore, "");
    rec.mgrAudit = {
      status: "approved",
      reason: "",
      manualScore,
      aiScoreSnapshot: diffMeta.aiScore,
      aiOverrated: diffMeta.mismatchType === "ai_overrated",
      mismatchType: diffMeta.mismatchType,
      calibratedAt: nowTimeLabel()
    };
    if (rec.retrain && (rtStatus === "fixed_pending_review" || rtStatus === "verified")) {
      rec.retrain.status = "verified";
      rec.retrain.verified = true;
      rec.retrain.verifiedAt = nowTimeLabel();
    }
    showToast(`已确认复查通过（抽查 ${manualScore} 分）`);
  } else {
    const manualScore = explicitScore ?? mgrManualScoreDraft[draftKey] ?? 72;
    const nextReason = reason || mgrRetrainDraftReason[draftKey] || (rec.mgrAudit && rec.mgrAudit.reason) || MGR_AUDIT_REASONS[0];
    const diffMeta = recordMgrAuditDiff(rec, false, manualScore, nextReason);
    rec.mgrAudit = {
      status: "retrain",
      reason: nextReason,
      manualScore,
      aiScoreSnapshot: diffMeta.aiScore,
      aiOverrated: diffMeta.mismatchType === "ai_overrated",
      mismatchType: diffMeta.mismatchType,
      calibratedAt: nowTimeLabel()
    };
    rec.passed = false;
    if (task && staffProductStates[staffKey] && staffProductStates[staffKey][task.skuId]) {
      staffProductStates[staffKey][task.skuId].passed = false;
    }
    rec.retrain = {
      focusPoint: nextReason,
      beforeScore: rec.lastScore,
      status: "pending",
      afterScore: null,
      afterMissedFacts: [],
      attemptCount: 0,
      focusFixed: false,
      issuedAt: nowTimeLabel()
    };
    showToast(`抽查校准未过（${manualScore} 分 · ${nextReason}），已转入待补训`);
  }
  savePilotState();
  renderHome();
}

let hqFormDraft = {
  name: "MINISO × 迪士尼史迪奇毛绒斜挎包",
  price: "¥69.00",
  cross: "9.9元史迪奇挂件",
  facts: "零售价 69 元, 迪士尼正版授权, 仿真兔毛可调节背带",
  desc: "迪士尼正版授权仿真兔毛手感软糯，配可调节肩带与拉链内袋，入口主题堆头挂样展示。"
};

function syncHqFormDraftFromDom() {
  const n = document.getElementById("hq-sku-name");
  if (!n) return;
  hqFormDraft = {
    name: n.value,
    price: document.getElementById("hq-sku-price")?.value ?? hqFormDraft.price,
    cross: document.getElementById("hq-sku-cross")?.value ?? hqFormDraft.cross,
    facts: document.getElementById("hq-sku-facts")?.value ?? hqFormDraft.facts,
    desc: document.getElementById("hq-sku-desc")?.value ?? hqFormDraft.desc
  };
}

/** 总部：切换试点门店、截止时间与审校确认 */
function toggleHqStore(storeName) {
  syncHqFormDraftFromDom();
  if (hqSelectedStores.includes(storeName)) {
    if (hqSelectedStores.length === 1) {
      showToast("至少保留 1 家试点门店");
      return;
    }
    hqSelectedStores = hqSelectedStores.filter(s => s !== storeName);
  } else {
    hqSelectedStores = [...hqSelectedStores, storeName];
  }
  renderHome();
}

function setHqDeadline(hrs) {
  syncHqFormDraftFromDom();
  hqDeadlineHours = hrs;
  renderHome();
}

function toggleHqChecklist() {
  syncHqFormDraftFromDom();
  hqChecklistConfirmed = !hqChecklistConfirmed;
  renderHome();
}

/** 总部：录入、审校并发布上新任务到指定门店 */
function submitHqCourse(publishNow) {
  syncHqFormDraftFromDom();
  const name = hqFormDraft.name.trim();
  const rawPrice = hqFormDraft.price.trim();
  const rawFacts = hqFormDraft.facts.trim();
  const crossItem = hqFormDraft.cross.trim();
  const desc = hqFormDraft.desc.trim();

  if (!name || !rawPrice || !desc) {
    showToast("请填写完整的商品名称、零售价与核心卖点");
    return;
  }
  if (publishNow && !hqChecklistConfirmed) {
    showToast("请先勾选完成零售价、规格与红线人工审校");
    return;
  }

  const factLabels = rawFacts.split(/[，,、；]/).map(s => s.trim()).filter(Boolean);
  const skuId = "hq_" + Date.now();
  const skuObj = buildStructuredSku({
    id: skuId,
    tag: "总部重点上新",
    name,
    rawPrice,
    crossItem,
    desc,
    factLabels
  });

  PRODUCTS.unshift(skuObj);

  const taskId = "task_" + Date.now();
  const newTask = {
    id: taskId,
    skuId,
    stores: hqSelectedStores.slice(),
    deadlineHours: hqDeadlineHours,
    deadlineLabel: `${hqDeadlineHours}小时内`,
    deadlineAt: Date.now() + hqDeadlineHours * 3600 * 1000,
    status: publishNow ? "published" : "draft",
    reviewer: `总部培训 · ${getActiveAccount().userName}`,
    checklistConfirmed: hqChecklistConfirmed,
    publishedAt: nowTimeLabel()
  };
  rolloutTasks.unshift(newTask);

  if (publishNow && newTask.stores.includes(getCurrentStoreName())) {
    selectedMgrTaskId = taskId;
  }
  savePilotState();
  showToast(publishNow
    ? `已审校发布至 ${newTask.stores.length} 家门店（${newTask.deadlineLabel}）`
    : "已保存为待审校草稿");
  renderHome();
}

function publishDraftTask(taskId) {
  const task = rolloutTasks.find(t => t.id === taskId);
  if (!task) return;
  task.status = "published";
  task.checklistConfirmed = true;
  task.publishedAt = nowTimeLabel();
  if (task.stores.includes(getCurrentStoreName())) {
    selectedMgrTaskId = task.id;
  }
  savePilotState();
  showToast("已审校通过并下发到指定门店");
  renderHome();
}

/* ==================== 渲染多角色专属首页 ==================== */
function renderHome() {
  syncCurrentAccountView();
  const acc = getActiveAccount();
  document.getElementById("home-profile-banner").innerHTML = `
    <div class="profile-inline"><strong>${escapeHtml(acc.userName)}</strong>${escapeHtml(acc.storeLine)} · ${escapeHtml(acc.label)}</div>
  `;

  const lb = getStoreLeaderboard();
  const gamifyEl = document.getElementById("home-gamify-strip");
  // P2：员工首屏顶部不再抢占焦点展示积分排名条，将其移至任务与错项复习之后
  gamifyEl.innerHTML = "";

  const body = document.getElementById("home-body");
  if (selectedRole === "staff") {
    const mission = getDailyMission();
    const mSku = mission.sku;
    const mState = mission.state;
    const visibleProducts = getVisibleProducts();
    const storeName = getCurrentStoreName();
    const floorDone = FLOOR_TASKS.filter(t => Boolean(getFloorProof(t.id, storeName)?.done)).length;

    const missionHtml = mission.allDone ? `
      <div class="mission-card ${mission.noTask ? "" : "completed"}">
        <div class="mission-top">
          <span class="status-badge ${mission.noTask ? "status-warn" : "status-ok"}">${escapeHtml(mState.tagText)}</span>
          <span class="mission-reward-pill">${escapeHtml(mState.badgeText)}</span>
        </div>
        <div>
          <div class="mission-title">${mission.noTask ? "当前门店暂无待学上新任务" : "本周新品训练已全部达标"}</div>
          <div class="mission-sub">${escapeHtml(mState.detailText)}</div>
        </div>
        <div class="mission-review-row">
          <button type="button" class="fc-btn-again" style="flex:1" onclick="openRoleplay('${mSku.id}')">复练语音</button>
          <button type="button" class="mission-action-btn" style="flex:1" onclick="openCourse('${mSku.id}')">${mState.ctaLabel}</button>
        </div>
      </div>
    ` : `
      <div class="mission-card">
        <div class="mission-top">
          <span class="tag-pill">${escapeHtml(mState.tagText)}</span>
          <span class="mission-reward-pill">通关 +50 分</span>
        </div>
        <div class="mission-main-row">
          <div class="mission-info">
            <div class="mission-title">${escapeHtml(mSku.name)}</div>
            <div class="mission-sub">${escapeHtml(mState.detailText)}</div>
          </div>
          <button type="button" class="mission-action-btn" onclick="triggerSkuNextStep('${mSku.id}')">${mState.ctaLabel}</button>
        </div>
      </div>
    `;

    body.innerHTML = `
      <!-- 1. 今日必练（五态动态主卡） -->
      ${missionHtml}

      <!-- 2. 闪卡速记（错项优先，自适应高度） -->
      ${renderHomeFlashcardSection()}

      <!-- 3. 门店实操执行清单（需附实拍图片+实物核对依据，店长可核验/退回） -->
      <div class="card">
        <div class="card-head" style="${floorDone === FLOOR_TASKS.length && !floorTasksExpanded ? "margin-bottom:0" : ""}">
          <div>
            <div class="card-title">今日店面实操</div>
            <div class="card-sub">需上传实拍图并确认价签/实物后生效</div>
          </div>
          <div class="audio-ctrl-group">
            <span class="status-badge ${floorDone === FLOOR_TASKS.length ? "status-ok" : "status-warn"}">${floorDone}/${FLOOR_TASKS.length} 已提交</span>
            ${floorDone === FLOOR_TASKS.length ? `<button type="button" class="qa-collapse-link" onclick="toggleFloorTasksExpand()">${floorTasksExpanded ? "收起" : "展开"}</button>` : ""}
          </div>
        </div>
        ${(floorDone < FLOOR_TASKS.length || floorTasksExpanded) ? `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${FLOOR_TASKS.map(t => {
              const proof = getFloorProof(t.id, storeName);
              const isDone = Boolean(proof && proof.done);
              const isRejected = Boolean(proof && proof.verifyStatus === "rejected");
              const isOpen = activeFloorProofId === t.id;
              const draft = getFloorDraft(t.id);
              const statusTxt = isDone
                ? (proof.verifyStatus === "verified" ? "店长已核销" : "待店长核验")
                : (isRejected ? "退回重拍" : "传凭证打卡");
              return `
                <div class="floor-task-wrap">
                  <button type="button" class="task-check-row ${isDone ? "done" : ""}" onclick="toggleFloorTask('${t.id}')">
                    <div class="task-box">
                      ${isDone ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ""}
                    </div>
                    <div class="task-text">
                      <div>${escapeHtml(t.text)}</div>
                      ${isDone ? `<div class="floor-proof-sub">${escapeHtml(proof.byName)} · ${escapeHtml(proof.at)} · ${proof.isDemoPhoto ? "样例图" : "实拍图"} · ${statusTxt}</div>` : (isRejected ? `<div class="floor-proof-sub warn">${escapeHtml(proof.rejectReason)}</div>` : `<div class="floor-proof-sub">点击上传现场图并核对实物</div>`)}
                    </div>
                    <div class="task-pts">${isDone ? `+${t.pts}分` : `+${t.pts}`}</div>
                  </button>

                  ${isOpen ? `
                    <div class="floor-proof-drawer">
                      ${isDone ? `
                        <div class="floor-proof-view">
                          <img class="floor-proof-thumb" src="${proof.photoUrl}" alt="${escapeHtml(t.text)}现场凭证" />
                          <div class="floor-proof-meta">
                            <div><strong>凭证：</strong>${escapeHtml(proof.photoName)}（${proof.isDemoPhoto ? "演示样例" : "现场实拍"}）</div>
                            <div><strong>核对：</strong>${escapeHtml(t.checkLabel)}</div>
                            ${proof.note ? `<div><strong>备注：</strong>${escapeHtml(proof.note)}</div>` : ""}
                            <div><strong>状态：</strong>${proof.verifyStatus === "verified" ? `已核销 (${escapeHtml(proof.verifiedAt || "")})` : "已同步店长，待抽查核销"}</div>
                          </div>
                        </div>
                        ${proof.verifyStatus !== "verified" ? `
                          <button type="button" class="btn-secondary-soft" style="height:34px;font-size:12px" onclick="revokeFloorProof('${t.id}')">撤回并重传凭证</button>
                        ` : ""}
                      ` : `
                        <div class="floor-upload-row">
                          <label class="floor-upload-btn">
                            <input type="file" accept="image/*" capture="environment" onchange="onFloorPhotoSelected('${t.id}', this)" />
                            <span>${draft.photoUrl ? "重新选图" : "拍照 / 传实拍图"}</span>
                          </label>
                          <button type="button" class="btn-pill-soft" onclick="useDemoFloorPhoto('${t.id}')">用现场样例图</button>
                        </div>
                        ${draft.photoUrl ? `
                          <div class="floor-preview-bar">
                            <img class="floor-proof-thumb sm" src="${draft.photoUrl}" alt="待提交凭证预览" />
                            <div class="floor-proof-meta">
                              <div>${escapeHtml(draft.photoName || "现场实拍")}</div>
                              <div style="color:${draft.isDemoPhoto ? "var(--red)" : "var(--green)"};font-weight:700">${draft.isDemoPhoto ? "演示样例图 · 原型体验用" : "真实现场图片 · 已压缩"}</div>
                            </div>
                          </div>
                        ` : ""}
                        <label class="hq-check-row" style="margin-bottom:6px">
                          <input type="checkbox" ${draft.checked ? "checked" : ""} onchange="toggleFloorDraftCheck('${t.id}')" />
                          <span>${escapeHtml(t.checkLabel)}</span>
                        </label>
                        <input type="text" class="input-field" style="margin-bottom:8px;padding:7px 10px;font-size:12px" placeholder="选填：陈列位置或异常备注..." value="${escapeHtml(draft.note)}" oninput="updateFloorDraftNote('${t.id}', this.value)" />
                        <button type="button" class="btn-cta" style="height:38px;font-size:13px" onclick="submitFloorProof('${t.id}')">提交实拍凭证并打卡 (+${t.pts}分)</button>
                      `}
                    </div>
                  ` : ""}
                </div>
              `;
            }).join("")}
          </div>
        ` : ""}
      </div>

      <!-- 4. 本周新品目录（按门店发布门禁严格过滤） -->
      <div class="card">
        <div class="card-head">
          <div class="card-title">本店可见商品课程</div>
          <span class="card-sub">共 ${visibleProducts.length} 款</span>
        </div>
        <div class="course-list">
          ${visibleProducts.map(p => {
            const st = getSkuProgressState(p);
            return `
              <div class="course-card" onclick="triggerSkuNextStep('${p.id}')">
                <div class="sku-thumb">${SKU_ICONS[p.icon] || SKU_ICONS.box}</div>
                <div class="course-info">
                  <div class="course-name">${escapeHtml(p.name)}</div>
                  <div class="course-meta">
                    <span>${escapeHtml(p.price)}</span>
                    <span class="status-badge ${st.badgeClass}">${escapeHtml(st.badgeText)}</span>
                  </div>
                </div>
                <button type="button" class="btn-pill-red">${st.ctaLabel}</button>
              </div>
            `;
          }).join("")}
        </div>
      </div>

      <!-- 5. 积分与门店榜单（位于上新任务与错项复习之后） -->
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">积分与门店榜单</div>
            <div class="card-sub">连学 ${userStreak} 天 · 个人 ${getCurrentUserPoints()} 分 · 当前第 ${lb.myRankNum} 名</div>
          </div>
          <span class="card-sub">${lb.myRankNum === 1 ? "当前第 1 名" : `距第 1 差 ${lb.gapToTop} 分`}</span>
        </div>
        ${lb.rows.map((r, i) => `
          <div class="rank-row">
            <span class="rank-idx ${r.isMe ? "me" : (i === 0 ? "top" : "")}">${i + 1}</span>
            <div class="rank-info"><span class="list-row-main">${escapeHtml(r.name)}</span><span class="rank-role">${escapeHtml(r.role)}</span></div>
            <span class="status-badge ${i === 0 ? "status-ok" : "status-warn"}">${r.score} 分</span>
          </div>
        `).join("")}
      </div>
    `;
  } else if (selectedRole === "store_mgr") {
    const quiz = BRIEFING_QUIZZES[briefingIndex];
    const storeTasks = getTasksForStore(getCurrentStoreName());
    const mgrTask = storeTasks.find(t => t.id === selectedMgrTaskId) || storeTasks[0];
    const mgrSku = mgrTask ? PRODUCTS.find(p => p.id === mgrTask.skuId) : getVisibleProducts()[0];

    const staffRows = mgrTask ? PILOT_STAFF_ROSTER.map(st => {
      const rec = ensureStaffRecord(mgrTask.id, st.key);
      const lastAttempt = rec.attempts[0] || null;
      const doneCh = rec.completedChapters.filter(Boolean).length;
      const totCh = mgrSku ? mgrSku.chapters.length : 3;
      const focusOpts = getRetrainFocusOptions(mgrSku, lastAttempt);
      const draftKey = `${mgrTask.id}_${st.key}`;
      const chosenFocus = mgrRetrainDraftReason[draftKey] || focusOpts[0];
      const passedOrig = rec.attempts.some(a => a.passed && a.questionVariant !== "换问法");
      const passedAlt = rec.attempts.some(a => a.passed && a.questionVariant === "换问法");
      const variantStatusText = passedOrig && passedAlt
        ? "原问+换问已过"
        : passedAlt
          ? "仅换问法已过"
          : passedOrig
            ? "仅原问法已过"
            : "未过问法检验";

      let blockerText = "未开始学习与对练";
      if (lastAttempt) {
        const parts = [];
        if (lastAttempt.redlineHits && lastAttempt.redlineHits.length) {
          parts.push(`红线:${lastAttempt.redlineHits.join("、")}`);
        }
        if (lastAttempt.missedFacts && lastAttempt.missedFacts.length) {
          parts.push(`缺:${lastAttempt.missedFacts.join("、")}`);
        }
        if (!parts.length && !lastAttempt.passed) {
          parts.push(`弱项:${lastAttempt.weakestName}`);
        }
        blockerText = parts.length ? parts.join(" · ") : "必考事实与红线全过";
      } else if (doneCh > 0) {
        blockerText = `细节${doneCh}/${totCh} · 待对练`;
      }

      return { st, rec, lastAttempt, doneCh, totCh, focusOpts, chosenFocus, blockerText, variantStatusText };
    }) : [];

    const buildMgrRowMeta = row => {
      const { st, rec } = row;
      const rt = rec.retrain;
      const rtStatus = normalizeRetrainStatus(rt);
      const draftKey = `${mgrTask.id}_${st.key}`;
      const chosenManualScore = mgrManualScoreDraft[draftKey] ?? (rec.mgrAudit && typeof rec.mgrAudit.manualScore === "number" ? rec.mgrAudit.manualScore : 92);
      const diffEventsCnt = Array.isArray(rec.auditHistory)
        ? rec.auditHistory.filter(h => h.mismatchType === "ai_overrated" || h.mismatchType === "ai_underrated").length
        : 0;
      const calibText = rec.mgrAudit && typeof rec.mgrAudit.manualScore === "number"
        ? `人工${rec.mgrAudit.manualScore} vs AI${rec.mgrAudit.aiScoreSnapshot ?? "-"}(${rec.mgrAudit.mismatchType === "ai_overrated" || rec.mgrAudit.aiOverrated ? "AI偏高" : (rec.mgrAudit.mismatchType === "ai_underrated" ? "AI偏严" : "一致")})`
        : "";
      let badge = `<span class="status-badge status-warn">${staffReminded ? "已催学" : "未完成"}</span>`;
      if (rtStatus === "verified" || (!rt && rec.mgrAudit && rec.mgrAudit.status === "approved")) {
        badge = `<span class="status-badge status-ok">店长复查通过</span>`;
      } else if (rtStatus === "fixed_pending_review") {
        badge = `<span class="status-badge status-ok">已改正 · 待复查</span>`;
      } else if (rtStatus === "submitted_unfixed") {
        badge = `<span class="status-badge status-warn">未改正 · ${escapeHtml(rt.focusPoint)}</span>`;
      } else if (rtStatus === "pending") {
        badge = `<span class="status-badge status-warn">待补训 · ${escapeHtml(rt.focusPoint)}</span>`;
      } else if (rec.passed) {
        badge = `<span class="status-badge status-ok">AI通关 ${rec.bestScore || rec.lastScore || 90}分</span>`;
      } else if (rec.lastScore !== null) {
        badge = `<span class="status-badge status-warn">未通关 ${rec.lastScore}分</span>`;
      }
      return { ...row, rt, rtStatus, draftKey, chosenManualScore, diffEventsCnt, calibText, badge };
    };

    const enrichedRows = staffRows.map(buildMgrRowMeta);
    const activeStaffKey = mgrSubPage.startsWith("staff:") ? mgrSubPage.slice(6) : "";
    const activeDetailRow = activeStaffKey ? enrichedRows.find(r => r.st.key === activeStaffKey) : null;
    if (activeStaffKey && !activeDetailRow) mgrSubPage = "";

    const passedCount = staffRows.filter(r => r.rec.passed).length;
    const retrainPendingCount = staffRows.filter(r => isRetrainStillRequiredForStaff(r.rec)).length;
    const auditedCount = staffRows.filter(r => r.rec.mgrAudit && r.rec.mgrAudit.status).length;
    const auditedPassCount = staffRows.filter(r => r.rec.mgrAudit && r.rec.mgrAudit.status === "approved").length;
    const calibratedMismatchCount = staffRows.filter(r => r.rec.mgrAudit && r.rec.mgrAudit.aiOverrated).length;
    const storeDiffTotal = storeTasks.reduce((sum, t) => sum + PILOT_STAFF_ROSTER.reduce((s2, s) => {
      const h = ensureStaffRecord(t.id, s.key).auditHistory || [];
      return s2 + h.filter(x => x.mismatchType === "ai_overrated" || x.mismatchType === "ai_underrated").length;
    }, 0), 0);

    const renderMgrSubpageBar = (title, rightHtml) => `
      <div class="mgr-subpage-bar">
        <button type="button" class="icon-btn mgr-back-icon" onclick="closeMgrSubPage()" aria-label="返回工作台">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="mgr-subpage-title">${escapeHtml(title)}</div>
        ${rightHtml || ""}
      </div>
    `;

    if (activeDetailRow) {
      const { st, rec, doneCh, totCh, focusOpts, chosenFocus, blockerText, variantStatusText, rt, rtStatus, chosenManualScore, diffEventsCnt, calibText, badge } = activeDetailRow;
      const attemptsList = Array.isArray(rec.attempts) ? rec.attempts.slice(0, 4) : [];
      const historyList = Array.isArray(rec.auditHistory) ? rec.auditHistory.slice(0, 4) : [];

      body.innerHTML = `
        ${renderMgrSubpageBar(`${st.name} · ${mgrSku ? getProductShortName(mgrSku) : ""}`, badge)}

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">${escapeHtml(st.name)}（${escapeHtml(st.role)}）</div>
              <div class="card-sub">细节 ${doneCh}/${totCh} 节 · ${rec.lastScore !== null ? `最近 ${rec.lastScore} 分（最高 ${rec.bestScore} 分）` : "尚未完成 AI 对练"}</div>
            </div>
          </div>
          <div class="audit-meta-line" style="margin-bottom:6px">
            <span class="audit-blocker-inline">卡点：${escapeHtml(blockerText)}</span>
          </div>
          <div class="audit-mini-tags">
            <span class="audit-mini-tag warn">${escapeHtml(variantStatusText)}</span>
            ${calibText ? `<span class="audit-mini-tag">${escapeHtml(calibText)}</span>` : ""}
            ${diffEventsCnt > 0 ? `<span class="audit-mini-tag warn">累计分歧 ${diffEventsCnt} 次</span>` : ""}
          </div>
          ${rt && (rtStatus === "submitted_unfixed" || rtStatus === "fixed_pending_review" || rtStatus === "verified") ? `
            <div class="retrain-diff-pill ${rtStatus === "submitted_unfixed" ? "warn" : ""}" style="margin-top:8px">
              ${rtStatus === "submitted_unfixed"
                ? `复练未改(${rt.beforeScore ?? "未考"}→${rt.afterScore}分)：仍缺「${escapeHtml(rt.focusPoint)}」`
                : `复练对比：${rt.beforeScore ?? "未考"}→${rt.afterScore}分（${escapeHtml(rt.focusPoint)} 已改正）`}
            </div>
          ` : ""}
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">人工抽查校准与补训指令</div>
              <div class="card-sub">选定目标考点或现场抽查分后执行处置</div>
            </div>
          </div>
          <div class="field-label">1. 目标补训考点</div>
          <div class="audit-actions-row" style="margin-bottom:8px">
            ${focusOpts.map((opt, oIdx) => `
              <button type="button" class="chip-select-btn sm ${chosenFocus === opt ? "active" : ""}" onclick="selectMgrRetrainFocus('${mgrTask.id}','${st.key}',${oIdx})">${escapeHtml(opt)}</button>
            `).join("")}
          </div>
          <div class="field-label">2. 现场抽查打分</div>
          <div class="audit-actions-row" style="margin-bottom:10px">
            ${[
              { s: 92, lbl: "92分 · 过关" },
              { s: 72, lbl: "72分 · AI偏高" },
              { s: 58, lbl: "58分 · 重练" }
            ].map(opt => `
              <button type="button" class="chip-select-btn sm ${chosenManualScore === opt.s ? "active" : ""}" onclick="selectMgrManualScore('${mgrTask.id}','${st.key}',${opt.s})">${opt.lbl}</button>
            `).join("")}
          </div>
          <div class="audit-actions-row">
            <button type="button" class="audit-btn fail ${rtStatus === "pending" || rtStatus === "submitted_unfixed" ? "active" : ""}" onclick="issueMgrRetrain('${mgrTask.id}','${st.key}')">
              ${rtStatus === "pending" || rtStatus === "submitted_unfixed" ? "更新补训考点" : (rt ? "再次补训" : "发起补训")}
            </button>
            <button type="button" class="audit-btn fail" onclick="setMgrAudit('${mgrTask.id}','${st.key}','retrain', '${escapeHtml(chosenFocus)}', ${chosenManualScore < 85 ? chosenManualScore : 72})">
              抽查不通过(纠偏)
            </button>
            <button type="button" class="audit-btn pass ${rtStatus === "verified" || (!rt && rec.mgrAudit && rec.mgrAudit.status === "approved") ? "active" : ""}" onclick="setMgrAudit('${mgrTask.id}','${st.key}','approved', '', ${chosenManualScore >= 85 ? chosenManualScore : 92})">
              ${rtStatus === "fixed_pending_review" ? "复查通过" : "抽查通过"}
            </button>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">对练与判定分歧记录</div>
            <span class="card-sub">近 ${attemptsList.length} 次练 / ${historyList.length} 次抽查</span>
          </div>
          ${historyList.length ? historyList.map(h => `
            <div class="history-row">
              <div class="list-row-main" style="font-size:12px">人工 ${h.mgrScore ?? "-"}分(${h.mgrPassed ? "过" : "未过"}) vs AI ${h.aiScore ?? "-"}分(${h.aiPassed ? "过" : "未过"})</div>
              <span class="audit-mini-tag ${h.mismatchType === "ai_overrated" || h.mismatchType === "ai_underrated" ? "warn" : ""}">
                ${h.mismatchType === "ai_overrated" ? "分歧:AI偏高" : (h.mismatchType === "ai_underrated" ? "分歧:AI偏严" : (h.mismatchType === "aligned" ? "一致" : "纯抽查"))}
              </span>
            </div>
          `).join("") : `<div class="list-row-sub">暂无人工抽查记录</div>`}
          ${attemptsList.length ? attemptsList.map(a => `
            <div class="history-row">
              <div class="list-row-sub">${escapeHtml(a.at || "")} · ${escapeHtml(a.questionVariant || "原问法")} · ${a.score}分${a.missedFacts && a.missedFacts.length ? ` · 漏：${escapeHtml(a.missedFacts.join("、"))}` : " · 必考全中"}</div>
              <span class="status-badge ${a.passed ? "status-ok" : "status-warn"}">${a.passed ? "AI通过" : "未过"}</span>
            </div>
          `).join("") : `<div class="list-row-sub" style="margin-top:6px">暂无语音/文字对练记录</div>`}
        </div>
      `;
    } else if (mgrSubPage === "briefing") {
      body.innerHTML = `
        ${renderMgrSubpageBar("早会抽查与本店微课", `<span class="mgr-subpage-meta">${escapeHtml(mgrSku ? getProductShortName(mgrSku) : "")}</span>`)}

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">早会换问法抽查（同一考点现场检验）</div>
              <div class="card-sub">${mgrSku ? escapeHtml(mgrSku.name) : ""} · 不同问法随机抽查</div>
            </div>
            <button type="button" class="btn-pill-soft" onclick="nextBriefing()">换一题</button>
          </div>
          ${mgrSku && mgrSku.persona && mgrSku.persona.altQuestion ? `
            <div class="briefing-box" style="margin-bottom:8px;border:1px solid var(--red-border)">
              <div class="briefing-q"><strong>本品换问法抽查：</strong>${escapeHtml(mgrSku.persona.altQuestion)}</div>
              <div class="briefing-a" style="margin-top:6px"><strong>参考要点：</strong>${escapeHtml(mgrSku.rubric.demoPitch)}</div>
            </div>
          ` : ""}
          <div class="briefing-box">
            <div class="briefing-q">${quiz.q}</div>
            <button type="button" class="speech-toggle-btn" onclick="toggleBriefingAnswer()" aria-expanded="${showBriefingAnswer}">
              <span>${showBriefingAnswer ? "收起标准参考" : "查看标准参考话术"}</span>
              <svg class="chapter-chevron ${showBriefingAnswer ? "open" : ""}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            ${showBriefingAnswer ? `<div class="briefing-a"><strong>标准参考：</strong>${quiz.a}</div>` : ""}
          </div>
        </div>

        ${mgrCreateExpanded ? `
          <div class="card">
            <div class="card-head">
              <div class="card-title">本店补充微课（快速上架）</div>
              <button type="button" class="qa-collapse-link" onclick="toggleMgrCreatePanel()">收起</button>
            </div>
            <input id="mgr-sku-name" class="input-field" placeholder="商品全称（必填）" value="名创优品经典便携防晒折叠伞" />
            <div class="form-row-2">
              <input id="mgr-sku-price" class="input-field" placeholder="零售价（如 29.9）" value="¥29.90" />
              <input id="mgr-sku-cross" class="input-field" placeholder="推荐连带品（如 伞套）" value="9.9元伞套挂扣" />
            </div>
            <textarea id="mgr-sku-desc" class="textarea-field" rows="3" placeholder="输入经审校的真实卖点、材质规格与话术规则...">黑胶 UPF50+ 防晒涂层，晴雨两用 8 骨抗风伞架，收起仅 22cm 可放随身小包。</textarea>
            <button type="button" class="btn-cta" style="height:44px;font-size:15px" onclick="createCourseByMgr()">生成微课并下发本店</button>
          </div>
        ` : `
          <button type="button" class="qa-collapsed-btn" onclick="toggleMgrCreatePanel()">
            <div class="qa-collapsed-left">
              <span class="qa-collapsed-title">本店补充微课</span>
              <span class="qa-collapsed-sub">按真实资料快速上架本店任务</span>
            </div>
            <span class="qa-collapsed-action">去制课</span>
          </button>
        `}

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">今日店面实操凭证核验</div>
              <div class="card-sub">核查员工上传的样品与试闻陈列实拍图</div>
            </div>
          </div>
          ${FLOOR_TASKS.map(t => {
            const stName = getCurrentStoreName();
            const proof = getFloorProof(t.id, stName);
            return `
              <div class="audit-card-row">
                <div class="audit-top-row">
                  <div class="list-row-main" style="font-size:13px">${escapeHtml(t.text)}</div>
                  <span class="status-badge ${proof && proof.done ? (proof.verifyStatus === "verified" ? "status-ok" : "status-warn") : "status-warn"}">
                    ${proof && proof.done ? (proof.verifyStatus === "verified" ? "已核销" : "待核验") : "未提交"}
                  </span>
                </div>
                ${proof && proof.photoUrl ? `
                  <div class="floor-proof-view">
                    <img class="floor-proof-thumb sm" src="${proof.photoUrl}" alt="${escapeHtml(t.text)}" />
                    <div class="floor-proof-meta">
                      <div>${escapeHtml(proof.byName || "")} · ${escapeHtml(proof.at || "")} · ${proof.isDemoPhoto ? "样例图" : "实拍图"}</div>
                      ${proof.note ? `<div>备注：${escapeHtml(proof.note)}</div>` : ""}
                    </div>
                  </div>
                  ${proof.done ? `
                    <div class="audit-actions-row compact">
                      <button type="button" class="audit-btn pass ${proof.verifyStatus === "verified" ? "active" : ""}" onclick="verifyFloorProof('${escapeHtml(stName)}','${t.id}',true)">核验通过</button>
                      <button type="button" class="audit-btn fail" onclick="verifyFloorProof('${escapeHtml(stName)}','${t.id}',false)">退回重拍</button>
                    </div>
                  ` : `<div class="list-row-sub" style="color:var(--red)">${escapeHtml(proof.rejectReason || "已退回待员工重拍")}</div>`}
                ` : `<div class="list-row-sub">暂未收到员工实拍打卡凭证</div>`}
              </div>
            `;
          }).join("")}
        </div>
      `;
    } else if (mgrSubPage === "metrics") {
      body.innerHTML = `
        ${renderMgrSubpageBar("首轮试点同口径验证", `<span class="mgr-subpage-meta">分歧 ${storeDiffTotal} 次</span>`)}

        ${renderPilotValueCard(storeTasks, false)}
      `;
    } else {
      body.innerHTML = `
        ${storeTasks.length ? `
          <div class="fc-filter-row" style="margin-bottom:0">
            ${storeTasks.map(t => {
              const sku = PRODUCTS.find(p => p.id === t.skuId);
              const lbl = sku ? getProductShortName(sku) : t.skuId;
              return `<button type="button" class="fc-filter-pill ${mgrTask && mgrTask.id === t.id ? "active" : ""}" onclick="selectMgrTask('${t.id}')">${escapeHtml(lbl)} · ${formatDeadlineLabel(t)}</button>`;
            }).join("")}
          </div>
        ` : ""}

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">${mgrSku ? escapeHtml(mgrSku.name) : "当前门店上新任务"}</div>
              <div class="card-sub">${mgrTask ? `截止：${formatDeadlineLabel(mgrTask)} · 审校：${escapeHtml(mgrTask.reviewer)}` : "暂无总部发布任务"}</div>
            </div>
            <span class="status-badge ${passedCount === staffRows.length && staffRows.length ? "status-ok" : "status-warn"}">抽查 ${auditedCount}/${staffRows.length}</span>
          </div>
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-num">${passedCount}/${staffRows.length}</div>
              <div class="kpi-label">AI 对练通关</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-num">${retrainPendingCount} 人</div>
              <div class="kpi-label">待补训/未改</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-num">${auditedPassCount}/${staffRows.length}</div>
              <div class="kpi-label">抽查通过${calibratedMismatchCount ? `(纠偏${calibratedMismatchCount})` : ""}</div>
            </div>
          </div>
        </div>

        <div class="mgr-entry-grid">
          <button type="button" class="mgr-entry-tile" onclick="openMgrSubPage('briefing')">
            <div class="mgr-entry-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="mgr-entry-body">
              <div class="mgr-entry-title">早会 · 制课</div>
              <div class="mgr-entry-sub">换问法抽查 / 补微课</div>
            </div>
            <span class="mgr-entry-chevron">›</span>
          </button>

          <button type="button" class="mgr-entry-tile" onclick="openMgrSubPage('metrics')">
            <div class="mgr-entry-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </div>
            <div class="mgr-entry-body">
              <div class="mgr-entry-title">试点 · 指标</div>
              <div class="mgr-entry-sub">${storeDiffTotal ? `分歧 ${storeDiffTotal} 次 · 工时对照` : "48h 覆盖与省时"}</div>
            </div>
            <span class="mgr-entry-chevron">›</span>
          </button>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-title">店员学练与抽查名单</div>
              <div class="card-sub">点击店员进入二级抽查补训页</div>
            </div>
            <button type="button" class="btn-pill-soft" onclick="remindStaff()">${staffReminded ? "已提醒" : "一键催学"}</button>
          </div>
          ${enrichedRows.map(({ st, rec, doneCh, totCh, blockerText, diffEventsCnt, badge }) => `
            <button type="button" class="mgr-staff-item" onclick="openMgrStaffDetail('${st.key}')">
              <div class="audit-top-row">
                <div class="audit-name-inline">
                  <span class="list-row-main">${escapeHtml(st.name)}</span>
                  <span class="audit-role-sub">${escapeHtml(st.role)}</span>
                </div>
                ${badge}
              </div>
              <div class="mgr-staff-item-sub">
                <span class="mgr-staff-item-text">细节${doneCh}/${totCh} · ${rec.lastScore !== null ? `最近${rec.lastScore}分` : "未对练"} · ${escapeHtml(blockerText)}${diffEventsCnt > 0 ? ` · 分歧${diffEventsCnt}次` : ""}</span>
                <span class="mgr-staff-arrow">抽查 ›</span>
              </div>
            </button>
          `).join("")}
        </div>
      `;
    }
  } else if (selectedRole === "hq_ops") {
    body.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">总部简版：新品录入与审校发布</div>
            <div class="card-sub">审校价格/规格/红线后直达指定门店员工首屏</div>
          </div>
        </div>
        <div class="field-label">1. 商品基础资料与核对事实</div>
        <input id="hq-sku-name" class="input-field" placeholder="新品名称（必填）" value="${escapeHtml(hqFormDraft.name)}" oninput="hqFormDraft.name=this.value" />
        <div class="form-row-2">
          <input id="hq-sku-price" class="input-field" placeholder="零售价" value="${escapeHtml(hqFormDraft.price)}" oninput="hqFormDraft.price=this.value" />
          <input id="hq-sku-cross" class="input-field" placeholder="连带商品" value="${escapeHtml(hqFormDraft.cross)}" oninput="hqFormDraft.cross=this.value" />
        </div>
        <input id="hq-sku-facts" class="input-field" placeholder="必考核对事实点（逗号分隔）" value="${escapeHtml(hqFormDraft.facts)}" oninput="hqFormDraft.facts=this.value" />
        <textarea id="hq-sku-desc" class="textarea-field" rows="3" placeholder="输入标准卖点、陈列要求与话术规范..." oninput="hqFormDraft.desc=this.value">${escapeHtml(hqFormDraft.desc)}</textarea>

        <div class="field-label">2. 指定试点门店（当前登录员工/店长位于北京路旗舰店）</div>
        <div class="chip-group">
          ${PILOT_STORES.map(st => `
            <button type="button" class="chip-select-btn ${hqSelectedStores.includes(st) ? "active" : ""}" onclick="toggleHqStore('${st}')">${st}</button>
          `).join("")}
        </div>

        <div class="field-label">3. 规定通关截止时间</div>
        <div class="chip-group">
          ${[24, 48, 72].map(h => `
            <button type="button" class="chip-select-btn ${hqDeadlineHours === h ? "active" : ""}" onclick="setHqDeadline(${h})">${h}小时内</button>
          `).join("")}
        </div>

        <label class="hq-check-row">
          <input type="checkbox" ${hqChecklistConfirmed ? "checked" : ""} onchange="toggleHqChecklist()" />
          <span>人工审校确认：已核对零售价、规格购买规则与禁用红线</span>
        </label>

        <div class="btn-dual-row">
          <button type="button" class="btn-secondary-soft" onclick="submitHqCourse(false)">存为待审校草稿</button>
          <button type="button" class="btn-cta" style="flex:1.4;height:44px;font-size:14px" onclick="submitHqCourse(true)">审校通过并发布</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">试点上新任务跟踪</div>
            <div class="card-sub">多端实时同步：店长端与总部端看到同一批任务进度</div>
          </div>
          <div class="audio-ctrl-group">
            <button type="button" class="qa-collapse-link" onclick="fetchPilotStateFromServer(true); showToast('已同步最新进度')">刷新进度</button>
            <button type="button" class="qa-collapse-link" onclick="resetPilotState()">重置数据</button>
          </div>
        </div>
        ${rolloutTasks.map(t => {
          const sku = PRODUCTS.find(p => p.id === t.skuId);
          const linRec = ensureStaffRecord(t.id, "linxiaomei");
          const linRtStatus = normalizeRetrainStatus(linRec.retrain);
          const passCnt = PILOT_STAFF_ROSTER.filter(s => ensureStaffRecord(t.id, s.key).passed).length;
          let linSummary = `细节 ${linRec.completedChapters.filter(Boolean).length}/${sku ? sku.chapters.length : 3} 节`;
          if (linRtStatus === "submitted_unfixed") {
            linSummary = `复练未改(${escapeHtml(linRec.retrain.focusPoint)})`;
          } else if (linRtStatus === "pending") {
            linSummary = `待补训(${escapeHtml(linRec.retrain.focusPoint)})`;
          } else if (linRtStatus === "fixed_pending_review") {
            linSummary = `考点已改·待复查(${linRec.retrain.afterScore ?? linRec.lastScore}分)`;
          } else if (linRec.passed) {
            linSummary = `已通关(${linRec.bestScore}分)`;
          } else if (linRec.lastScore !== null) {
            linSummary = `未通关(${linRec.lastScore}分)`;
          }
          return `
            <div class="audit-card-row">
              <div class="audit-top-row">
                <div>
                  <div class="list-row-main">${sku ? escapeHtml(sku.name) : escapeHtml(t.skuId)}</div>
                  <div class="list-row-sub">目标门店：${escapeHtml(t.stores.join("、"))} · 截止：${formatDeadlineLabel(t)}</div>
                  <div class="list-row-sub">目标店通关 ${passCnt}/${PILOT_STAFF_ROSTER.length} · 林小美：${linSummary}</div>
                </div>
                <span class="status-badge ${t.status === "published" ? "status-ok" : "status-warn"}">${t.status === "published" ? "已发布" : "待审校"}</span>
              </div>
              ${t.status !== "published" ? `
                <div class="audit-actions-row">
                  <button type="button" class="btn-pill-red" onclick="publishDraftTask('${t.id}')">审校通过并发布</button>
                </div>
              ` : ""}
            </div>
          `;
        }).join("")}
      </div>

      ${renderPilotValueCard(rolloutTasks, true)}
    `;
  } else {
    body.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div class="card-title">华南一区培训总览</div>
          <span class="status-badge status-ok">大区通关 91%</span>
        </div>
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-num">15 家</div>
            <div class="kpi-label">全员达标门店</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-num">3 家</div>
            <div class="kpi-label">滞后预警门店</div>
          </div>
          <div class="kpi-item">
            <div class="kpi-num">¥38.6</div>
            <div class="kpi-label">训后客单价</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">重点品类大区掌握度</div>
          <span class="card-sub">统计截至今日 09:00</span>
        </div>
        <div class="progress-row">
          <div class="progress-head"><span>Chiikawa IP 盲盒系列</span><span>94%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:94%"></div></div>
        </div>
        <div class="progress-row">
          <div class="progress-head"><span>大师创香无火香薰系列</span><span>82%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:82%"></div></div>
        </div>
        <div class="progress-row">
          <div class="progress-head"><span>三丽鸥出行配件系列</span><span>96%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:96%"></div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">辖区门店红黑榜</div>
          <button type="button" class="btn-pill-soft" onclick="showToast('已向 18 位店长下发周末早会必考指令')">下发大区必考</button>
        </div>
        <div class="list-row">
          <div>
            <div class="list-row-main">广州北京路旗舰店</div>
            <div class="list-row-sub">通关率 96% · 盲盒连带率 31%</div>
          </div>
          <span class="status-badge status-ok">标杆门店</span>
        </div>
        <div class="list-row">
          <div>
            <div class="list-row-main">深圳壹方城黑金店</div>
            <div class="list-row-sub">通关率 94% · 香薰连带率 28%</div>
          </div>
          <span class="status-badge status-ok">优秀门店</span>
        </div>
        <div class="list-row">
          <div>
            <div class="list-row-main">佛山祖庙百货店</div>
            <div class="list-row-sub">通关率 62% · 晚班语音对练未完成</div>
          </div>
          <button type="button" class="btn-pill-soft" onclick="superviseStore('佛山祖庙百货店')">${supervisedStores["佛山祖庙百货店"] ? "已发督导" : "催办督导"}</button>
        </div>
      </div>
    `;
  }
}

function remindStaff() {
  staffReminded = true;
  renderHome();
  showToast("已通过企业微信向未通关店员发送提醒");
}

function createCourseByMgr() {
  const name = document.getElementById("mgr-sku-name").value.trim();
  const rawPrice = (document.getElementById("mgr-sku-price")?.value || "").trim();
  const crossItem = (document.getElementById("mgr-sku-cross")?.value || "").trim();
  const desc = document.getElementById("mgr-sku-desc").value.trim();
  if (!name || !desc || !rawPrice) {
    showToast("请填写商品名称、零售价与经审校的卖点资料");
    return;
  }
  const id = "sku_" + Date.now();
  const skuObj = buildStructuredSku({
    id,
    tag: "店长新下发",
    name,
    rawPrice,
    crossItem,
    desc
  });
  PRODUCTS.unshift(skuObj);

  const taskId = "task_mgr_" + Date.now();
  rolloutTasks.unshift({
    id: taskId,
    skuId: id,
    stores: [getCurrentStoreName()],
    deadlineHours: 24,
    deadlineLabel: "24小时内",
    deadlineAt: Date.now() + 24 * 3600 * 1000,
    status: "published",
    reviewer: getActiveAccount().userName,
    checklistConfirmed: true,
    publishedAt: nowTimeLabel()
  });
  selectedMgrTaskId = taskId;

  homeFcFilter = "all";
  homeFcIndex = 0;
  homeFcFlipped = false;
  mgrCreateExpanded = false;
  savePilotState();
  showToast("已按真实录入资料生成微课并下发本店");
  openCourse(id);
}

/* ==================== 屏幕 3：产品细节讲解页（按商品保留进度） ==================== */
function openCourse(id) {
  stopAllAudio();
  const target = PRODUCTS.find(p => p.id === id);
  if (!target || !canCurrentUserAccessSku(target)) {
    showToast("当前门店暂无该商品任务或尚未发布");
    return;
  }
  currentSku = target;
  const st = getSkuProgressState(currentSku);
  activeChapterIdx = st.nextChapterIdx;
  expandedSpeechIdx = -1;
  detailQaExpanded = false;
  detailQaMessages = [];

  showOnlyScreen("detail");
  document.getElementById("detail-nav-tag").textContent = currentSku.tag;
  renderDetailPage();
}

function selectChapter(idx) {
  stopAllAudio();
  activeChapterIdx = (activeChapterIdx === idx) ? -1 : idx;
  expandedSpeechIdx = -1;
  renderDetailPage();
}

function toggleChapterSpeech(idx) {
  expandedSpeechIdx = (expandedSpeechIdx === idx) ? -1 : idx;
  renderDetailPage();
}

function toggleDetailQa() {
  detailQaExpanded = !detailQaExpanded;
  renderDetailPage();
}

function advanceChapter(idx) {
  stopAllAudio();
  currentSku.completedChapters[idx] = true;
  syncLinRecordFromSku(currentSku);
  savePilotState();
  expandedSpeechIdx = -1;
  const nextPending = currentSku.completedChapters.findIndex(done => !done);
  if (nextPending === -1) {
    showToast("已完成全部产品细节讲解，进入实战语音对练");
    openRoleplay(currentSku.id);
    return;
  }
  if (idx + 1 < currentSku.chapters.length && !currentSku.completedChapters[idx + 1]) {
    activeChapterIdx = idx + 1;
  } else {
    activeChapterIdx = nextPending;
    showToast(`已完成第 0${idx + 1} 节，请继续补学第 0${nextPending + 1} 节`);
  }
  renderDetailPage();
}

function speakChapterSpeech(idx) {
  const ch = currentSku.chapters[idx];
  if (!ch) return;
  speakText(ch.speech);
  showToast("正在为您语音播报本节讲解");
}

function askDetailQuestion(text) {
  const input = document.getElementById("detail-qa-input");
  const q = (text || (input ? input.value : "")).trim();
  if (!q) return;
  if (input) input.value = "";

  let reply = `针对【${currentSku.name}】：${currentSku.chapters[0].speech}`;
  if (q.includes("贵")) reply = `化解价格顾虑：先递样品让顾客摸到实物，再强调【${currentSku.points[0]}】。`;
  if (q.includes("陈列") || q.includes("位置") || q.includes("摆")) reply = `门店陈列规范：${currentSku.chapters[1].actions.join(" ")}`;
  if (q.includes("连带")) reply = `收银连带技巧：${currentSku.chapters[2].mantra}。`;

  detailQaExpanded = true;
  detailQaMessages.push({ role: "user", text: q });
  detailQaMessages.push({ role: "ai", text: reply });
  renderDetailPage();
}

function handleDetailQaSubmit(e) {
  e.preventDefault();
  askDetailQuestion();
}

function renderDetailPage() {
  const container = document.getElementById("detail-scroll");
  const chapters = currentSku.chapters;
  const doneCount = currentSku.completedChapters.filter(Boolean).length;

  container.innerHTML = `
    <div class="product-hero-card">
      <div class="hero-top-row">
        <div class="sku-thumb">${SKU_ICONS[currentSku.icon] || SKU_ICONS.box}</div>
        <div class="hero-info">
          <div class="hero-title">${escapeHtml(currentSku.name)}</div>
          <div class="hero-sub">${escapeHtml(currentSku.summary)}</div>
        </div>
        <div class="hero-price-col">
          <div class="hero-price">${escapeHtml(currentSku.price)}</div>
          <div class="hero-progress-label ${doneCount === chapters.length ? "done" : ""}">${doneCount}/${chapters.length} 节</div>
        </div>
      </div>

      <div class="step-segments" aria-label="细节学习进度">
        ${chapters.map((ch, idx) => `
          <button type="button" class="step-seg ${activeChapterIdx === idx ? "active" : (currentSku.completedChapters[idx] ? "done" : "")}" onclick="selectChapter(${idx})" aria-label="${ch.short}"></button>
        `).join("")}
      </div>
    </div>

    <div class="disclosure-stack">
      ${chapters.map((ch, idx) => {
        const isExpanded = activeChapterIdx === idx;
        const isDone = currentSku.completedChapters[idx];
        const speechOpen = expandedSpeechIdx === idx;
        return `
          <div class="chapter-card ${isExpanded ? "expanded" : ""} ${isDone ? "done" : ""}">
            <button type="button" class="chapter-head" onclick="selectChapter(${idx})">
              <div class="step-num">${isDone ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : `0${idx + 1}`}</div>
              <div class="chapter-head-info">
                <div class="chapter-title">${ch.title}</div>
                ${isExpanded ? "" : `<div class="chapter-preview">${ch.preview}</div>`}
              </div>
              <svg class="chapter-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            ${isExpanded ? `
              <div class="chapter-body">
                <div class="chapter-mantra-bar">
                  <div class="chapter-mantra-text">${ch.mantra}</div>
                  <button type="button" class="mini-icon-pill" onclick="speakChapterSpeech(${idx})">语音听讲</button>
                </div>

                <ul class="chapter-points">
                  ${ch.actions.map(act => `<li class="chapter-point">${act}</li>`).join("")}
                </ul>

                <div class="speech-disclosure">
                  <button type="button" class="speech-toggle-btn" onclick="toggleChapterSpeech(${idx})" aria-expanded="${speechOpen}">
                    <span>${speechOpen ? "收起讲师逐字稿" : "展开讲师讲解原话"}</span>
                    <svg class="chapter-chevron ${speechOpen ? "open" : ""}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  ${speechOpen ? `<div class="chapter-speech">${ch.speech}</div>` : ""}
                </div>

                <button type="button" class="chapter-next-btn" onclick="advanceChapter(${idx})">
                  <span>${idx + 1 < chapters.length ? `已了解，进入下一节（0${idx + 2}）` : "学完细节 · 去语音对练"}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                    <polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
              </div>
            ` : ""}
          </div>
        `;
      }).join("")}
    </div>

    ${(detailQaExpanded || detailQaMessages.length) ? `
      <div class="qa-card">
        <div class="card-head" style="margin-bottom:0">
          <div class="card-title" style="font-size:15px">按需追问 AI 讲师</div>
          ${detailQaMessages.length === 0 ? `<button type="button" class="qa-collapse-link" onclick="toggleDetailQa()">收起</button>` : ""}
        </div>

        <div class="qa-chips">
          <button type="button" class="qa-chip" onclick="askDetailQuestion('顾客嫌贵怎么接话？')">顾客嫌贵怎么接话？</button>
          <button type="button" class="qa-chip" onclick="askDetailQuestion('陈列没位置怎么放？')">陈列没位置怎么放？</button>
          <button type="button" class="qa-chip" onclick="askDetailQuestion('怎么自然提连带？')">怎么自然提连带？</button>
        </div>

        ${detailQaMessages.length ? `
          <div class="qa-thread">
            ${detailQaMessages.map(m => `
              <div class="bubble ${m.role}">
                <div class="bubble-sender">${m.role === "user" ? "我" : "AI 讲师解答"}</div>
                ${escapeHtml(m.text)}
              </div>
            `).join("")}
          </div>
        ` : ""}

        <form class="roleplay-text-form" onsubmit="handleDetailQaSubmit(event)">
          <input id="detail-qa-input" type="text" placeholder="输入具体产品或陈列问题..." autocomplete="off" />
          <button class="btn-pill-red" type="submit">提问</button>
        </form>
      </div>
    ` : `
      <button type="button" class="qa-collapsed-btn" onclick="toggleDetailQa()">
        <div class="qa-collapsed-left">
          <span class="qa-collapsed-title">还有细节疑问？</span>
          <span class="qa-collapsed-sub">按需追问 AI 讲师</span>
        </div>
        <span class="qa-collapsed-action">提问</span>
      </button>
    `}
  `;
}

/* ==================== 屏幕 4：虚拟形象语音对练与四维雷达页 ==================== */
function openRoleplay(id, opts = {}) {
  stopAllAudio();
  const visible = getVisibleProducts();
  const target = id ? PRODUCTS.find(p => p.id === id) : visible[0];
  if (!target || !canCurrentUserAccessSku(target)) {
    showToast("当前门店暂无该商品任务或尚未发布");
    return;
  }
  currentSku = target;
  showOnlyScreen("roleplay");
  document.getElementById("roleplay-nav-price").textContent = currentSku.price;
  renderRoleplaySkuStrip();
  resetRoleplayState(true, opts);
}

function renderRoleplaySkuStrip() {
  const visible = getVisibleProducts();
  document.getElementById("roleplay-sku-strip").innerHTML = visible.map(p => `
    <button type="button" class="sku-pill-btn ${p.id === currentSku.id ? "active" : ""}" onclick="openRoleplay('${p.id}')">
      ${escapeHtml(getProductShortName(p))}
    </button>
  `).join("");
}

function resetRoleplayState(triggerVoice = true, opts = {}) {
  stopAllAudio();
  avatarMood = "concern";
  const task = getActiveTaskForSku(currentSku.id, getCurrentStoreName());
  const rec = task ? ensureStaffRecord(task.id, getCurrentStaffKey()) : null;
  const hasHistory = Boolean(rec && (rec.retrain || rec.attempts.length > 0));
  if (typeof opts.useAlt === "boolean") {
    roleplayUseAlt = opts.useAlt;
  } else if (opts.toggleVariant) {
    roleplayUseAlt = !roleplayUseAlt;
  } else {
    roleplayUseAlt = Boolean(hasHistory && currentSku.persona.altQuestion);
  }
  avatarSubtitle = (roleplayUseAlt && currentSku.persona.altQuestion)
    ? currentSku.persona.altQuestion
    : currentSku.persona.question;
  lastUserSpeech = "";
  lastEvalResult = null;
  lastEvalIsDemo = false;
  showRoleplayTextBox = false;
  showUserTranscript = false;
  showCoachDetail = false;
  if (currentScreen === "roleplay") {
    renderRoleplayPane();
    if (triggerVoice) speakText(avatarSubtitle);
  }
}

function switchRoleplayQuestionVariant() {
  if (!currentSku.persona.altQuestion) return;
  resetRoleplayState(true, { toggleVariant: true });
  showToast(roleplayUseAlt ? "已切换为「换问法复练」顾客提问" : "已切回「原问法」顾客提问");
}

function toggleUserTranscript() {
  showUserTranscript = !showUserTranscript;
  renderRoleplayPane();
}

function toggleCoachDetail() {
  showCoachDetail = !showCoachDetail;
  renderRoleplayPane();
}

function renderAvatarSvg(style, mood) {
  const palette = {
    student: { bg: "#FFF1F2", hair: "#2B2D42", outfit: "#ED1C24" },
    mom: { bg: "#FFF5EC", hair: "#4A342E", outfit: "#E87A5D" },
    office: { bg: "#F2F5FA", hair: "#1F2937", outfit: "#3B5998" }
  }[style] || { bg: "#FFF1F2", hair: "#2B2D42", outfit: "#ED1C24" };

  const eyesSvg = mood === "happy"
    ? `<path d="M35 49 Q40 43 45 49" stroke="#1A1A1A" stroke-width="2.8" fill="none" stroke-linecap="round"/>
       <path d="M55 49 Q60 43 65 49" stroke="#1A1A1A" stroke-width="2.8" fill="none" stroke-linecap="round"/>`
    : `<circle cx="40" cy="48" r="3.4" fill="#1A1A1A" class="wink-eye-anim"/>
       <circle cx="60" cy="48" r="3.4" fill="#1A1A1A" class="wink-eye-anim"/>
       <circle cx="41.2" cy="46.8" r="1.1" fill="#FFFFFF"/>
       <circle cx="61.2" cy="46.8" r="1.1" fill="#FFFFFF"/>`;

  const browsSvg = mood === "concern"
    ? `<path d="M34 41 Q40 39 45 42" stroke="${palette.hair}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
       <path d="M55 42 Q60 39 66 41" stroke="${palette.hair}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    : `<path d="M34 40 Q40 37 45 40" stroke="${palette.hair}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
       <path d="M55 40 Q60 37 66 40" stroke="${palette.hair}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;

  const mouthSvg = mood === "happy"
    ? `<path class="avatar-mouth" d="M42 63 Q50 72 58 63" stroke="#D93843" stroke-width="3" fill="#FF9AA2" stroke-linecap="round"/>`
    : `<ellipse class="avatar-mouth" cx="50" cy="66" rx="5.5" ry="3.2" fill="#D93843"/>`;

  const glassesSvg = style === "office"
    ? `<rect x="32" y="42" width="16" height="12" rx="4" stroke="#1A1A1A" stroke-width="1.8" fill="none"/>
       <rect x="52" y="42" width="16" height="12" rx="4" stroke="#1A1A1A" stroke-width="1.8" fill="none"/>
       <line x1="48" y1="48" x2="52" y2="48" stroke="#1A1A1A" stroke-width="1.8"/>`
    : "";

  return `
    <svg viewBox="0 0 100 100" width="92" height="92" fill="none" aria-label="虚拟顾客形象">
      <rect width="100" height="100" fill="${palette.bg}"/>
      <circle cx="50" cy="44" r="31" fill="${palette.hair}"/>
      <path d="M16 100 C18 79 31 74 50 74 C69 74 82 79 84 100 Z" fill="${palette.outfit}"/>
      <path d="M41 74 L50 84 L59 74" fill="#FFFFFF"/>
      <rect x="44" y="66" width="12" height="11" rx="5" fill="#FCD9C2"/>
      <circle cx="50" cy="50" r="24" fill="#FFE4D1"/>
      <path d="M26 45 C28 27 42 22 50 22 C60 22 72 28 74 45 C68 35 60 32 50 34 C40 32 32 36 26 45 Z" fill="${palette.hair}"/>
      <ellipse cx="34" cy="57" rx="4.5" ry="2.6" fill="#FF9AA2" opacity="0.55"/>
      <ellipse cx="66" cy="57" rx="4.5" ry="2.6" fill="#FF9AA2" opacity="0.55"/>
      ${browsSvg}
      ${eyesSvg}
      ${glassesSvg}
      ${mouthSvg}
    </svg>
  `;
}

function speakText(text) {
  clearTimeout(speakFallbackTimer);
  isSpeaking = true;
  updateAvatarOrbitClass();

  const estMs = Math.min(6000, Math.max(1800, text.length * 145));
  if (ttsEnabled && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-CN";
      utter.rate = 1.06;
      utter.onend = () => {
        isSpeaking = false;
        updateAvatarOrbitClass();
      };
      utter.onerror = () => {
        isSpeaking = false;
        updateAvatarOrbitClass();
      };
      window.speechSynthesis.speak(utter);
      speakFallbackTimer = setTimeout(() => {
        isSpeaking = false;
        updateAvatarOrbitClass();
      }, estMs + 1500);
      return;
    } catch (_) {}
  }

  speakFallbackTimer = setTimeout(() => {
    isSpeaking = false;
    updateAvatarOrbitClass();
  }, 2200);
}

function updateAvatarOrbitClass() {
  const orbit = document.getElementById("avatar-orbit");
  if (!orbit) return;
  orbit.classList.toggle("speaking", isSpeaking);
  orbit.classList.toggle("listening", isRecording);
}

function toggleTts() {
  ttsEnabled = !ttsEnabled;
  if (!ttsEnabled && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (_) {}
    isSpeaking = false;
  }
  renderRoleplayPane();
  showToast(ttsEnabled ? "已开启虚拟形象语音播报" : "已切换为静音字幕模式");
}

function replayCustomerVoice() {
  speakText(avatarSubtitle);
}

function toggleRoleplayTextInput() {
  showRoleplayTextBox = !showRoleplayTextBox;
  renderRoleplayPane();
}

function toggleVoiceRecord() {
  if (isRecording) {
    finishVoiceRecord();
    return;
  }
  stopAllAudio();
  isRecording = true;
  recordSeconds = 0;
  liveTranscript = "";
  avatarMood = "listening";
  renderRoleplayPane();

  recordTimer = setInterval(() => {
    recordSeconds += 1;
    const lbl = document.getElementById("mic-btn-label");
    if (lbl) lbl.textContent = `正在收音 ${String(recordSeconds).padStart(2, "0")}s · 点击结束并生成评分`;
  }, 1000);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try {
      speechRec = new SR();
      speechRec.lang = "zh-CN";
      speechRec.interimResults = true;
      speechRec.continuous = true;
      speechRec.onresult = ev => {
        let txt = "";
        for (let i = 0; i < ev.results.length; i++) {
          txt += ev.results[i][0].transcript;
        }
        liveTranscript = txt.trim();
      };
      speechRec.onerror = () => {};
      speechRec.start();
    } catch (_) {
      speechRec = null;
    }
  }
}

function finishVoiceRecord() {
  clearInterval(recordTimer);
  isRecording = false;
  if (speechRec) {
    try { speechRec.stop(); } catch (_) {}
    speechRec = null;
  }
  if (!liveTranscript) {
    avatarMood = "concern";
    showRoleplayTextBox = true;
    renderRoleplayPane();
    showToast("未检测到有效语音，请重录或改用文字输入作答");
    return;
  }
  submitRoleplayAnswer(liveTranscript, { isDemo: false });
}

function simulateVoiceSpeak(level) {
  stopAllAudio();
  isRecording = true;
  avatarMood = "listening";
  renderRoleplayPane();
  const lbl = document.getElementById("mic-btn-label");
  if (lbl) lbl.textContent = "正在载入演示话术示例...";

  setTimeout(() => {
    isRecording = false;
    const speech = level === "high" ? currentSku.rubric.demoPitch : currentSku.rubric.avgPitch;
    submitRoleplayAnswer(speech, { isDemo: true });
  }, 650);
}

function handleRoleplayTextSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("roleplay-text-input");
  const text = input ? input.value.trim() : "";
  if (!text) return;
  submitRoleplayAnswer(text, { isDemo: false });
}

function evaluateRoleplay(text, sku) {
  const r = sku.rubric;
  const hitSelling = r.selling.filter(k => text.includes(k));
  const hitObjection = r.objection.filter(k => text.includes(k));
  const hitCrossSell = r.crossSell.filter(k => text.includes(k));
  const politeWords = ["您", "放心", "试试", "推荐", "舒服", "哦", "呢", "可以", "帮您"];
  const hitPolite = politeWords.filter(k => text.includes(k));

  const facts = Array.isArray(r.facts) ? r.facts : [];
  const factChecks = facts.map(f => ({
    label: f.label,
    required: f.required !== false,
    ok: matchFactRule(text, f)
  }));
  const missedFacts = factChecks.filter(f => !f.ok).map(f => f.label);
  const missedRequiredFacts = factChecks.filter(f => f.required && !f.ok).map(f => f.label);
  const redlineHits = GLOBAL_REDLINES.filter(rule => text.includes(rule.term));

  const clamp = v => Math.max(40, Math.min(99, Math.round(v)));
  const factPenalty = missedFacts.length * 10;
  const redlinePenalty = redlineHits.length ? 30 : 0;

  const selling = clamp(52 + hitSelling.length * 16 - factPenalty - redlinePenalty);
  const objection = clamp(50 + hitObjection.length * 16 - (redlineHits.length ? 15 : 0));
  const crossSell = clamp(48 + hitCrossSell.length * 17);
  const affinity = clamp(58 + hitPolite.length * 10 + (text.length >= 24 ? 10 : 0));

  const total = Math.round(selling * 0.35 + objection * 0.30 + crossSell * 0.20 + affinity * 0.15);
  // P0：必考事实逐项零漏项通过，同时无话术红线且总分 >= 85
  const passed = total >= 85 && redlineHits.length === 0 && missedRequiredFacts.length === 0;

  const dims = [
    { key: "selling", name: "卖点准确", score: selling, missing: [...missedFacts, ...r.selling.filter(k => !text.includes(k))].slice(0, 2) },
    { key: "objection", name: "异议化解", score: objection, missing: r.objection.filter(k => !text.includes(k)).slice(0, 2) },
    { key: "crossSell", name: "连带引导", score: crossSell, missing: r.crossSell.filter(k => !text.includes(k)).slice(0, 2) },
    { key: "affinity", name: "服务亲和", score: affinity, missing: [] }
  ];
  const weakest = [...dims].sort((a, b) => a.score - b.score)[0];

  return {
    total,
    passed,
    dims,
    hits: [...hitSelling, ...hitObjection, ...hitCrossSell],
    weakest,
    factChecks,
    missedFacts,
    missedRequiredFacts,
    redlineHits
  };
}

function buildRadarSvg(dims) {
  const cx = 140;
  const cy = 110;
  const maxR = 64;
  const [sTop, sRight, sBottom, sLeft] = dims.map(d => d.score / 100);

  const ringPoints = ratio => {
    const r = maxR * ratio;
    return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
  };

  const pts = [
    [cx, cy - maxR * sTop],
    [cx + maxR * sRight, cy],
    [cx, cy + maxR * sBottom],
    [cx - maxR * sLeft, cy]
  ];
  const polyStr = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  return `
    <svg viewBox="0 0 280 220" width="276" height="216" aria-label="四维能力雷达图">
      <polygon points="${ringPoints(1)}" fill="#FFFFFF" stroke="#DCE0E6" stroke-width="1.2"/>
      <polygon points="${ringPoints(0.66)}" fill="none" stroke="#E5E7EB" stroke-width="1" stroke-dasharray="3 3"/>
      <polygon points="${ringPoints(0.33)}" fill="none" stroke="#E5E7EB" stroke-width="1" stroke-dasharray="3 3"/>
      <line x1="${cx}" y1="${cy - maxR}" x2="${cx}" y2="${cy + maxR}" stroke="#E5E7EB" stroke-width="1"/>
      <line x1="${cx - maxR}" y1="${cy}" x2="${cx + maxR}" y2="${cy}" stroke="#E5E7EB" stroke-width="1"/>
      <polygon points="${polyStr}" fill="rgba(237, 28, 36, 0.20)" stroke="#ED1C24" stroke-width="2.4" stroke-linejoin="round"/>
      ${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.2" fill="#FFFFFF" stroke="#ED1C24" stroke-width="2.4"/>`).join("")}
      <text x="${cx}" y="20" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">卖点准确 ${dims[0].score}</text>
      <text x="242" y="${cy + 4}" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">异议化解</text>
      <text x="242" y="${cy + 20}" text-anchor="middle" fill="#ED1C24" font-size="12" font-weight="800">${dims[1].score} 分</text>
      <text x="${cx}" y="202" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">连带引导 ${dims[2].score}</text>
      <text x="38" y="${cy + 4}" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">服务亲和</text>
      <text x="38" y="${cy + 20}" text-anchor="middle" fill="#ED1C24" font-size="12" font-weight="800">${dims[3].score} 分</text>
    </svg>
  `;
}

function submitRoleplayAnswer(speechText, opts = {}) {
  const isDemo = Boolean(opts.isDemo);
  lastUserSpeech = speechText;
  lastEvalIsDemo = isDemo;
  const wasPassed = currentSku.passed;
  const res = evaluateRoleplay(speechText, currentSku);
  lastEvalResult = res;

  // P0/P1：演示试听与正式训练完全隔离；正式训练记录到当前门店任务、回写补训结果并持久化
  if (!isDemo) {
    currentSku.lastScore = res.total;
    currentSku.bestScore = Math.max(currentSku.bestScore || 0, res.total);
    if (res.passed) {
      currentSku.passed = true;
      if (!wasPassed) {
        addCurrentUserPoints(50);
        showToast("恭喜通关！获得今日挑战 +50 积分");
      }
    } else if (res.redlineHits.length > 0) {
      showToast(`触发话术红线「${res.redlineHits[0].term}」，未通关`);
    }

    syncLinRecordFromSku(currentSku);
    const activeTask = getActiveTaskForSku(currentSku.id, getCurrentStoreName());
    if (activeTask) {
      const rec = ensureStaffRecord(activeTask.id, getCurrentStaffKey());
      rec.attempts.unshift({
        score: res.total,
        passed: res.passed,
        missedFacts: res.missedFacts.slice(),
        weakestName: res.weakest.name,
        redlineHits: res.redlineHits.map(r => r.term),
        questionVariant: roleplayUseAlt ? "换问法" : "原问法",
        at: nowTimeLabel()
      });
      const rtStatus = normalizeRetrainStatus(rec.retrain);
      if (rec.retrain && (rtStatus === "pending" || rtStatus === "submitted_unfixed")) {
        const focusFixed = isRetrainFocusFixed(rec.retrain.focusPoint, res, currentSku, speechText);
        rec.retrain.attemptCount = (rec.retrain.attemptCount || 0) + 1;
        rec.retrain.afterScore = res.total;
        rec.retrain.afterMissedFacts = res.missedFacts.slice();
        rec.retrain.focusFixed = focusFixed;
        rec.retrain.completedAt = nowTimeLabel();
        if (focusFixed) {
          rec.retrain.status = "fixed_pending_review";
          showToast(res.passed
            ? "目标考点已改正且达标，已提交店长复查"
            : "目标考点已改正，已提交店长复查（建议同步补齐其余项）");
        } else {
          rec.retrain.status = "submitted_unfixed";
          flagWeakFlashcards(currentSku, [rec.retrain.focusPoint]);
          showToast(`已提交复练，但目标考点「${rec.retrain.focusPoint}」仍未改正，请留在首页继续补练`);
        }
      }
    }
    // P2：如有漏讲事实，唤醒最匹配的对应闪卡至首页优先推荐队列
    if (res.missedFacts.length > 0) {
      flagWeakFlashcards(currentSku, res.missedFacts);
    }
    savePilotState();
  } else {
    showToast("演示话术试听评分，不计入正式成绩与积分");
  }

  if (res.passed) {
    avatarMood = "happy";
    avatarSubtitle = currentSku.persona.happyReply;
  } else {
    avatarMood = "concern";
    avatarSubtitle = currentSku.persona.concernReply;
  }

  showUserTranscript = false;
  showCoachDetail = false;
  renderRoleplayPane();
  speakText(avatarSubtitle);
}

function renderRoleplayPane() {
  const pane = document.getElementById("pane-roleplay");
  const p = currentSku.persona;
  const moodMap = {
    concern: { text: "犹豫顾虑中", cls: "status-warn" },
    listening: { text: "认真倾听中", cls: "status-ok" },
    happy: { text: "认可满意", cls: "status-ok" }
  }[avatarMood];

  /* 评分后切换为复盘态：雷达卡居首展示，语音转写与提分示范按需披露，避免四块内容堆积 */
  if (lastEvalResult) {
    const coachAdvice = lastEvalResult.redlineHits.length > 0
      ? `触发门店红线（${lastEvalResult.redlineHits.map(r => `${r.term}：${r.reason}`).join("；")}），已限制本次不可通关，请修正表述。`
      : lastEvalResult.missedRequiredFacts && lastEvalResult.missedRequiredFacts.length > 0
        ? `必考核心事实未全部讲对（漏讲：${lastEvalResult.missedRequiredFacts.join("、")}），当前实行必考项零漏项一票否决，请补全后再练。`
        : lastEvalResult.passed
          ? "四维表达均衡，必考价格与核心规则逐项核对通过，达到金牌导购标准。"
          : `当前【${lastEvalResult.weakest.name}】偏弱（${lastEvalResult.weakest.score} 分），建议巩固后再复练。`;

    pane.innerHTML = `
      <div class="rp-compact-stage">
        <div class="rp-mini-avatar">${renderAvatarSvg(p.style, avatarMood)}</div>
        <div class="rp-mini-info">
          <div class="rp-mini-head">
            <span class="persona-pill">${escapeHtml(p.name)}</span>
            <span class="status-badge ${moodMap.cls}">${moodMap.text}</span>
          </div>
          <div class="rp-mini-reply">${escapeHtml(avatarSubtitle)}</div>
        </div>
        <button type="button" class="mini-icon-pill" onclick="toggleUserTranscript()">${showUserTranscript ? "收起原话" : "我的回答"}</button>
      </div>

      ${lastEvalIsDemo ? `
        <div class="demo-banner">演示试听模式 · 仅用于查看示例效果，不写入正式成绩、章节进度与积分</div>
      ` : ""}

      ${showUserTranscript && lastUserSpeech ? `
        <div class="user-transcript-box compact">${escapeHtml(lastUserSpeech)}</div>
      ` : ""}

      <div class="radar-card" id="radar-score-card">
        <div class="radar-head">
          <div>
            <div class="radar-title">AI 四维雷达评分卡</div>
            <div class="radar-hits">命中词：${lastEvalResult.hits.length ? lastEvalResult.hits.slice(0, 5).map(escapeHtml).join("、") : "暂未命中核心词"}</div>
          </div>
          <div class="radar-total-wrap">
            <span class="radar-total-score">${lastEvalResult.total}</span>
            <span class="status-badge ${lastEvalResult.passed ? "status-ok" : "status-warn"}">
              ${lastEvalResult.passed ? "已通关" : "建议复练"}
            </span>
          </div>
        </div>

        <div class="radar-svg-wrap">
          ${buildRadarSvg(lastEvalResult.dims)}
        </div>

        <div class="fact-check-wrap">
          <div class="fact-check-title">必考事实逐项校验与话术红线检查（漏任一必考项不可通关）</div>
          <div class="fact-pill-list">
            ${lastEvalResult.factChecks.map(fc => `
              <span class="fact-pill ${fc.ok ? "ok" : "miss"}">${fc.required ? "必考 · " : ""}${fc.ok ? "已核对" : "漏讲"} · ${escapeHtml(fc.label)}</span>
            `).join("")}
            ${lastEvalResult.redlineHits.length
              ? lastEvalResult.redlineHits.map(rl => `<span class="fact-pill redline">触发红线 · ${escapeHtml(rl.term)}（${escapeHtml(rl.reason)}）</span>`).join("")
              : `<span class="fact-pill ok">红线检查 · 合规通过</span>`
            }
          </div>
        </div>

        <div class="dim-grid">
          ${lastEvalResult.dims.map(d => `
            <div class="dim-cell">
              <span class="dim-name">${d.name}</span>
              <span class="dim-val ${d.score >= 85 ? "high" : "low"}">${d.score} 分</span>
            </div>
          `).join("")}
        </div>

        <div class="speech-disclosure">
          <button type="button" class="speech-toggle-btn" onclick="toggleCoachDetail()" aria-expanded="${showCoachDetail}">
            <span>${showCoachDetail ? "收起提分建议与金牌示范" : (lastEvalResult.passed ? "查看点评与金牌示范" : `薄弱项【${lastEvalResult.weakest.name}】· 查看示范`)}</span>
            <svg class="chapter-chevron ${showCoachDetail ? "open" : ""}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          ${showCoachDetail ? `
            <div class="coach-feedback-box" style="margin-top:8px">
              <div><strong>AI 导师建议：</strong>${escapeHtml(coachAdvice)}</div>
              <div><strong>金牌示范：</strong>${escapeHtml(currentSku.rubric.demoPitch)}</div>
            </div>
          ` : ""}
        </div>

        <div class="radar-footer-actions">
          <button type="button" class="fc-btn-again" onclick="speakText(currentSku.rubric.demoPitch)">朗读金牌示范</button>
          <button type="button" class="fc-btn-master" onclick="resetRoleplayState(true, { toggleVariant: true })">${roleplayUseAlt ? "切回原问法再练" : "换种问法复练"}</button>
        </div>
      </div>
    `;
    return;
  }

  const activeTask = getActiveTaskForSku(currentSku.id, getCurrentStoreName());
  const linTaskRec = activeTask ? ensureStaffRecord(activeTask.id, getCurrentStaffKey()) : null;
  const pendingRetrain = linTaskRec && isRetrainStillRequiredForStaff(linTaskRec) ? linTaskRec.retrain : null;
  const rtStatus = normalizeRetrainStatus(pendingRetrain);

  pane.innerHTML = `
    ${pendingRetrain ? `
      <div class="retrain-focus-banner">${rtStatus === "submitted_unfixed" ? "上次复练目标考点仍未改正" : "店长指派补训考点"}：${escapeHtml(pendingRetrain.focusPoint)}${activeTask ? `（截止：${formatDeadlineLabel(activeTask)}）` : ""}</div>
    ` : ""}

    <div class="avatar-stage">
      <div class="avatar-top-row">
        <div class="persona-pill">
          <span>${escapeHtml(p.name)}</span>
          <span class="status-badge ${moodMap.cls}">${moodMap.text}</span>
        </div>
        <div class="audio-ctrl-group">
          ${p.altQuestion ? `<button type="button" class="mini-icon-pill" onclick="switchRoleplayQuestionVariant()">换个问法</button>` : ""}
          <button type="button" class="mini-icon-pill" onclick="replayCustomerVoice()">重听</button>
          <button type="button" class="mini-icon-pill ${ttsEnabled ? "active" : ""}" onclick="toggleTts()">${ttsEnabled ? "语音开" : "已静音"}</button>
        </div>
      </div>

      <div class="avatar-center">
        <div id="avatar-orbit" class="avatar-orbit ${isSpeaking ? "speaking" : ""} ${isRecording ? "listening" : ""}">
          <div class="avatar-pulse"></div>
          <div class="avatar-pulse p2"></div>
          <div class="avatar-portrait">
            ${renderAvatarSvg(p.style, avatarMood)}
          </div>
        </div>
      </div>

      <div class="avatar-subtitle">
        <div class="avatar-reply-tag">${roleplayUseAlt ? "换问法复练 · 同一考点不同问法" : "虚拟顾客提问"}</div>
        <div>${escapeHtml(avatarSubtitle)}</div>
      </div>
    </div>

    <div class="voice-dock">
      <button type="button" class="mic-main-btn ${isRecording ? "recording" : ""}" onclick="toggleVoiceRecord()">
        ${isRecording
          ? `<span class="eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span><span id="mic-btn-label">正在收音 00s · 点击结束并生成评分</span>`
          : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg><span id="mic-btn-label">点击开始语音对练</span>`
        }
      </button>

      <div class="voice-quick-row">
        <button type="button" class="voice-chip-btn" onclick="simulateVoiceSpeak('high')">示例·高分话术</button>
        <button type="button" class="voice-chip-btn" onclick="simulateVoiceSpeak('avg')">示例·普通话术</button>
        <button type="button" class="voice-chip-btn" onclick="toggleRoleplayTextInput()">${showRoleplayTextBox ? "收起文字" : "文字输入"}</button>
      </div>

      ${showRoleplayTextBox ? `
        <form class="roleplay-text-form" onsubmit="handleRoleplayTextSubmit(event)">
          <input id="roleplay-text-input" type="text" placeholder="输入你的自定义导购话术立即打分..." autocomplete="off"/>
          <button class="btn-pill-red" type="submit">评分</button>
        </form>
      ` : ""}
    </div>
  `;
}

/* 初始化引导页（支持 URL ?account=...&user=... 独立账号与用户名登录 + 服务端多端共享状态同步） */
function restoreTabAccountFromUrlOrSession() {
  let reqAcc = "";
  let reqUser = "";
  try {
    if (typeof location !== "undefined" && location.search) {
      const params = new URLSearchParams(location.search);
      reqAcc = params.get("account") || "";
      reqUser = params.get("user") || "";
    }
    if (!reqAcc && typeof window !== "undefined" && window.sessionStorage) {
      reqAcc = window.sessionStorage.getItem(TAB_ACCOUNT_SESSION_KEY) || "";
      reqUser = window.sessionStorage.getItem(TAB_USER_SESSION_KEY) || "";
    }
  } catch (_) {}
  const slot = resolveAccountSlot(reqAcc || reqUser);
  if (slot) {
    setActiveAccountById(reqAcc || slot.id, reqUser);
    return true;
  }
  return false;
}

loadPilotState();
const hasExplicitAccount = restoreTabAccountFromUrlOrSession();
if (typeof document !== "undefined" && document.getElementById("ob-slide-card")) {
  renderSlide();
  renderRoleWheel();
  initRoleWheelEvents();
  startSlideAutoPlay();
  startServerSyncLoop();
  // ponytail: allow #home / #detail / #roleplay 或 ?account=... 直达多端视角
  if (typeof location !== "undefined") {
    const hasQueryAccount = new URLSearchParams(location.search || "").has("account");
    if (location.hash === "#home" || (hasQueryAccount && hasExplicitAccount && !location.hash)) {
      enterHome();
    } else if (location.hash === "#detail") {
      openCourse(getVisibleProducts()[0]?.id || PRODUCTS[0].id);
    } else if (location.hash === "#roleplay") {
      openRoleplay(getVisibleProducts()[0]?.id || PRODUCTS[0].id);
    } else {
      fetchPilotStateFromServer(false);
    }
  }
}
