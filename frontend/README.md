# MINISO 门店培训 · M1 前端工程（Vue 3 + TypeScript + Vite）

本目录为 T006 交付的 Vue 3 公共前端入口与员工 H5，同时为 T007（总部 PC 与店长 H5）及 T008（三角色端到端闭环验收）预留公共布局、会话管理、API 客户端和路由模块。

## 技术栈

- Vue 3（`<script setup lang="ts">` + Composition API）
- TypeScript + `vue-tsc`
- Vue Router 4
- Vite 6（同域 `/api` 代理到 FastAPI）
- Vitest + `@vue/test-utils` + `happy-dom`

## 快速启动与构建

```bash
cd frontend
npm install

# 1. Mock 模式启动（默认，无需启动后端与 MySQL，使用 M1 契约内嵌规则和四样本评分引擎）
npm run dev

# 2. 真实后端联调模式启动（需先按 backend/README.md 启动 FastAPI 127.0.0.1:8000）
npm run dev:real

# 3. 运行类型检查、单元测试与生产构建
npm run typecheck
npm test
npm run build
```

## Mock 与真实 API 切换办法（交接 T007 / T008）

通过环境变量 `VITE_API_MODE` 控制（定义于 `src/api/client.ts`）：

| `VITE_API_MODE` | 行为 | 适用场景 |
| --- | --- | --- |
| `mock`（未设置时的默认值） | 所有请求由 `src/mock/server.ts` 与 `src/mock/scoring.ts` 按 M1 v1.0 契约处理，状态持久化于浏览器 `localStorage` | T006/T007 前端独立开发、四样本校验、故障恢复演示 |
| `real` | 所有请求发往同域 `/api/v1/*`，携带 `sk_session` HttpOnly Cookie，写请求自动附带 `Content-Type: application/json` | 本地联调 FastAPI（`npm run dev:real`）及 T008 三角色端到端构建（`npm run build:real`） |

在本地开发联调 `real` 模式时，`vite.config.ts` 已配置 `/api` 与 `/healthz` 反向代理至 `VITE_API_PROXY_TARGET`（默认 `http://127.0.0.1:8000`，`changeOrigin: false` 以保留 `http://localhost:5173` 同源 Origin，与 `backend/app/config.py` 中的 `APP_ORIGINS` 默认值匹配）。也可复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
# 确保包含：
# VITE_API_MODE=real
```

## 角色路由约定与 T007 扩展入口

路由统一由 `src/router/index.ts` 管理，`beforeEach` 守卫首次启动会自动请求 `GET /api/v1/me` 恢复服务端会话，并按 `RouteMeta.roles` 强制角色隔离：

| 路径前缀 | 允许角色 | 布局模式 (`meta.layout`) | 定义模块 | 负责任务 |
| --- | --- | --- | --- | --- |
| `/login` | 公开（开发身份入口） | `auth`（移动壳） | `src/router/index.ts` | T006 |
| `/staff`, `/staff/assignments/:assignmentId`, `/staff/assignments/:assignmentId/roleplay` | `staff` | `mobile` | `src/router/index.ts` | T006 |
| `/manager`, `/manager/assignments/:assignmentId` | `store_manager` | `mobile` | `src/router/managerRoutes.ts` | T007 |
| `/hq`, `/hq/courses/:courseId`, `/hq/releases/:releaseId` | `hq_ops` | `desktop` | `src/router/hqRoutes.ts` | T007 |

### T008 联调交接说明

1. **三角色同契约接口**：`src/api/auth.ts`、`src/api/staff.ts`、`src/api/hq.ts`、`src/api/manager.ts` 全部通过 `executeApi` 分发 `mock` / `real` 模式，与 `src/types/api.ts` 共用 `snake_case` 契约。写请求自动携带 `Content-Type: application/json`，发布、补训、复查接口通过 `Idempotency-Key` 幂等保护并识别 `Idempotent-Replay: true`。
2. **Real 模式降级兼容**：在 T005 统计接口上线前，`/hq/releases/:releaseId` 若遇 `GET /hq/releases/{id}/stats` 返回 404，会自动降级展示 `GET /hq/releases/{id}` 的实时摘要而不阻断查看。
3. **联调运行**：启动后端 FastAPI（`127.0.0.1:8000`）后，执行 `npm run dev:real` 或 `npm run build:real` 即可在同域 `/api/v1/*` 下完整联调审校发布、学习、对练、补训、复查与 48 小时统计闭环。

## H5 视口与企业微信端预留说明

- 移动端页面（`/login`、`/staff/*`、`/manager/*`）已去除模拟手机黑框与虚拟 `09:41` 状态栏，统一采用标准全屏流式 H5 容器（`100dvh` + `env(safe-area-inset-*)` 安全区；桌面浏览器预览时居中 `max-width: 430px` 轻边展示）。
- [src/utils/runtime.ts](src/utils/runtime.ts) 预留了 `detectClientRuntime()`（自动识别 `h5` / `wxwork` 企业微信 WebView）、`data-client-runtime` 根节点属性、以及 `VITE_WECOM_AUTH_ENABLED` / `buildWeComAuthorizePath()` 网页授权切换入口，供 M2 接入企业微信工作台时复用现有全部业务页面与 `sk_session` 会话体系。
