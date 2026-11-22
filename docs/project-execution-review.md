# MINISO AI 产品授课与导购陪练 · 项目流程与审查

审查对象为 2026 年 11 月 19 日工作区中的静态 Web 原型与 PRD。流程图按四类业务用户编排。总部培训运营是 PRD 中的 PC 角色，当前交付目录提供三种移动端演示视角。 [项目入口](/Users/xiaoqi/dev/shouke/index.html) · [PRD](/Users/xiaoqi/dev/shouke/PRD.md)

## 流程图索引

[可编辑 draw.io 文件（7 页）](/Users/xiaoqi/dev/shouke/docs/project-flows.drawio)

| 页 | 流程 | PNG |
| --- | --- | --- |
| 01 | 四角色业务总览与数据流向 | [总览](/Users/xiaoqi/dev/shouke/docs/flow-previews/overview.png) |
| 02 | 启动、预览入口、角色切换与状态生命周期 | [启动与状态](/Users/xiaoqi/dev/shouke/docs/flow-previews/startup.png) |
| 03 | 员工首页、任务状态、逐节学习、闪卡与打卡 | [员工学习](/Users/xiaoqi/dev/shouke/docs/flow-previews/staff-learning.png) |
| 04 | 员工对练、输入分支、评分、复练与通关 | [员工对练](/Users/xiaoqi/dev/shouke/docs/flow-previews/staff-roleplay.png) |
| 05 | 店长早会带教、催学、微课生成与预览 | [门店店长](/Users/xiaoqi/dev/shouke/docs/flow-previews/store-manager.png) |
| 06 | 区域看板、门店督导和大区必考 | [区域经理](/Users/xiaoqi/dev/shouke/docs/flow-previews/area-manager.png) |
| 07 | 总部导入、制课、审校、发布和复盘 | [总部培训运营](/Users/xiaoqi/dev/shouke/docs/flow-previews/headquarters.png) |

图例使用蓝色实线框表示原型交互、橙色实线框表示样例或模拟、紫色虚线表示 PRD 规划或待接通能力，红色框标出审查发现。

## 项目如何执行

1. 浏览器打开入口文件，加载 `styles.css` 和 `app.js`。脚本初始化三款预置商品、用户激励、打卡和管理视图样例，启动引导页轮播、角色选择器和输入事件。`#home`、`#detail`、`#roleplay` 可在启动时直达预览页。 [入口](/Users/xiaoqi/dev/shouke/index.html:202) · [初始化](/Users/xiaoqi/dev/shouke/app.js:2005)
2. 选角后，页面切换逻辑控制引导、首页、讲解和对练四个容器的显示。首页按当前角色渲染。商品讲解与对练为共享页面，底栏可直达对练或返回当前角色首页。切页会尝试停止当前播报和收音。 [页面切换](/Users/xiaoqi/dev/shouke/app.js:427) · [角色与导航](/Users/xiaoqi/dev/shouke/app.js:706)
3. 各操作直接修改脚本中的商品对象或页面变量，再渲染对应界面。学习进度、训练成绩和店长新课可在同一页面会话内看到，刷新后回到预置状态。当前项目没有后端、跨账号同步或组织权限校验。 [状态定义](/Users/xiaoqi/dev/shouke/app.js:332) · [新课写入](/Users/xiaoqi/dev/shouke/app.js:1247)

## 分角色执行过程

### 1. 门店员工

- **学习主线。** 首页主卡使用列表中第一款未通关商品。本周商品目录提供同样的状态与动作。员工可按三节学习核心卖点、陈列试样、连带异议，也可按需展开章节、查看讲师逐字稿、语音听讲或提问。答疑按关键词使用当前商品的预置资料。会话内可返回首页并续学。学完可去对练，单品通关后首页转向下一款，所有商品达标后显示复习和复练入口。 [任务状态](/Users/xiaoqi/dev/shouke/app.js:455) · [课程与答疑](/Users/xiaoqi/dev/shouke/app.js:1346)
- **对练分支。** 选择商品后，固定顾客画像与问题随商品切换。员工可用语音、文字或演示话术作答。本地规则按卖点准确度 35%、异议化解力 30%、连带引导力 20%、服务亲和度 15% 计算总分。达到 85 分通关，首次通关加 50 分。评分页显示雷达、命中词、薄弱项与示范，可重练或回首页。 [作答逻辑](/Users/xiaoqi/dev/shouke/app.js:1693) · [评分与反馈](/Users/xiaoqi/dev/shouke/app.js:1771)
- **并行任务。** 按商品或全部筛选闪卡，翻面看答案并标记「已掌握」或「需再巩固」。首次从未掌握标为掌握加 10 分。组内全掌握后可再刷或去对练。门店陈列与试样动作可打卡或撤销，完成全部实操后清单折叠。 [闪卡与打卡](/Users/xiaoqi/dev/shouke/app.js:732)

### 2. 门店店长

- **早会与催学。** 查看预置通关看板和员工明细，轮换三道早会题，按需展开参考话术。点击「一键催学」后，演示名单更新为「已催学」，页面显示发送提示。企微消息和基于真实得分的待补考名单仍需接通。 [店长首页](/Users/xiaoqi/dev/shouke/app.js:1078) · [催学](/Users/xiaoqi/dev/shouke/app.js:1241)
- **补充微课。** 展开表单，输入商品名和卖点，校验必填项，生成章节、闪卡、顾客场景与评分词，置顶到会话商品列表并打开详情。切回员工视角可见该课程。预置模板含固定护手霜价格和场景，需要与实际商品事实及门店发布范围绑定。 [制课流程](/Users/xiaoqi/dev/shouke/app.js:1247)

### 3. 区域经理

- **巡查与督导。** 查看区内通关率、重点品类掌握度和门店红黑榜。对滞后样例门店点击催办后，按钮回显「已发督导」。大区必考按钮当前只展示发送提示。PRD 要求选择商品和截止时间，触达辖区店长及员工。 [区域首页](/Users/xiaoqi/dev/shouke/app.js:1168) · [督导处理](/Users/xiaoqi/dev/shouke/app.js:830) · [PRD 区域端](/Users/xiaoqi/dev/shouke/PRD.md:146)

### 4. 总部培训运营

- **生产与发布。** PRD 规划在 PC 导入 PPT、PDF、SKU Excel 或文本，提取商品属性并生成知识卡、授课脚本、顾客剧本和评分规则。培训师审校后选择大区、门店等级与必考截止时间，员工在工作台接收任务，店长和区域查看进度。 [PRD 总部端](/Users/xiaoqi/dev/shouke/PRD.md:153)
- **维护与复盘。** 同步组织岗位，维护商品知识库、IP 授权规范和禁语，查看发布后 24、48、72 小时通关曲线与高频失分项，支持导出。ERP、POS 联动与拍照陈列验收归入后续阶段。 [PRD 组织与报表](/Users/xiaoqi/dev/shouke/PRD.md:162) · [分期](/Users/xiaoqi/dev/shouke/PRD.md:198)

## 审查发现与验收建议

| 优先级 | 发现 | 试点验收 |
| --- | --- | --- |
| 高 | **空录音和演示样例可写入正式形态的成绩。** 实测 Chiikawa 空录音走预置话术，得 99 分并加 50 分。 [录音兜底](/Users/xiaoqi/dev/shouke/app.js:1733) | 收音无转写时提示重录或改用文字。示例得分与正式通关、积分分开。 |
| 高 | **学习进度与对练结果被混写。** 实测从底栏直接进入对练，提交 52 分后章节由 `1/3` 变成 `3/3`。末节也可单独打开并跳转对练。 [章节推进](/Users/xiaoqi/dev/shouke/app.js:1377) · [评分写回](/Users/xiaoqi/dev/shouke/app.js:1843) | 明确定义是否允许先对练。章节完成只由学习动作推进，对练只更新训练成绩与对应通关状态。 |
| 高 | **任务触达和结果回流还停留在演示。** 店长催学、区域督导只有本地回显，大区必考只有提示。管理看板读取固定样例。同一页面会话内可看到店长新课，刷新后三款预置商品恢复。 [催学与制课](/Users/xiaoqi/dev/shouke/app.js:1241) · [区域下发](/Users/xiaoqi/dev/shouke/app.js:1210) | 用不同账号走完任务发布、员工接收与续学、对练提交、店长聚合和区域聚合。成功提示与真实发送结果一致。 |
| 高 | **通用微课使用固定商品事实。** 输入不同商品仍会附加护手霜价格、卖点和顾客场景。 [微课模板](/Users/xiaoqi/dev/shouke/app.js:1254) | 由录入资料或知识库提供事实。发布前审校价格、成分、授权和话术红线。 |
| 中 | **排行榜和成绩文案不一致。** 实测 910 分时顶部显示第 1，页尾仍以固定顺序显示第 2。「上次」成绩用的是历史最高分。 [榜单](/Users/xiaoqi/dev/shouke/app.js:1055) · [分数状态](/Users/xiaoqi/dev/shouke/app.js:474) | 榜单与个人名次使用同一排序规则。分开存储本次和历史最高成绩，显示对应口径。 |
| 中 | **闪卡复刷可重复加分。** 「再刷一遍」会清除掌握标记，之后重新标记可再次获得积分。 [闪卡重刷](/Users/xiaoqi/dev/shouke/app.js:760) | 将复习状态与奖励记录分开，并按规则为同一张卡去重。 |
| 中 | **用户文本直接进入 HTML 渲染。** 商品录入、讲师问答和作答原话存在未做文本转义的渲染路径。 [问答渲染](/Users/xiaoqi/dev/shouke/app.js:1511) · [作答回显](/Users/xiaoqi/dev/shouke/app.js:1899) | 用纯文本方式渲染用户内容。需要富文本时使用允许列表进行净化。 |

## 验证范围

浏览器复跑了员工续学、文字低分、空录音回退、积分与名次、店长抽查与催学、创建微课后切换员工视角、区域督导与下发提示，以及刷新恢复。真实麦克风转写、企微送达以及总部 PC 流程的验证需要对应集成环境。
