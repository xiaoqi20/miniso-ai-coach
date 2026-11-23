# T002 后端、数据库及会话底座

前置任务为 T001。 [任务看板](../board.md)

## 目标与范围

建立 `backend/` 的 FastAPI 应用入口、配置、数据库会话、首批迁移及公共鉴权。按已审接口契约准备两家门店、三个角色、一款新品的开发数据。后续业务卡负责各自的业务路由和测试，与本卡交接路由注册方式及迁移基线。涉及新增迁移时，在看板登记衔接顺序。

开始实现时查阅 `fastapi`、`sqlalchemy`、`alembic`、`mysql-patterns`。 [项目 Skills](../../../.agents/skills/README.md)

## 交付与验收

- [x] 提供本地启动、MySQL 初始化和迁移说明。从空库应用迁移后，可载入可重复使用的开发数据。
- [x] 实现服务端会话和角色、门店范围校验，提供当前用户接口。匿名访问、篡改客户端身份字段和访问未授权门店均被拒绝。
- [x] 按契约建立课程版本、发布名单、学习、对练轮次、成绩、补训和审计所需的表及约束。开发登录和测试数据装载须经开发配置启用。
- [x] 给出业务卡可复用的测试接入方法及路由扩展约定。运行迁移与鉴权验证并记录结果。

## 交付记录

- 认领：2026-11-23，QoderCN，`qoder`（工作区改动未提交）；状态先登记「进行中」。
- 变更文件：
  - `backend/`（新增）：`pyproject.toml`、`app/`、`alembic.ini`、`alembic/`、`scripts/mysql_dev.sh`、`tests/`、`README.md`、`.env.example`、`.gitignore`
  - `docs/development/board.md`（认领与状态登记）
  - `docs/development/tasks/T002-backend-foundation.md`（本交付记录）
- 提交 / PR：已提交到 `qoder` 分支（与 M1 文档同批）；原型重构、AGENTS/PRD、skills 和 static 改动未包含。
- 验证命令与结果：
  - `cd backend && uv sync`：Python 3.13.15 环境安装成功。
  - `uv run pytest`：20 passed，覆盖登录、匿名、篡改身份、过期/撤销会话、Origin、角色和门店范围、种子幂等、17 张业务表注册、审计动作按契约值存储。
  - `uv run python -m compileall -q app tests`：通过。
  - MySQL 8.0.46（本机 Docker，127.0.0.1:3307）：`uv run alembic upgrade head` 成功；`alembic check` 返回「No new upgrade operations detected」；`alembic downgrade base` 后再 `upgrade head` 成功；`python -m app.seed` 连续两次均返回 stores=2、users=9、memberships=7、courses=1、course_versions=1、rubric_versions=1。
  - `SHOW CREATE TABLE retrains`：`open_flag` 为 STORED 生成列，`uq_retrains_assignment_open (assignment_id, open_flag)` 存在；`users.role` 为原生 ENUM。
  - `uvicorn app.main:app` 真实 HTTP 冒烟：`/healthz` 200；匿名 `/api/v1/me` 401；员工 dev-login 200；带 Cookie 的 `/api/v1/me` 200。
  - 在 MySQL 上验证员工、店长、总部三种会话及能力列表；请求体夹带 `role` 返回 422 `VALIDATION_ERROR`。
- 尚未验证 / 环境限制：
  - 本机 MySQL 8.4.8 在自定义 datadir 启动时报 `Can't create UNDO tablespace ... undo_001 already exists`，且 Docker Hub `mysql:8.4` 拉取被网络阻断；本次真实验证使用本机已有的 MySQL 8.0.46 镜像。迁移、ENUM、生成列和 JSON 均按 MySQL 8.4 LTS 兼容方式编写，待可用 8.4 实例后重跑 `upgrade head`、`alembic check` 和种子。
  - 企微身份映射、语音、SSE 和区域经理不在 M1/T002 范围。
  - 前端 T006 未改动；按规范由 Antigravity App 领取。

## Codex 验收 · 2026-11-23

验收基线为 `qoder` 的 `4decdbd`。**本轮未通过，退回 QoderCN 返工。** T003、T004、T005 依赖公共鉴权和事务边界，继续排队，待 T002 复验通过后解锁。

### 独立复验结果

- 锁定依赖环境复跑 `pytest`，20 项全部通过，覆盖匿名、过期和撤销会话、身份字段校验、角色、门店隔离及生产配置。
- 使用官方 `mysql:8.4` 镜像启动一次性实例，`SELECT VERSION()` 返回 **8.4.13**。从空库执行 `upgrade head`、`alembic check`、`downgrade base`、再次 `upgrade head` 成功。核对了 17 张 InnoDB 业务表及 `alembic_version`。`alembic check` 对 `retrains.open_flag` 给出生成列表达式比对警告，另查表结构确认了 STORED 表达式及 `(assignment_id, open_flag)` 唯一索引。验收实例已关闭。
- 连续两次执行种子，均得到 2 家门店、9 个用户、7 条成员关系、1 款草稿课程及其规则版本，发布批次和应训名单均为 0。种子的商品、章节和评分规则内容与 M1 §6.5.2 JSON 一致。
- 实际启动 API 并接入 MySQL 8.4.13，核对三角色登录及 `/me`、服务端会话哈希、登出后会话失效、错误响应的请求 ID、Origin 拒绝和生产环境种子脚本拒绝执行。
- 本机原生 MySQL 8.4.8 在独立空目录初始化时仍失败，本轮记录为 `SIGSEGV`。本机 Docker 官方镜像已补齐目标数据库版本的验收证据。

### 返工与复验条件

| 优先级 | 发现与影响 | 复验条件 |
| --- | --- | --- |
| P1 | 门店鉴权只过滤 `membership.active`。临时挂载店长测试路由后，停用北京路门店，已有店长会话仍可访问该店且 `/me` 仍列出。给该店长增加一条佛山店的有效 `staff` 成员关系后，复用 `require_roles` 与 `ensure_store_access` 的店长路由对佛山店返回 200。见 [auth.py](../../../backend/app/services/auth.py#L74) 和 [deps.py](../../../backend/app/api/deps.py#L70)。 | 过滤停用门店和角色不一致的成员关系，补用例验证 `/me` 的门店范围与店长路由一致，越界返回 `404 NOT_FOUND`。 |
| P2 | 鉴权查询和业务路由复用同一 `DbDep`。将 `CurrentUserDep` 与 `DbDep` 同时注入测试写路由后，路由入口的 `session.in_transaction()` 为 `True`，显式 `session.begin()` 抛出 `A transaction is already begun on this Session`。T004 若在保留该事务时调用模型，会跨模型等待持有数据库事务。见 [deps.py](../../../backend/app/api/deps.py#L30)。 | 明确并实现公共依赖的事务边界。用临时路由模拟外部模型等待，验证鉴权后可开启独立短写事务，等待期间没有持有数据库事务。更新 T003–T005 的接入说明。 |
| P2 | Alembic 将连接串直接交给配置插值。对带百分号编码的有效 URL 执行 `alembic upgrade head --sql`，报告 `invalid interpolation syntax`，在线迁移也经过同一初始化路径。见 [env.py](../../../backend/alembic/env.py#L22)。 | 使用含 URL 编码字符的临时凭据复验 Alembic，确认连接串能正确传递并完成迁移。 |
| P2 | M1 §3.5 要求所有写请求使用 JSON，HTTPS 下会话 Cookie 必须有 `Secure`。用 `text/plain` 调用登出仍返回 204。以 `COOKIE_SECURE=false` 运行开发环境时，HTTPS 开发登录下发的 Cookie 缺少 `Secure`。见 [main.py](../../../backend/app/main.py#L57)、[auth.py](../../../backend/app/api/routers/auth.py#L53) 和 [security.py](../../../backend/app/security.py#L25)。 | 统一校验写请求的媒体类型，补齐登出和其他无正文写操作的测试及调用说明。补验 HTTPS 开发登录和生产环境 Cookie 行为。 |

迁移复查时一并核对 M1 §4.2 的字段口径。目前实现使用较宽的部分 ID、哈希、分数字段类型，并已将未来的 `voice` 写入 `answer_source` 枚举。请在交接里记录有意采用的差异，让 T003–T005 的接口校验与数据库基线一致。

## 返工记录 · 2026-11-23（QoderCN）

已按上表完成四项返工，改动基于 `4decdbd`：

| 项 | 修正 | 验证 |
| --- | --- | --- |
| P1 门店越权 | `active_memberships` 同时过滤停用成员关系、停用门店，以及与 `users.role` 不一致的成员关系；`/me` 和门店路由共用同一过滤结果。 | 新增「停用门店」和「店长挂 staff 成员关系」用例：`/me` 不再列出，店长组合路由返回 `404 NOT_FOUND`。 |
| P2 事务边界 | `get_current_user` 和 `require_store_access` 在返回前提交并结束只读事务；`DbDep` 进入业务路由时 `in_transaction()` 为 `False`。 | 临时路由验证入口无事务、可显式开启短写事务，且在模拟外部模型等待期间不持有事务。 |
| P2 迁移 URL | `alembic/env.py` 在交给 ConfigParser 前把连接串中的 `%` 转义为 `%%`。 | 离线 `alembic upgrade head --sql` 使用 `p%40ss` 连接串通过；临时 MySQL 8.0 库启用密码 `p@ss`、URL 使用 `p%40ss`，在线 `upgrade head`、`alembic check` 和 aiomysql 种子均成功。 |
| P2 传输约定 | 中间件统一要求 `POST`/`PUT`/`PATCH`/`DELETE` 携带 `Content-Type: application/json`，无正文写操作同样校验；Cookie `Secure` 按实际 HTTPS 或 `X-Forwarded-Proto` 补齐，生产配置强制。 | 覆盖四种写方法、`text/plain` 登出、HTTPS 开发登录/登出 `Secure`，以及生产环境 HTTP 请求仍强制 `Secure`。 |

验证结果：

- `uv run pytest`：**32 passed**（原 20 项 + 新增 12 项）。
- `uv run python -m compileall -q app tests`：通过。
- 在线迁移临时库表数：17 张业务表 + `alembic_version`；`alembic check` 返回「No new upgrade operations detected」，仅保留 `retrains.open_flag` 生成列表达式警告。
- 本机原生 MySQL 8.4.8 仍无法启动；Codex 已用 `mysql:8.4`（8.4.13）验证迁移基线，本次改动不涉及 DDL。
- 字段口径差异已写入 [backend/README.md](../../../backend/README.md) 的「与 M1 §4.2 的有意字段差异」，T003–T005 按该表校验。
- 提交状态：本次返工已提交到 `qoder` 分支，等待 Codex 按最新提交复验。

## Codex 返工复验 · 2026-11-23

**复验通过。** 验收提交为 `3bc9489`，本地 `qoder` 与 `origin/qoder` 均指向该提交。T002 标为「已完成」，T003、T004、T005 转为「待领取」。

- **门店范围。** 在 MySQL 8.4.13 的临时验收应用中，停用门店后已有店长会话的 `/me` 移除了该店，店长路由返回 `404 NOT_FOUND`。给店长加入角色为 `staff` 的其他门店成员关系后，该店也未出现在 `/me`，访问该店的店长路由仍返回 `404 NOT_FOUND`。
- **事务边界。** 员工、店长和总部共用的鉴权依赖完成后，业务会话无活动事务。使用接入 MySQL 的临时路由复测了店长和总部的门店依赖、事务外模拟等待及随后开启短写事务，确认审计记录实际落库。
- **迁移连接串。** 使用需 URL 百分号编码的临时凭据，在 MySQL 8.4.13 验证离线 SQL 生成、空库 `upgrade head`、`alembic check`、`downgrade base` 及再次升级。确认 17 张 InnoDB 业务表、补训生成列唯一索引和连续两次种子加载。`alembic check` 仍提示生成列表达式比较需人工核对，已查表确认表达式和索引。
- **传输约定。** 复跑四种写方法的 JSON 媒体类型校验、HTTPS 下的开发登录和登出 Cookie、生产强制 `Secure` 及生产路由隔离用例。真实 HTTP 复测了三角色会话、非 JSON 登出被拒且会话仍有效，以及正确登出后的撤销。
- **独立回归。** 在锁定依赖环境复跑 32 项测试，全部通过，`compileall` 通过。用例和隔离实例均在本地运行，实例已关闭。实际部署的代理转发配置留待部署联调验证。
