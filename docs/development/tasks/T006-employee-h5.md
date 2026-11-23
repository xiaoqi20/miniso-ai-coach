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
