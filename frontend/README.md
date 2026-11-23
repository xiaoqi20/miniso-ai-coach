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
| `/manager` 及后续子路由 | `store_manager` | `mobile` | `src/router/managerRoutes.ts` | T007 |
| `/hq` 及后续子路由 | `hq_ops` | `desktop` | `src/router/hqRoutes.ts` | T007 |

### T007 接入指引

1. 在 `src/api/` 新增 `hq.ts`、`manager.ts`，直接复用 `src/api/client.ts` 的 `executeApi` 与 `httpRequest`（已内置 `Content-Type: application/json`、统一 `ApiClientError` 解包、401 自动失效跳转）。需要幂等键的发布、补训、复查接口通过 `headers: { 'Idempotency-Key': createClientUuid() }` 传入。
2. 在 `src/types/api.ts` 追加总部与店长契约接口类型（保持 `snake_case`）。
3. 替换 `src/router/hqRoutes.ts` 与 `src/router/managerRoutes.ts` 中的占位组件，可复用 `src/components/AppShellDesktop.vue`（总部 PC 壳）与 `src/components/AppShellMobile.vue`（店长 H5 壳）。
4. 使用 `useSession()` 获取当前服务端身份与 `capabilities`，禁止通过 URL 查询参数或前端变量切换角色。
