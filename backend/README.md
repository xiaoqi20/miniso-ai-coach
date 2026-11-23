# MINISO 门店培训 · M1 后端底座

本目录包含 T002 的 FastAPI/MySQL/会话底座，以及 T003 的课程审校发布与员工学习接口。T004/T005 在此基础上实现对练评分和店长补训复查。

## 技术栈与范围

- Python 3.13、FastAPI、Pydantic 2
- SQLAlchemy 2.x、`aiomysql` 运行时连接、`pymysql` 迁移连接
- MySQL 8.4 LTS（本地验证环境如只有 8.0 也可运行本套 SQL）
- Alembic 迁移；SQLite 仅用于单元测试的快速启动，不作为正式数据库

M1 不包含企微登录、语音识别、SSE 流式回复和区域经理接口。开发登录只在 `APP_ENV=development` 时注册。

## 目录

```text
backend/
  app/
    main.py                 # create_app、错误处理、请求 ID、Origin 校验
    config.py               # 环境配置与生产环境硬约束
    db.py                   # AsyncEngine / AsyncSession
    errors.py               # 统一错误 envelope
    security.py             # 会话令牌、Cookie、UTC 格式化
    models/                 # 17 张业务表（另含 alembic_version）
    schemas/                # API 请求/响应
    schemas/course.py       # 课程、评分规则、审校与发布请求
    schemas/learning.py     # 员工章节完成请求
    services/auth.py        # 会话解析、当前用户
    services/courses.py     # 课程、版本、审校、发布与批次读模型
    services/learning.py    # 员工任务、章节进度与状态派生
    services/idempotency.py # 发布幂等键
    services/common.py      # 游标、时间/用户/补训展示
    api/deps.py             # 公共鉴权与门店范围依赖
    api/routers/auth.py     # dev-login / logout / me
    api/routers/hq_courses.py    # 总部课程、审校、发布、批次
    api/routers/staff_learning.py # 员工任务、课程、章节完成
    seed.py                 # 幂等开发种子
    seed_data.py            # 门店、用户、课程和评分规则样例
  alembic/                  # 迁移环境与初始版本
  scripts/mysql_dev.sh      # 隔离的 MySQL 8.4 开发实例
  tests/                    # SQLite 单元/接口测试
```

## 快速启动

### 1. Python 环境

```bash
cd backend
uv sync
```

`uv` 会按 `pyproject.toml` 安装 Python 3.13 和依赖。若本机尚未安装 3.13，可先执行 `uv python install 3.13`。

### 2. MySQL

任选一种方式，最终都使用同一个库名/账号：

| 方式 | 命令 | 说明 |
| --- | --- | --- |
| 已有 MySQL 8.4 | 手工建库建用户 | 推荐生产/团队标准环境 |
| Docker（目标 8.4） | `docker run -d --name shouke-mysql -e MYSQL_ROOT_PASSWORD=root_dev -e MYSQL_DATABASE=shouke -e MYSQL_USER=shouke -e MYSQL_PASSWORD=shouke_dev -p 127.0.0.1:3307:3306 mysql:8.4` | Docker Hub 可达时使用 |
| 本机隔离脚本 | `./scripts/mysql_dev.sh init` | 使用已安装的 `/usr/local/mysql`，数据目录在 `backend/.mysql-data` |
| 本机已有 8.0 镜像 | `docker run -d --name shouke-mysql-dev -e MYSQL_ROOT_PASSWORD=root_dev -e MYSQL_DATABASE=shouke -e MYSQL_USER=shouke -e MYSQL_PASSWORD=shouke_dev -p 127.0.0.1:3307:3306 mysql:8.0` | 仅作为 8.4 不可用时的本地验证兜底 |

已有 MySQL 8.4 时，执行：

```sql
CREATE DATABASE IF NOT EXISTS shouke
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'shouke'@'127.0.0.1' IDENTIFIED BY 'shouke_dev';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON shouke.* TO 'shouke'@'127.0.0.1';
```

### 3. 配置

```bash
cp .env.example .env
```

默认值对应 `127.0.0.1:3307` 的 `shouke / shouke_dev` 开发库。生产环境必须由部署平台注入真实 `DATABASE_URL`，并设置 `APP_ENV=production`、`DEV_AUTH_ENABLED=false`。生产启动时若开发登录仍开启，配置会直接报错。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_ENV` | `development` | `production` 时禁用开发登录并强制 Secure Cookie |
| `DEV_AUTH_ENABLED` | `true` | 开发身份登录与种子脚本开关 |
| `APP_ORIGINS` | 本地 Vite 地址 | 写请求 Origin 允许列表，逗号分隔 |
| `DATABASE_URL` | 本地 3307 库 | 运行时 `mysql+aiomysql` |
| `ALEMBIC_DATABASE_URL` | 同上转 `mysql+pymysql` | 迁移用同步连接；不填则自动推导 |
| `SESSION_COOKIE_NAME` | `sk_session` | 会话 Cookie 名 |
| `SESSION_TTL_HOURS` | `12` | 绝对过期时间 |
| `COOKIE_SECURE` | `false` | 生产环境强制为 `true`；HTTPS 请求（含受信代理的 `X-Forwarded-Proto: https`）始终加 `Secure` |

### 4. 迁移与种子

```bash
uv run alembic upgrade head
uv run python -m app.seed
```

种子是幂等的：重复执行不会重复插入门店、用户或课程。种子只写入 1 个 `draft` 课程版本，不预置发布批次；发布流程由 T003/T008 通过接口完成。

### 5. 启动

```bash
uv run fastapi dev
```

默认监听 `127.0.0.1:8000`。健康检查：

```bash
curl http://127.0.0.1:8000/healthz
```

开发身份登录与当前用户：

```bash
curl -i -c /tmp/shouke.cookie \
  -X POST http://127.0.0.1:8000/api/v1/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"usr_linxiaomei"}'

curl -b /tmp/shouke.cookie http://127.0.0.1:8000/api/v1/me

curl -i -b /tmp/shouke.cookie \
  -X POST http://127.0.0.1:8000/api/v1/auth/logout \
  -H 'Content-Type: application/json'
```

所有 `POST` / `PUT` / `PATCH` / `DELETE` 请求即使没有正文，也必须带 `Content-Type: application/json`；否则返回 `422 VALIDATION_ERROR`，`details.fields[0].loc` 指向 `header.content-type`。登出也按这一规则处理。

`/api/v1/me` 匿名返回 `401 AUTH_REQUIRED`；Cookie 过期或已登出返回 `401 SESSION_EXPIRED`；跨门店资源返回 `404 NOT_FOUND`。HTTPS 下即使 `COOKIE_SECURE=false`，登录和登出响应的 Cookie 也会带 `Secure`。

## T003 课程发布与学习接口

以下示例使用种子草稿课程 `crv_chiikawa_v1`，发布到北京路门店。发布前必须完成审校，发布请求必须带 `Idempotency-Key`；相同键和相同请求体重放首次结果，不同请求体返回 `409 IDEMPOTENCY_KEY_REUSED`。

```bash
# 总部登录
curl -i -c /tmp/hq.cookie \
  -X POST http://127.0.0.1:8000/api/v1/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"usr_linmin"}'

# 审校
curl -i -b /tmp/hq.cookie \
  -X POST http://127.0.0.1:8000/api/v1/hq/course-versions/crv_chiikawa_v1/review \
  -H 'Content-Type: application/json' \
  -d '{"checklist":{"price_verified":true,"spec_verified":true,"redline_verified":true},"note":"已核对零售价、规格与话术红线"}'

# 定向发布
curl -i -b /tmp/hq.cookie \
  -X POST http://127.0.0.1:8000/api/v1/hq/course-versions/crv_chiikawa_v1/publish \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-publish-1' \
  -d '{"store_ids":["store_bj"],"deadline_hours":48,"expected_revision":1}'

# 读取批次和应训名单
curl -b /tmp/hq.cookie http://127.0.0.1:8000/api/v1/hq/releases/<release_id>
curl -b /tmp/hq.cookie http://127.0.0.1:8000/api/v1/hq/releases/<release_id>/assignees

# 员工登录和续学
curl -i -c /tmp/staff.cookie \
  -X POST http://127.0.0.1:8000/api/v1/auth/dev-login \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"usr_linxiaomei"}'

curl -b /tmp/staff.cookie http://127.0.0.1:8000/api/v1/staff/assignments
curl -b /tmp/staff.cookie http://127.0.0.1:8000/api/v1/staff/assignments/<assignment_id>

curl -i -b /tmp/staff.cookie \
  -X POST http://127.0.0.1:8000/api/v1/staff/assignments/<assignment_id>/chapters/ch1/complete \
  -H 'Content-Type: application/json' \
  -d '{}'
```

- 列表接口支持 `limit`（默认 50，最大 100）和 `cursor`；`next_cursor` 为空表示结束。
- 审校后版本冻结；需要改稿时用 `POST /hq/courses/{course_id}/versions` 从不可变版本克隆下一版，再走审校和发布。新版本首次发布时旧 `published` 版本变为 `superseded`，旧批次仍可读取。
- 发布事务内一次性写入批次、目标门店、应训名单快照和审计；之后成员新增、离职或调店不会改写旧名单。
- `GET /hq/releases/{release_id}/stats` 和店长统计属于 T005 的 48 小时统计范围，不在 T003 实现。

## 迁移约定

- 修改模型后生成草稿并人工审阅：

```bash
uv run alembic revision --autogenerate -m "describe change"
uv run alembic upgrade head
uv run alembic check
```

- 迁移文件必须审阅：Alembic 对重命名、CHECK 约束和 server_default 有盲区。当前初始迁移使用 MySQL 原生 ENUM 表达角色和状态，`retrains.open_flag` 是生成列，不能手工写入。
- 回滚验证：

```bash
uv run alembic downgrade base
uv run alembic upgrade head
```

- 迁移使用同步 PyMySQL；应用运行时使用 aiomysql。两者通过 `DATABASE_URL` / `ALEMBIC_DATABASE_URL` 指向同一个库。
- 连接串中的百分号编码（例如密码含 `@`，URL 中写成 `%40`）由 `alembic/env.py` 在传给 ConfigParser 前转义；不要手工改成 `%%40`，在线和离线迁移都可直接使用标准 URL。

## 测试

```bash
uv run pytest
```

单元与接口测试使用共享内存 SQLite，覆盖：

- 开发登录、当前用户、登出撤销、过期/无效令牌
- 请求体夹带角色字段、匿名访问、跨门店访问
- 停用门店和角色不一致成员关系不再进入 `/me` 或门店路由
- 鉴权依赖结束只读事务；路由入口可显式开启短写事务，模型等待期间不持有事务
- 四种写方法均要求 JSON 媒体类型；HTTPS 开发登录和生产环境 Cookie 均带 `Secure`
- Origin 校验、生产环境不注册开发登录
- 百分号编码的 Alembic 连接串可完成离线渲染，不报插值错误
- 种子幂等、17 张业务表注册、审计动作按契约值存储
- 课程创建、列表/详情、修订冲突、审校清单、不可变版本和克隆/替代
- 发布幂等、缺少/复用幂等键、版本状态冲突、目标门店校验、多门店和空名单
- 应训名单只含在职员工、角色/门店隔离、名单快照不随成员变更回写
- 员工任务列表排序、课程详情、章节完成幂等、未知章节和越权 404
- 发布批次合格人数/待复查/进行中补训读模型，以及员工最近 10 条成绩

MySQL 迁移和真实连接由以下命令验证（不使用 SQLite 代替）：

```bash
uv run alembic upgrade head
uv run alembic check
uv run python -m app.seed
uv run python -m app.seed
```

T003 另在临时 MySQL 8.0 库验证了审校发布、名单快照、员工续学，以及并发克隆产生唯一版本号、并发相同幂等键只产生一个发布批次；本卡没有新增 DDL。

## 路由扩展约定（交给 T004–T005）

1. 在 `app/api/routers/` 新建领域路由，例如 `courses.py`、`roleplay.py`。
2. 依赖注入使用公共类型：
   - 数据库：`DbDep`
   - 当前用户：`CurrentUserDep`
   - 角色：`Annotated[CurrentUser, Depends(require_roles(UserRole.hq_ops))]`
   - 门店路径：`Annotated[CurrentUser, Depends(require_store_access)]`，路由必须同时声明 `{store_id}` 参数。
   - `CurrentUser` 只保证 `user`、有效 `memberships` 和 `membership.store` 已加载；其他关系必须在业务查询中显式加载，避免异步懒加载。
3. 业务错误统一抛 `ApiError(status_code, code, message, details)`；不要返回裸 `HTTPException`。
4. 请求模型使用 `ConfigDict(extra="forbid")`，身份字段只从会话读取。
5. **事务边界：** `DbDep` 进入路由时没有活动事务；鉴权依赖和 `require_store_access` 已在返回前结束只读事务。写操作使用 `async with session.begin():` 包住短事务。模型调用（LangGraph/LLM）必须在事务外，等待模型期间不得持有数据库事务，核验后再开短事务写入成绩。
6. **门店范围：** `CurrentUser.memberships` 已过滤停用门店，以及与 `users.role` 不一致的成员关系；门店路由统一用 `require_store_access`，越界返回 `404 NOT_FOUND`。手动调用 `ensure_store_access` 时不会自动提交，调用方需把它放在业务事务内，或在调用后自行结束只读事务。
7. **媒体类型：** 所有 `POST` / `PUT` / `PATCH` / `DELETE` 必须带 `Content-Type: application/json`，无正文写操作也不例外；否则中间件返回 `422 VALIDATION_ERROR`。
8. 新表或字段必须新增 Alembic 迁移，并在任务卡登记迁移顺序。
9. 测试放在 `tests/`，优先使用 `create_app(test_settings)` + 共享内存 SQLite；MySQL 相关行为用上面的迁移命令单独验证。

### T003 交接给 T004/T005

- 发布批次与应训名单已经落库：`Release` 绑定课程/规则版本，`Assignment` 是发布时快照；员工读取必须按 `Assignment.user_id`，不要按当前门店成员关系动态计算。
- T004 写正式成绩时，在短事务内同时更新 `assignments.status`、`last_score`、`best_score`、`qualified_at` 和 `state_version`；状态派生可复用 `app/services/learning.py` 的 `derive_assignment_status`。
- T005 的补训/复查写入 `retrains` 后，同样要刷新 `assignments.status` 和 `state_version`；发布批次详情和员工列表已返回 `open_retrain` 读模型。
- `GET /hq/releases/{id}` 的 `qualified_in_window`、`pending_review`、`open_retrains` 已按当前表数据计算；T005 的 48 小时统计接口（HQ 与店长共用结构）仍需按 M1 §6.8/§7 实现。

## 与 M1 §4.2 的有意字段差异（T003–T005 交接）

实现以 `backend/alembic/versions/` 的迁移和 ORM 为准。以下差异是有意保留的，接口校验不要按契约示例的窄类型截断：

| 字段组 | M1 §4.2 | 实现 | 交接要求 |
| --- | --- | --- | --- |
| 实体 ID | `varchar(32)` | `String(40)` | 运行时是有类型前缀的 ULID；请求/响应按不透明字符串处理，Pydantic 长度上限用 40。 |
| `sessions.token_hash`、`idempotency_records.key_hash/request_hash` | `char(64)` | `String(64)`（MySQL `VARCHAR(64)`） | 只存 64 位十六进制哈希，不对外暴露；不要依赖 `CHAR` 的定长补空格行为。 |
| `roleplay_rounds.client_round_id` | `char(36)` | `String(36)` | 长度仍为 36；按字符串校验 UUID。 |
| `assignments.completed_chapter_count/last_score/best_score`、`roleplay_attempts.total`、`retrains.open_flag` | `tinyint` | `SMALLINT` | 分数接口仍按 0–100 校验，章节数按课程章节数校验；不要依赖数据库窄类型兜底。 |
| `roleplay_rounds.answer_source` | M1 仅 `text` | 枚举同时包含 `voice` | M1 只允许写入 `text`；`voice` 留到 M2，T004 不得接受或写入。 |

时间字段统一为 `DATETIME(3)` 存 UTC，JSON 字段、唯一键和索引与契约一致。T003–T005 的 Pydantic 模型应以本表和 ORM 为准，而不是按契约里的示例长度做截断。

## 本机环境说明

当前 macOS 上的 MySQL 8.4.8 在自定义 datadir 启动时报：

```text
Can't create UNDO tablespace innodb_undo_001 since './undo_001' already exists.
Data Dictionary initialization failed.
```

已确认与空目录、`--no-defaults`、外部 `innodb_undo_directory` 无关，属于本机 MySQL 安装/数据字典问题，不是迁移脚本问题。T002 迁移与 T003 业务接口的真实验证使用本机已有的 `mysql:8.0.46` Docker 镜像；T003 没有新增 DDL，迁移和模型继续按 MySQL 8.4 LTS 兼容方式编写。换到可用的 8.4 实例后，只需改 `.env` 中的两个 URL，重跑：

```bash
uv run alembic upgrade head
uv run alembic check
uv run python -m app.seed
```

生产环境不要使用 `.env.example` 中的开发密码，也不要沿用单一账号同时做迁移和运行时；应拆分迁移账号与最小权限运行时账号。