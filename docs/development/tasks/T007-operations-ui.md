# T007 总部 PC 与店长 H5

仅 Antigravity App 可领取和实现。前置任务为 T006。后端实现期间可使用已审契约和 Mock。 [任务看板](../board.md)

## 目标与范围

维护 `frontend/` 中的总部、店长视图及各自路由模块。沿用 T006 的会话、公共 API 层和路由扩展方式。查阅 `vue-best-practices`。 [项目 Skills](../../../.agents/skills/README.md)

## 交付与验收

- [x] 总部 PC 页能查看及审校新品草稿、核对目标门店和截止时间、提交发布并查看结果。
- [x] 店长 H5 能查看授权店员的培训进度、48 小时统计与卡点，可指派补训、查看复练证据、确认待复查结果。
- [x] 权限失败、重复提交及状态冲突有可理解的反馈。用桌面视口和移动视口走通各自路径，记录结果供 T008 联调使用。

## 交付记录

- **认领**：2026-11-24，Antigravity App，`feat/t007-operations-ui`（基于 T006 返工提交 `feat/t006-employee-h5@e5712d6`）。
- **变更文件**：
  - `frontend/src/types/api.ts`：补齐 M1 v1.0 契约总部（§6.5）、店长（§6.7）及 48 小时统计（§6.8）全量 `snake_case` 类型与评分规则类型。
  - `frontend/src/api/client.ts`、`hq.ts`、`manager.ts`、`src/utils/errors.ts`、`src/utils/hqReleases.ts`：扩展 `httpRequest` 响应头读取钩子以识别 `Idempotent-Replay: true`；实现总部 10 项接口与店长 7 项接口（`mock` / `real` 双模式同契约分发，发布/补训/复查携带 `Idempotency-Key`）；统一将 403/404/409/422 契约错误码映射为中文提示、恢复引导与刷新入口。
  - `frontend/src/mock/seed.ts`、`server.ts`、`helpers.ts`、`hq.ts`、`manager.ts`：扩展持久化 Mock 服务端，新增待审校新品草稿 `crs_thermos`（不生成任务，不影响员工端初始基线）、升级员工端动态读取绑定课程版本内容与评分规则，完整实现修订号乐观锁、三项审校清单、不可变版本与 `superseded` 替代、`Idempotency-Key` 幂等重放与复用拒绝、跨店 404 隔离、补训单开与证据冻结核验、左闭右开 48 小时统计及空名单 `rate=null` 口径。
  - `frontend/src/components/ReleaseStatsCard.vue`、`HqDraftEditor.vue`、`HqReviewPublishPanel.vue`、`HqQuickPublishCard.vue`、`ManagerRetrainReviewCard.vue`：共享 48 小时统计卡（空名单显示「暂无应训人员」）、总部草稿编辑与评分规则核对组件、总部审校清单与定向发布面板（自动维护并按改参轮换幂等键）、复刻原型「总部简版：新品录入与审校发布」首屏直达卡片、店长冻结复练证据核验与补训/复查操作卡。
  - `frontend/src/components/AppShellDesktop.vue`、`frontend/src/assets/main.css`：升级总部 PC 顶栏为原型名创红渐变品牌头、白底红字 `MINISO` 胶囊标、身份条与透明白框「切换角色」按钮。
  - `frontend/src/router/hqRoutes.ts`、`managerRoutes.ts`、`src/views/hq/HqDashboardView.vue`、`HqCourseWorkbenchView.vue`、`HqReleaseDetailView.vue`、`src/views/manager/ManagerHomeView.vue`、`ManagerAssignmentDetailView.vue`：替换 T006 占位页（移除 `src/views/stubs/`），交付复刻原型三段卡片（新品录入审校发布 + 试点上新任务跟踪 + 首轮试点 48h 概览）的总部 PC 工作台、草稿审校发布页、发布批次结果与 48 小时统计页，以及店长 H5 端进度统计看板、店员复练证据核验、补训指派与复查确认页。
  - `frontend/README.md`：更新总部与店长路由约定及 T008 联调说明。
  - `frontend/tests/operations-mock.spec.ts`、`hq-flow.spec.ts`、`manager-flow.spec.ts`、`http-client.spec.ts`：新增总部/店长契约单测、双角色组件集成测试及真实 HTTP `Idempotency-Key` / `Idempotent-Replay` 校验。
- **提交 / PR**：`feat/t007-operations-ui` 分支代码提交 `f391c6c`、原型视觉对齐提交 `13d4473`。
- **自动化验证命令与结果**：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**9 个测试文件、28 项测试全部通过**（含既有 T006 19 项回归 + 新增 9 项 T007 契约、原型快速发布、权限、幂等、乐观锁冲突与三角色闭环测试）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
- **双视口内置浏览器实测结果（`http://127.0.0.1:5173/`，Mock 模式）**：
  - **桌面视口（1280×800）总部 PC 路径**：以「林敏（`usr_linmin`）」登录 `/hq` -> 核对名创红渐变顶栏及双栏原型三大卡片（新品录入与审校发布、试点上新任务跟踪、首轮试点 48h 概览），在首屏快速录入「三丽鸥联名香薰礼盒」并勾选双门店与人工审校确认一键发布成功（同步刷新列表与 5 人应训快照）-> 进入 `crs_thermos` 编辑保存草稿（修订 `#1`→`#2`）-> 验证未全勾清单触发 `REVIEW_CHECKLIST_INCOMPLETE` 反馈 -> 勾选三项清单审校通过（显示审校人及时间）-> 选定北京路旗舰店 + 佛山祖庙百货店与 72 小时截止提交发布（生成 `rls_mock_11`，应训 5 人）-> 同键再次点击确认命中幂等重放提示且未重复建批 -> 进入 `/hq/releases/rls_mock_11` 核对 48h 统计（`0 / 5`）与 5 人应训名单快照 -> 地址栏直访 `/manager` 成功触发越权拦截并回到 `/hq`。
  - **移动视口（390×844）店长 H5 与跨角色闭环路径**：先以员工「陈阿杰（`usr_chenajie`）」完成同义表达复练（91 分通关，推进至「已改正待复查」）-> 切换店长「李明（`usr_liming`）」登录 `/manager`，验证移动端无横向溢出（宽 390px）、待办提醒横幅（待复查 1 人）、Chiikawa 批次 48h 统计 `1 / 3`（`33.3%`）与授权店员列表 -> 进入陈阿杰详情页核对第 2 轮冻结复练证据（「端盒六个不重样」命中证据）并确认复查通过 -> 验证状态更新为「复查通过」且审计轨迹新增操作人「李明」记录 -> 验证无成绩员工王晓雪详情提示 `NO_ATTEMPT` -> 直访越权/不存在任务 `asg_other_store_404` 清晰展示 `404 NOT_FOUND` 与返回入口；全程零 `console.error` / `pageerror`。
- **尚未验证项 / 交接 T008 说明**：
  - 真实后端三角色在线联调（含 T005 店长补训、复查与 48h 统计 API 及 MySQL 8.4）留待 T005 合并后的 T008 端到端联调验收。`/hq/releases/:releaseId` 已针对 T005 统计接口未部署时的 404 做降级摘要展示，T005 上线后无需修改前端即可展示完整分门店 48h 统计。
- **Codex 验收结论**：未通过，详见下方验收记录。

## Codex 验收（2026-11-24，`e6e2e64`）

验收未通过，T007 退回「进行中」，由 Antigravity App 返工。T008 继续排队。

### 独立验证

- 分支 `feat/t007-operations-ui` 的类型检查、Vitest（9 个文件、29 项）及 Mock、Real 构建均通过。
- 总部 PC（1280×800）验证保温杯草稿审校。清单未全勾时提示 `REVIEW_CHECKLIST_INCOMPLETE`。完成三项人工审校后向北京路、佛山祖庙定向发布，截止为 72 小时，生成批次 `rls_mock_11` 和 5 人应训名单。同键提交返回原批次，详情显示 `0 / 5`。总部访问店长路由时被引导回总部首页。
- 店长 H5（390×844）验证林小美漏讲「端盒 6 个不重复」后由李明指派补训。林小美以「端盒六个不重样」完成 91 分复练。李明核查第 2 轮冻结证据并确认通过，页面记录两项审计操作，48 小时通关人数由 `0 / 3` 更新为 `1 / 3`。不存在的员工任务显示 `404 NOT_FOUND` 和返回入口。
- 真实后端与企业微信客户端联调归入 T008。

### 返工项与复验标准

1. **总部快捷发布把保温杯话术写入其他商品课程（P1）。** 从总部首页快捷发布「桌面三格收纳盒」，价格为 39 元，卖点为透明亚克力，连带商品为 8 元标签贴。员工收到任务后在对练页试听并点「填入本课金牌示范」，实际出现 79 元、316 不锈钢、6 小时保温和 15 元杯套。快捷表单复制 `THERMOS_RUBRIC` 后只替换必考事实与两套问法，示范、评分关键词和顾客回复继续使用保温杯内容。复验需发布两个事实不同的商品，核对实际绑定的课件、评分规则、示范和顾客问答。缺少经审校的内容时应停留在草稿。定位见 [HqQuickPublishCard.vue](../../../frontend/src/components/HqQuickPublishCard.vue#L126)。
2. **总部快捷发布丢失响应后无法重试原批次（P2）。** 组件测试注入故障，让发布在 Mock 中成功写入后丢失响应。保留已填写的 SKU 再点发布时，页面尝试重新创建课程并报 `sku_code 已存在`，未重试原发布请求。复验需覆盖发布前失败和写入后丢失响应，确认继续使用原课程版本、发布参数和幂等键，并显示原批次及唯一的应训名单。定位见 [HqQuickPublishCard.vue](../../../frontend/src/components/HqQuickPublishCard.vue#L134)。
3. **店长切换批次时，旧响应覆盖新批次名单（P2）。** 组件测试延迟 `rls_m1_bj` 的名单响应，先切到该批次，再切回 `rls_mock_11`。释放旧响应后，当前高亮仍为 `rls_mock_11`，名单和员工详情入口却来自 `rls_m1_bj`。复验需控制两个批次请求反序返回，并覆盖旧请求失败。确认名单、统计、错误提示和加载状态始终对应当前批次。定位见 [ManagerHomeView.vue](../../../frontend/src/views/manager/ManagerHomeView.vue#L92)。

## Antigravity App 返工记录（2026-11-24，`5532abe`、`2092b38`）

针对 Codex 验收退回的三项问题（P1 快捷发布话术串用、P2 丢响应重试无法恢复原批次、P2 店长切批旧响应覆盖）已完成根因修复与专项回归：

- **改动文件**：
  - [courseRubric.ts](../../../frontend/src/utils/courseRubric.ts)：新增纯函数 `buildCourseRubricFromForm()`，完全由当前商品表单的名称、零售价、连带商品、必考事实与卖点话术动态构造独立的 `required_facts`、`dimensions` 四维关键词、全店通用 `redlines`、顾客 `scenario`（问法/换问法/积极与顾虑回复）、`average_pitch` 与 `demo_pitch`，彻底移除对 `THERMOS_RUBRIC` 等示例商品的拷贝依赖。
  - [HqQuickPublishCard.vue](../../../frontend/src/components/HqQuickPublishCard.vue) & [HqDashboardView.vue](../../../frontend/src/views/hq/HqDashboardView.vue)：
    1. 移除默认预填的 Chiikawa 商品字段，一键「审校通过并发布」强校验零售价、必考核对事实与卖点话术均已填写，缺失经审校内容时拒绝直发并引导「存为待审校草稿」停留在草稿态。
    2. 引入分阶段提交断点恢复态（同步持久化至 `sessionStorage`，保存 `courseId`、`versionId`、`revision`、`reviewed`、`storeIds`、`deadlineHours` 与固定 `publishIdempotencyKey`）。当审校或发布阶段发生发布前失败或写入后响应丢失时，再次点击主按钮直接从断点续传并以原版本和同一 `Idempotency-Key` 幂等取回原批次，不重复建课也不重复生成应训任务（提供「放弃并新建」手动清空恢复态）。
  - [ManagerHomeView.vue](../../../frontend/src/views/manager/ManagerHomeView.vue)、[ManagerAssignmentDetailView.vue](../../../frontend/src/views/manager/ManagerAssignmentDetailView.vue)、[HqCourseWorkbenchView.vue](../../../frontend/src/views/hq/HqCourseWorkbenchView.vue)、[HqReleaseDetailView.vue](../../../frontend/src/views/hq/HqReleaseDetailView.vue)：为异步加载统一增加单调递增请求序号（`requestSeq`）与当前目标 ID 校验；店长切换批次时立即清空旧批次名单与统计，丢弃一切迟到的旧批次成功或失败响应，确保名单、统计、错误提示和加载状态始终与当前选中批次一致。
  - [hq-flow.spec.ts](../../../frontend/tests/hq-flow.spec.ts) & [manager-flow.spec.ts](../../../frontend/tests/manager-flow.spec.ts)：新增并扩充 3 项返工专项回归测试，覆盖（1）缺少经审校内容停留在草稿 + 连续发布 39 元「桌面三格收纳盒」与 129 元「迷你折叠挂烫机」验证课件/规则/示范/问答互不串用且员工预览直接通关；（2）覆盖发布前 503 失败与写入后网络丢响应两段故障，确认重试沿用同一版本与同一幂等键恢复原批次且应训名单唯一；（3）控制两批次反序返回并覆盖旧请求延迟失败，验证当前批次名单、统计、错误态与详情跳转均不被污染。
- **返工提交**：`feat/t007-operations-ui` 分支提交 `5532abe`、`2092b38`。
- **自动化验证结果**：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**9 个测试文件、32 项测试全部通过**（`vitest run`）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
- **说明**：本次三项返工后尝试唤醒内置浏览器子智能体做额外 UI 复验时遇上游服务 SSE EOF 中断；三项问题的完整组件交互与状态恢复均已通过 Vitest 32/32 专项回归测试验证，提交 Codex 复验。

## Codex 复验（2026-11-24，`6ba22cb`）

复验未通过。T007 退回「进行中」，由 Antigravity App 返工。T008 继续排队。

- 独立复跑类型检查、9 个文件共 32 项 Vitest 测试、Mock 和 Real 构建，均通过。发布前失败和落库后丢响应沿用原版本、参数和幂等键恢复。额外在组件卸载并重新挂载后复测丢响应恢复，确认仅一次建课、原批次唯一且名单为 3 人。店长切换批次后，旧请求迟到成功或失败均未覆盖当前名单和详情入口。
- 浏览器实测总部 1280×800、员工 390×844。39 元收纳盒和 129 元挂烫机的顾客问法、换问法和金牌示范分别绑定本商品，前轮保温杯话术串用已修复。只填新品名称时，快捷发布拒绝提交，允许保存草稿。

### 返工项

1. **P1｜与售价共用数字的必考规格被丢弃。** 总部录入售价 `¥39.00` 和必考事实「透明亚克力材质，宽度 39 厘米」并发布。课件保留两条，评分规则与示范却遗漏宽度。员工完成学习后，只报价格和材质，在 Mock 正式对练中获得 99 分并被记为已通关。[评分规则生成](/Users/xiaoqi/dev/shouke/frontend/src/utils/courseRubric.ts:57)
   - 复验时核对每条必考事实是否出现在最终评分规则中。价格事实应按含义识别，售价数字不能吞掉同数值的规格。加入漏讲规格和完整复述的对照用例，核对正式成绩与任务状态。
2. **P2｜只有商品名的草稿可在课程工作台发布。** 组件测试复现仅填名称时快捷发布被拒，存草稿后进入课程工作台，无需补齐内容即可勾选三项、审校并发布。发布版本的价格为「以门店价签为准」，仅绑定基于商品名生成的占位评分规则。[课程工作台审校](/Users/xiaoqi/dev/shouke/frontend/src/views/hq/HqCourseWorkbenchView.vue:122)
   - 复验时从两个入口检查课程内容门槛，并确认草稿补齐后，课件和评分规则一致，才可审校发布。

真实后端和企微客户端验证仍归入 T008。

## Antigravity App 二次返工记录（2026-11-24，`e6b7ae3`）

针对 Codex 二次复验退回的 2 项问题已完成根因修复并补齐专项回归测试：

- **改动文件**：
  - [courseRubric.ts](../../../frontend/src/utils/courseRubric.ts)：
    1. **P1 售价同数字规格保留**：移除基于 `!s.includes(priceNum)` 的粗糙过滤，新增语义识别函数 `isPurePriceFact(label, priceNum)`，仅对纯售价表达（如「零售价 39 元」「¥39.00」）与 `fact_price` 去重；任何含相同数字的必考规格（如「宽度 39 厘米」）均保留为独立 `required_facts` 项，并通过 `buildGroupsForFactLabel` 拆分为中文字段、数字与单位同义词分组（支持厘米/cm、毫米/mm、毫升/ml、克/g、小时/h），同时将全部非价格必考事实完整写入 `demo_pitch`。
    2. **P2 统一内容与评分规则门槛**：新增并导出 `extractValidPriceNumber`、`validateQuickCourseInput` 与 `validateCourseVersionForReview`，统一校验有效数字零售价、章节标题与口播非空、非占位规则（非仅 `fact_product_core`）、存在 `type='price'` 必考项且与课件售价一致，以及 `demo_pitch` 包含当前售价。
  - [HqQuickPublishCard.vue](../../../frontend/src/components/HqQuickPublishCard.vue)：「存为待审校草稿」与「审校通过并发布」统一执行 `validateQuickCourseInput` 门槛，拦截缺项建草稿（防止后端一次性创建的 `rubric_versions` 永久绑定占位规则），移除 `'以门店价签为准'` 占位兜底。
  - [HqDraftEditor.vue](../../../frontend/src/components/HqDraftEditor.vue)、[HqReviewPublishPanel.vue](../../../frontend/src/components/HqReviewPublishPanel.vue)、[HqCourseWorkbenchView.vue](../../../frontend/src/views/hq/HqCourseWorkbenchView.vue)：工作台同步编辑器未保存状态（`dirtyChange`），审校前强制校验无未保存草稿且 `validateCourseVersionForReview` 零阻塞项，并在审校面板顶部实时渲染 `data-testid="hq-review-blockers"` 阻塞提示，不满足门槛时拦截审校且不发请求。
  - [hq-flow.spec.ts](../../../frontend/tests/hq-flow.spec.ts)：新增 2 项二次复验回归用例，覆盖（1）售价 39 元 + 必考规格「宽度 39 厘米」同时保留在评分规则与金牌示范，员工漏讲宽度被一票否决（`passed=false`、`status='failed'`），完整复述后通关（`passed=true`、`status='passed'`）；（2）工作台拦截缺项/占位规则草稿及课件售价与评分规则不一致（79 元改 99 元保存后被拦截，改回 79 元保存后放行）。
- **返工提交**：`feat/t007-operations-ui` 分支提交 `e6b7ae3`。
- **自动化验证结果**：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**9 个测试文件、34 项测试全部通过**（`vitest run`）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
- **说明**：本次复验已通过 Vitest 34/34 全量自动化回归与双模式构建验证，提交 Codex 复验。

## Codex 复验（2026-11-25，`e52d895`）

T007 复验未通过，退回「进行中」，由 Antigravity App 返工。T008 继续排队。

- 独立复跑类型检查、Vitest（9 个文件、34 项）、Mock 和 Real 构建，全部通过。
- 浏览器实测总部 PC（1280×800）和员工 H5（390×844）。售价 39 元与必考规格「宽度 39 厘米」均进入评分规则。正式对练漏讲宽度时 99 分未通关，讲对时 99 分通关。快捷入口拦截仅有商品名的存草稿和发布操作。工作台拦截旧的占位草稿，实际售价由 79 元改为 99 元时也会提示规则不一致。

### 返工项

1. **P1｜错误尺寸被判为命中必考规格。** 在上述收纳盒的对练中，员工报对价格、材质，但把宽度说成 139 厘米。Mock 正式对练仍返回 99 分并记为通关，评分面板将「宽度 39 厘米」列为命中。评分规则将数字 `39` 拆成独立条件，Mock 用子串匹配，因此 `139` 也命中。需加上错报、漏报与正确表达的对照回归，包含 `39 厘米` 和 `39 cm`。真实评分器的判定留待 T008 验证。[规格规则生成](../../../frontend/src/utils/courseRubric.ts#L74) · [Mock 规格匹配](../../../frontend/src/mock/scoring.ts#L81)
2. **P2｜规格文本可以充当售价通过两个入口。** 浏览器在快捷入口将零售价填为「39 厘米」，发布成功，课件保留「39 厘米」，评分却考核「39 元」。组件测试在工作台将 79 元保温杯的售价改为「79 毫升」，同样能通过审校和发布，原规则仍是「零售价 79 元」。两个入口都用提取文本中首个正数的方式校验金额。复验需同时验证两入口拒绝这类输入，并允许正确的金额格式通过。[售价校验](../../../frontend/src/utils/courseRubric.ts#L45)

## Antigravity App 三次返工记录（2026-11-25，`3279919`）

针对 Codex 复验 `e52d895` 退回的 2 项问题已完成根因修复并补齐专项回归测试：

- **改动文件**：
  - [scoring.ts](../../../frontend/src/mock/scoring.ts)：新增边界感知词元匹配函数 `matchBoundaryToken` 替换 `matchGroupsFact` 与维度关键词的纯子串 `includes` 匹配。对以数字开头/结尾的词元强制校验 `(?<![0-9.])` / `(?![0-9.])`，对以 ASCII 字母开头/结尾的词元强制校验 `(?<![a-z])` / `(?![a-z])`，杜绝 `139` / `390` / `39.5` / `16` 通过子串误命中 `39` 或 `6`。
  - [courseRubric.ts](../../../frontend/src/utils/courseRubric.ts)：
    1. **P1 数值与计量单位绑定分组**：更新 `buildGroupsForFactLabel`，将带数值与计量单位的必考规格（如「宽度 39 厘米」「容量 480ml」「30秒快速出汽」）绑定为「数值+单位」及其同义缩写组合条件组（如 `['39 厘米', '39厘米', '39 cm', '39cm']`），避免拆成独立数字 `['39']` 后在同一子句中被售价「39 元」与错误宽度「139 厘米」凑齐误命中。
    2. **P2 严格零售金额格式校验**：重写 `extractValidPriceNumber`，采用整串锚定的 `VALID_PRICE_RE`（兼容 NFKC 全角数字、货币前缀 `¥/￥/RMB/CNY`、中文金额后缀 `元/块/块钱`、可选价格标签前缀及最多两位小数，规范化如 `39.90` -> `39.9`），严格拒绝「39 厘米」「79 毫升」「39cm」「230克」「39-59元」「0」「以门店价签为准」等非金额文本；`isPurePriceFact` 直接复用该函数，并在 `validateCourseVersionForReview` 的金牌示范价格校验同步使用数字边界匹配。
  - [mock-scoring.spec.ts](../../../frontend/tests/mock-scoring.spec.ts) & [hq-flow.spec.ts](../../../frontend/tests/hq-flow.spec.ts)：
    1. 新增规格数字边界专项回归：验证端盒 16 个不命中 6，错报 `139 厘米` / `139cm` / `390 厘米` / `39.5 厘米` 及同句含「39 元 + 宽度 139 厘米」均判定 `missed` 且 `failed`，漏报规格判定 `failed`，正确表达 `39 厘米` / `39厘米` / `39 cm` / `39cm` 精准命中并通关。
    2. 新增双入口售价格式回归：验证快捷入口填入「39 厘米」时存草稿与发布均拦截、改填「39 元」后正常发布；验证课程工作台将 79 元保温杯售价改为「79 毫升」保存后审校被拦截、改回「79 元」保存后顺利审校通过。
- **返工提交**：`feat/t007-operations-ui` 分支提交 `3279919`。
- **自动化验证结果**：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**9 个测试文件、36 项测试全部通过**（`vitest run`）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
- **说明**：本次复验已通过 Vitest 36/36 全量自动化回归与双模式构建验证，提交 Codex 复验。

## Codex 复验（2026-11-25，`61297bc`）

T007 复验未通过，退回「进行中」，由 Antigravity App 返工。T008 继续排队。

- 独立复跑类型检查、Vitest（9 个文件、36 项）、Mock 和 Real 构建，全部通过。店长补训与复查路径通过组件集成测试。
- 总部 PC（1280×800）浏览器实测通过。快捷入口拦截仅填商品名，以及用「39 厘米」作售价的存草稿和直接发布。改填「39 元」后发布成功。工作台保存「79 毫升」后拦截审校并禁用发布按钮，改回「79 元」后可审校发布。
- 员工 H5（390×844）浏览器实测。售价 39 元与必考「宽度 39 厘米」同时绑定课程。漏讲宽度、单独错报「139 厘米」以及同句说「售价 39 元且宽度 139 厘米」均为 99 分未通关，并标记缺失宽度。正确说出「宽度 39 厘米」或「宽度 39 cm」均通关。

### 返工项

**P1｜同句不同规格字段的数值仍可串用。** 在同一课程，报对价格和材质后说「宽度为 139 厘米和高度为 39 厘米」，Mock 正式对练保存为 99 分已通关。将两项拆成「宽度为 139 厘米。高度为 39 厘米。」后得到 99 分未通关，缺失项为「宽度 39 厘米」。对照组「宽度为 39 厘米和高度为 139 厘米」正常通关。规格规则已绑定数值与单位，但规格字段与数值单位仍是两个独立条件组，同一子句分别命中即可通过。复验需确认错误和正确尺寸的对照结果不受同句或分句影响，并保留中文单位及缩写的既有回归。真实后端评分验收归入 T008。[规格规则生成](../../../frontend/src/utils/courseRubric.ts#L99) · [Mock 规格匹配](../../../frontend/src/mock/scoring.ts#L99)

## Antigravity App 四次返工记录（2026-11-25，`60070ad`）

针对 Codex 复验 `61297bc` 退回的 P1 问题已完成根因修复并补齐对照回归测试：

- **改动文件**：
  - [scoring.ts](../../../frontend/src/mock/scoring.ts)：在 `matchGroupsFact` 中引入全匹配跨度枚举（`findBoundaryTokenSpans`）与字段-测量值直接对应校验（`isBoundFieldMeasurement`）。当规则中出现相邻的「文本字段组 + 测量值组」（如 `['宽度']` 与 `['39 厘米', '39厘米', '39 cm', '39cm']`）时，同一子句内必须存在直接绑定的字段与测量值对：
    - 正向表达仅允许常见系词/约数/标点连接（如「宽度 39 厘米」「宽度为 39 厘米」「宽度约 39 cm」「宽度：39cm」），拒绝跨数字、跨并列连词或否定语境的串用（如「宽度为 139 厘米和高度为 39 厘米」「宽度 139 厘米、高度 39 厘米」「宽度不是 39 厘米而是 139 厘米」）。
    - 倒装表达（如「39 厘米的宽度」）额外排除测量值前已有其他字段赋值或字段后自带其他数值的情况（如「高度 39 厘米宽度 139 厘米」）。
  - [mock-scoring.spec.ts](../../../frontend/tests/mock-scoring.spec.ts) & [hq-flow.spec.ts](../../../frontend/tests/hq-flow.spec.ts)：扩充同句与分句错报及正确表达对照回归，确认「宽度为 139 厘米和高度为 39 厘米」「宽度 139 厘米、高度 39 厘米」「高度为 39 厘米和宽度为 139 厘米」「高度 39 厘米宽度 139 厘米」「宽度为 139 cm 和高度为 39 cm」「宽度为 139 厘米。高度为 39 厘米。」均判定未命中且未通关（`passed=false`、`status='failed'`），而「宽度为 39 厘米和高度为 139 厘米」「高度为 139 厘米和宽度为 39 厘米」「宽度为 39 cm 和高度为 139 cm」「宽度 39 cm」「宽度 39 厘米」均精准命中并通关（`passed=true`、`status='passed'`）。
- **返工提交**：`feat/t007-operations-ui` 分支提交 `60070ad`。
- **自动化验证结果**：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**9 个测试文件、36 项测试全部通过**（`vitest run`）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
- **说明**：本次复验已通过 Vitest 36/36 全量自动化回归与双模式构建验证，提交 Codex 复验。
