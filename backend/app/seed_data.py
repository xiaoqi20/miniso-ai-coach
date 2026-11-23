"""开发样例数据。

ID 与 m1.md 附录 A 保持一致，前端 Mock 和后端种子可以直接复用。
课程文字和评分规则来自已验收的 M1 契约，不在此处临时改写业务口径。
"""

from app.models.identity import MembershipRole, UserRole

# 两家试点门店：北京路为目标门店，佛山用于隔离和统计边界用例。
STORES = [
    {"id": "store_bj", "code": "BJ-001", "name": "北京路旗舰店", "active": True},
    {"id": "store_fs", "code": "FS-001", "name": "佛山祖庙百货店", "active": True},
]

# 3 名北京员工、2 名佛山员工、2 名北京店长、2 名总部运营。
USERS = [
    {
        "id": "usr_linxiaomei",
        "name": "林小美",
        "role": UserRole.staff,
        "store_id": "store_bj",
        "membership_role": MembershipRole.staff,
    },
    {
        "id": "usr_chenajie",
        "name": "陈阿杰",
        "role": UserRole.staff,
        "store_id": "store_bj",
        "membership_role": MembershipRole.staff,
    },
    {
        "id": "usr_wangxiaoxue",
        "name": "王晓雪",
        "role": UserRole.staff,
        "store_id": "store_bj",
        "membership_role": MembershipRole.staff,
    },
    {
        "id": "usr_zhoulin",
        "name": "周琳",
        "role": UserRole.staff,
        "store_id": "store_fs",
        "membership_role": MembershipRole.staff,
    },
    {
        "id": "usr_hejing",
        "name": "何静",
        "role": UserRole.staff,
        "store_id": "store_fs",
        "membership_role": MembershipRole.staff,
    },
    {
        "id": "usr_liming",
        "name": "李明",
        "role": UserRole.store_manager,
        "store_id": "store_bj",
        "membership_role": MembershipRole.store_manager,
    },
    {
        "id": "usr_zhangtao",
        "name": "张涛",
        "role": UserRole.store_manager,
        "store_id": "store_bj",
        "membership_role": MembershipRole.store_manager,
    },
    {"id": "usr_linmin", "name": "林敏", "role": UserRole.hq_ops},
    {"id": "usr_zhouyi", "name": "周毅", "role": UserRole.hq_ops},
]

COURSE_ID = "crs_chiikawa"
COURSE_VERSION_ID = "crv_chiikawa_v1"
RUBRIC_VERSION_ID = "rbn_chiikawa_v1"
SKU_CODE = "MINISO-CHIIKAWA-BOX-01"

# 课程内容快照：章节 key 必须稳定，员工进度和补训考点都依赖它。
COURSE_CONTENT = {
    "product": {
        "name": "Chiikawa 联名毛绒公仔盲盒",
        "summary": "日系超人气正版 IP 盲盒 · 入口第一堆头引流爆款",
        "price": "¥59.00",
        "tag": "IP 爆款必考",
        "icon": "box",
    },
    "chapters": [
        {
            "key": "ch1",
            "short": "01 核心卖点",
            "title": "核心卖点与材质工艺",
            "preview": "正版授权 · 超柔短毛绒 · 6常规+1隐藏",
            "speech": (
                "这款是门店当下最核心的引流 IP 爆款。切忌一上来就报 59 元价格，"
                "先讲清楚它是日本正版联名授权，面料做了定制超柔短毛绒，"
                "全套包含 6 个常规款和 1 个睡衣乌萨奇隐藏款。"
            ),
            "actions": [
                "品质锚点：定制超柔短毛绒 + 环保 PP 棉，挂书包不易变形。",
                "稀缺规则：全套 6 常规 + 1 隐藏，拼端盒 6 个必不重复。",
            ],
            "mantra": "记忆口诀：正版授权 + 软糯手感 + 隐藏惊喜",
        },
        {
            "key": "ch2",
            "short": "02 陈列试样",
            "title": "黄金陈列与试样动作",
            "preview": "入口第一堆头 · 必须摆放拆封展示样品",
            "speech": (
                "盲盒靠的就是情绪价值和第一眼手感。货架必须固定在门店入口第一堆头"
                "或 IP 核心专区，前方一定要拆出 1 到 2 个实物样品，"
                "顾客靠近时主动递上手让对方捏一捏。"
            ),
            "actions": [
                "陈列红线：入口第一堆头，正面露出乌萨奇/吉伊主视觉。",
                "破冰动作：主动递上拆封样品，触碰后成交率翻倍。",
            ],
            "mantra": "门店红线：没拆样品 = 流失一半成交率",
        },
        {
            "key": "ch3",
            "short": "03 连带应答",
            "title": "收银连带与异议化解",
            "preview": "9.9元防尘挂袋 · 化解 59 元嫌贵顾虑",
            "speech": (
                "顾客犹豫怕抽不到喜欢款时，引导摇盒挑手感或约朋友拼端盒；"
                "顾客准备结账时，顺手递上 9.9 元透明亚克力防尘痛包挂袋，"
                "解决浅色毛绒挂包易脏痛点。"
            ),
            "actions": [
                "异议化解：强调正版工艺 + 可摇盒挑手感 / 拼端盒不重样。",
                "连带公式：盲盒 + 9.9 元防尘展示挂袋，轻松提客单。",
            ],
            "mantra": "连带金句：加 9 块 9 配个防尘袋，挂包出片不怕脏",
        },
    ],
}

# 评分规则快照：事实组、同义变体、红线与四维关键词都随发布版本冻结。
RUBRIC_RULES = {
    "schema_version": 1,
    "pass_threshold": 85,
    "weights": {
        "selling": 0.35,
        "objection": 0.30,
        "cross_sell": 0.20,
        "affinity": 0.15,
    },
    "required_facts": [
        {
            "key": "fact_price",
            "label": "零售价 59 元",
            "type": "price",
            "patterns": ["59", "五十九"],
            "negation_guard": True,
        },
        {
            "key": "fact_license",
            "label": "正版联名授权",
            "type": "groups",
            "groups": [["正版", "官方"], ["授权", "联名"]],
        },
        {
            "key": "fact_box_rule",
            "label": "端盒 6 个不重复",
            "type": "groups",
            "groups": [
                ["端盒", "整盒"],
                ["6", "六", "六个", "六只"],
                ["不重复", "不重样", "不会重复", "不会重样"],
            ],
        },
    ],
    "dimensions": {
        "selling": {
            "label": "卖点准确",
            "keywords": ["正版", "联名", "授权", "毛绒", "手感", "隐藏"],
        },
        "objection": {
            "label": "异议化解",
            "keywords": ["端盒", "整盒", "不重复", "不重样", "摇盒", "挑选", "品质", "细腻"],
        },
        "cross_sell": {
            "label": "连带引导",
            "keywords": ["样品", "摸", "防尘", "挂袋", "9.9", "加购", "搭配", "连带"],
        },
        "affinity": {
            "label": "服务亲和",
            "keywords": ["您", "放心", "试试", "推荐", "舒服", "哦", "呢", "可以", "帮您"],
        },
    },
    "redlines": [
        {"term": "治病", "reason": "禁止医疗功效宣称"},
        {"term": "疗效", "reason": "禁止医疗功效宣称"},
        {"term": "杀菌", "reason": "非消字号禁止宣称杀菌"},
        {"term": "消毒", "reason": "非消字号禁止宣称消毒"},
        {"term": "绝对不过敏", "reason": "禁止绝对化安全承诺"},
        {"term": "永久不坏", "reason": "禁止绝对化质保承诺"},
        {"term": "买一送一", "reason": "禁止未经授权的促销承诺"},
        {"term": "保真退十", "reason": "禁止未经授权的赔付承诺"},
    ],
    "scenario": {
        "persona_name": "潮流学生 · 小雨",
        "persona_style": "student",
        "question": "这个挂件盲盒一个就要 59 块，比普通钥匙扣贵好多，万一抽不到乌萨奇岂不是亏了？",
        "alt_question": "我打算买两个送闺蜜，59 元一个怎么挑才不会抽重？要是配防尘袋一起买怎么算？",
        "happy_reply": "哇，摸起来确实超软糯！那我再挑两盒，顺便加 9 块 9 配个防尘挂袋挂包上。",
        "concern_reply": "嗯……听起来还是有点拿不准，我再逛逛看看别的吧。",
    },
    "average_pitch": (
        "这个确实是 59 元，因为是热门联名盲盒所以会贵一点，"
        "抽盲盒嘛看运气，喜欢的话可以拿一个试试。"
    ),
    "demo_pitch": (
        "您摸摸我们拆好的样品，这款虽然 59 元但它是日本正版联名授权，"
        "定制超柔短毛绒手感非常软糯！如果想稳抽乌萨奇可以摇盒挑手感，"
        "或者和朋友拼端盒 6 个绝对不重复，结账还可以加 9.9 元换购防尘挂袋挂包不怕脏哦！"
    ),
}