# T006 Vue 公共入口与员工 H5

仅 Antigravity App 可领取和实现。前置任务为 T001。 [任务看板](../board.md)

## 目标与范围

建立 `frontend/` 的 Vue 项目、服务端会话入口、公共布局和 API 层，维护员工界面及其测试。参考静态员工首页、学习和实战对练交互，根据接口契约提供开发 Mock。预留总部和店长页面的路由扩展入口并交接给 T007。查阅 `vue-best-practices`。 [项目 Skills](../../../.agents/skills/README.md) · [原型入口](../../../static/index.html)

## 交付与验收

- [x] 交付可启动、可构建的 Vue 项目，提供前端运行说明及角色路由约定。员工首页从服务端会话和任务状态渲染，支持待学习、续学、待对练、未通关和完成态。
- [x] 可从课程进入文字对练，从已保存轮次继续训练，查看命中和漏讲证据及补训动作。具备加载失败、重复提交和状态冲突的反馈。
- [x] 使用移动视口验证完整员工路径及刷新恢复。Mock 与真实 API 模式使用一致的契约，记录切换办法并交接给 T007、T008。

## 交付记录

- 认领：2026-11-23，Antigravity App，`feat/t006-employee-h5`（基于 `qoder@3f1057c`）。
- 变更文件：
  - `frontend/package.json`、`tsconfig*.json`、`vite.config.ts`、`vitest.config.ts`、`.env.example`、`index.html`、`env.d.ts`、`README.md`：Vue 3 + TypeScript + Vite 6 + Vue Router 4 + Vitest 工程脚手架、`/api` 同域代理与运行交接文档。
  - `frontend/src/types/api.ts`：M1 v1.0 契约全量 `snake_case` 类型定义（auth / staff）。
  - `frontend/src/api/client.ts`、`auth.ts`、`staff.ts`：统一 HTTP 客户端（自动为写请求附加 `Content-Type: application/json`、同源凭证、`ApiErrorEnvelope` 解包、401 自动失效跳转、`VITE_API_MODE=mock|real` 分发）。
  - `frontend/src/mock/seed.ts`、`scoring.ts`、`server.ts`：M1 附录 A 种子数据、与后端 `roleplay_scoring.py` 一致的评分引擎、持久化 Mock 服务端（含幂等、跨店 404、`409 CHAPTERS_INCOMPLETE`、故障注入与同键恢复）。
  - `frontend/src/composables/useSession.ts`、`useToast.ts`、`src/utils/assignment.ts`：服务端 `/api/v1/me` 会话恢复与状态展示映射。
  - `frontend/src/router/index.ts`、`hqRoutes.ts`、`managerRoutes.ts`：角色路由守卫与 T007 扩展入口。
  - `frontend/src/components/AppShellMobile.vue`、`AppShellDesktop.vue`、`ProductIcon.vue`、`CustomerAvatar.vue`、`RadarChart.vue`、`ScoreResultCard.vue`：移动端/PC 端公共布局壳、顾客虚拟头像与四维雷达评分卡。
  - `frontend/src/views/LoginView.vue`、`staff/StaffHomeView.vue`、`staff/StaffCourseView.vue`、`staff/StaffRoleplayView.vue`、`stubs/HqEntryStubView.vue`、`stubs/ManagerEntryStubView.vue`：1:1 复刻 `static/` 原型视觉与交互（沉浸式 MINISO 引导与 3D 角色轮播登录、员工首页九态任务卡与三栏 KPI、渐进式课程章节学习、文字对练与四维复盘/历史轮次恢复）。
  - `frontend/tests/*.spec.ts`：5 个测试文件共 17 项 Vitest 自动化测试。
- 提交 / PR：交付代码已提交至 `feat/t006-employee-h5` 分支（`docs/development/board.md` 因工作区含 Codex 同步状态变更暂留工作区未混入本分支提交，见下方 commit hash）。
- 验证命令与结果：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**17 passed**（5 个测试文件：`mock-scoring.spec.ts` 精确验证 M1 §8.5 四样本 99/91/99未过/69红线与价格否定防护；`mock-server.spec.ts` 验证 401/403/404 隔离、409 未学完、预览不落库、503 失败同键恢复与补训推进；`router-guard.spec.ts` 验证未登录重定向、刷新恢复与角色路由隔离；`http-client.spec.ts` 验证真实请求头与错误解析；`staff-flow.spec.ts` 覆盖员工完整流转与刷新恢复）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
  - 内置浏览器移动视口（390×844）实测 `http://localhost:5173/`（Mock 模式，于末行 `LoginView.vue` `backdrop-filter: none` 样式微调前完成）：9 步全闭环通过，零控制台报错，覆盖佛山周琳空任务隔离、林小美 0/3→3/3 学习、409 未学完拦截与演示试听、503 故障注入与同 `client_round_id` 重试得 91 分、页面刷新恢复轮次、陈阿杰补训一票否决与改正推进至「已改正待复查」、店长/总部 `/manager` 与 `/hq` 占位入口。末行 CSS 微调后已重跑全量 `typecheck`、`test` 与双模式构建全部通过。
- 尚未验证项 / 交接说明：
  - 真实后端 API（FastAPI + MySQL）在线联调留待 T008（因 T005 尚未认领且本地后端未在本轮启动）；真实模式请求构造与错误解析已通过 `http-client.spec.ts` 与 `build:real` 验证。
  - `VITE_API_MODE=mock|real` 切换方法、同域代理及 T007 路由/API 接入指引见 [frontend/README.md](../../../frontend/README.md)。
- Codex 验收结论：待验收。

## Codex 验收（2026-11-23，`18681df`）

**退回 Antigravity App 返工。** T007 继续等待 T006 复验。

- 独立复跑 `npm run typecheck`、`npm test`（5 个文件、17 项通过）、`npm run build`、`npm run build:real`。
- 在 Chromium 390×844 视口中，Mock 与 Real 均通过员工登录、任务读取、未学完拦截、1/3 节刷新续学、3/3 后正式评分和刷新恢复。相同话术均得 92 分，刷新后各保留一条正式轮次。Mock 503 后用原轮次键重试，漏讲用例显示「端盒 6 个不重复」。Real 使用交付提交内的 FastAPI 和独立临时 SQLite 数据库。MySQL 与完整三角色联调纳入 T008。

1. **[P1] 对练预览串用其他商品的话术。** 在 Real 模式发布并打开售价 79 元、拥有独立顾客问法和示范的保温杯课程。未学完进入对练时，顾客仍问 59 元盲盒。空白提交「演示试听」会把 Chiikawa 示范填入输入框。输入提示和结果回应也引用 Chiikawa 文案。修复后，用两个商品或同一商品的两个版本复验，确保顾客问题、输入提示、示范和结果回应都与当前任务绑定的版本一致。契约没有提供相应内容的场景，应使用通用提示，或先协调补齐契约。 [提问回退](../../../frontend/src/views/staff/StaffRoleplayView.vue#L93) · [试听默认文案](../../../frontend/src/views/staff/StaffRoleplayView.vue#L433)
2. **[P2] 评分失败刷新后丢失改写入口。** 在 Mock 下触发 503 并刷新，历史仍允许用原轮次键重试，但输入框锁定，原来的「改写为新一轮」入口消失。修复后，刷新仍应显示失败原因和两种动作。原轮重试沿用原键及原请求体，改写生成新轮次键。 [草稿恢复](../../../frontend/src/views/staff/StaffRoleplayView.vue#L183) · [输入区和恢复动作](../../../frontend/src/views/staff/StaffRoleplayView.vue#L688)

复验时同时为对练输入框补上可访问标签。当前只有占位提示。 [输入框](../../../frontend/src/views/staff/StaffRoleplayView.vue#L688)

## Antigravity App 返工记录（2026-11-23）

- **改动文件**：
  - [StaffRoleplayView.vue](../../../frontend/src/views/staff/StaffRoleplayView.vue)：
    1. 移除硬编码 `CHIIKAWA_RUBRIC` 兜底依赖；仅在 Mock 模式且当前绑定版本为 `crv_chiikawa_v1` 时展示原型快捷示例按钮（`M1_SAMPLE_INPUTS`）。未解锁场景或契约未提供问法时，顾客角色回退为通用「门店虚拟顾客」，引导语、价格展示（缺失回退为 `—`）、输入框动态 `placeholder` 与试听简短反馈均严格绑定当前 `course_version` 的商品名称、售价与章节知识，并在 `assignmentId` 路由切换时重置页面状态防止跨商品残留。
    2. 「演示试听」空白点击不再自动填入任何话术也不触发请求（聚焦输入框并 Toast 提示）；提供「填入本课课件话术」（提取当前绑定课程章节卖点与售价）及仅在接口返回当前版本 `demo_pitch` 时可用的示范填入能力。
    3. 为对练输入框补充显式可访问标签 `<label for="roleplay-answer-input">导购应答话术（商品名 · 售价）</label>`。
    4. 持久化 `submit_error`、`submit_error_code`、`submit_error_request_id` 与 `retry_after_seconds` 至按用户+任务+轮次隔离的 `localStorage` 草稿，在加载和 `rounds` 对账恢复（`reconcileDraftWithRounds`）后保留错误横幅与禁用态说明，并始终同时展示「用原轮次键重试」与「改写为新一轮」双恢复动作。
  - [staff-flow.spec.ts](../../../frontend/tests/staff-flow.spec.ts)：更新步骤 4 断言（先校验空白「演示试听」不注入话术、不发送请求，再显式触发本课课件话术填入）。
  - [roleplay-regressions.spec.ts](../../../frontend/tests/roleplay-regressions.spec.ts)：新增 2 项返工专项回归测试，分别覆盖 79 元保温杯 `409` 未学完/升级 89 元 v2 跨商品跨版本话术与标签隔离，以及 Mock 503 刷新后同时保留错误原因、原轮重发与改写解锁（`client_round_id` 变更）路径。
- **返工代码提交**：`feat/t006-employee-h5` 分支提交 `908fc80`。
- **自动化验证命令与结果**：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**6 个测试文件、19 项测试全部通过**（`vitest run`）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
- **内置浏览器实测回归（390×844 移动端视口）**：
  - **Mock 模式**（`http://localhost:5173/`）：验证空白「演示试听」拦截、`label[for="roleplay-answer-input"]` 可访问标签、触发 `503` 后刷新页面仍保留错误原因、`disabled` 输入框锁定、原轮次键重试及「改写为新一轮」双入口；点击改写后解锁输入并生成新 `client_round_id` 提交第 2 轮通过（91 分），原第 1 轮失败历史仍保留；全程零 Console 错误。
  - **Real API 模式**（基于 `frontend/dist` + 内存 SQLite 初始化 FastAPI 同域服务 `http://localhost:5174/`，发布 79 元「名创便携保温杯」与 59 元「Chiikawa 联名毛绒公仔盲盒」至 `store_bj`）：验证 79 元保温杯在未完成章节（`409 CHAPTERS_INCOMPLETE`）下显示 `¥79.00`、`门店虚拟顾客`、不含 Chiikawa/59/盲盒的通用引导与动态 `<label>`/`placeholder`；空白试听不填词不出卡；点「填入本课课件话术」与「演示试听」仅围绕 79 元保温杯返回（`POST .../roleplay-preview` 200）；补齐章节后进入正式对练显示「通勤白领 · 阿晨」与保温杯两句顾客问法，正式提交（HTTP 201，84 分）并刷新恢复 `saved-round-1`；切回 `/staff` 再进入 59 元 Chiikawa 盲盒未学完对练页，价格/标签/占位提示即时切换为 `¥59.00` 且零残留前商品文案；全程零 Console 错误，除登录前 `/api/v1/me` 401 探测及未学完预期的两次 `409` 外无异常 HTTP 状态码。
- **交付状态**：返工完成，提交验收。
