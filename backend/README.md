# MINISO 门店培训 · M1 后端底座

本目录包含 T002 的 FastAPI/MySQL/会话底座、T003 的课程审校发布与员工学习接口，以及 T004 的文字对练、评分与复练回写。T005 在此基础上实现店长补训复查与统计。

## 技术栈与范围

- Python 3.13、FastAPI、Pydantic 2
- SQLAlchemy 2.x、`aiomysql` 运行时连接、`pymysql` 迁移连接
- MySQL 8.4 LTS（本地验证环境如只有 8.0 也可运行本套 SQL）
- Alembic 迁移；SQLite 仅用于单元测试的快速启动，不作为正式数据库
- LangGraph `StateGraph` 编排评分流程；M1 使用确定性模型替身，不需要外部模型密钥

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
    schemas/roleplay.py     # 对练预览与正式轮次请求
    services/auth.py        # 会话解析、当前用户
    services/courses.py     # 课程、版本、审校、发布与批次读模型
    services/learning.py    # 员工任务、章节进度与状态派生
    services/roleplay.py    # 对练会话、轮次、成绩和复练推进
    services/roleplay_scoring.py # LangGraph 评分图、模型替身与业务计分
    services/idempotency.py # 发布幂等键
    services/common.py      # 游标、时间/用户/补训展示
    api/deps.py             # 公共鉴权与门店范围依赖
    api/routers/auth.py     # dev-login / logout / me
    api/routers/hq_courses.py    # 总部课程、审校、发布、批次
    api/routers/staff_learning.py # 员工任务、课程、章节完成
    api/routers/staff_roleplay.py # 员工对练、预览、轮次
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
- 发布和克隆都先锁 `courses` 行，再处理目标版本；同课程并发发布按课程串行，避免两个发布各锁一个版本后互锁。
- 发布事务内一次性写入批次、目标门店、应训名单快照和审计；之后成员新增、离职或调店不会改写旧名单。
- 评分规则必须且只能包含 M1 四维 `selling`、`objection`、`cross_sell`、`affinity`。创建时由请求校验拒绝，审校和发布前再次校验已存规则，防止历史数据绕过。
- 章节完成时间在写入前截断到毫秒；首次响应、详情读取和重复上报返回同一 `completed_at`。
- `GET /hq/releases/{release_id}/stats` 和店长统计属于 T005 的 48 小时统计范围，不在 T003 实现。

## T004 对练与评分接口

员工完成全部章节后创建对练会话；`client_round_id` 是轮次幂等键。预览不要求学完章节，也不落库。评分使用 LangGraph `StateGraph` 调用确定性模型替身，业务层重新核验候选并计算四维分和总分；模型调用在数据库事务外。

```bash
# 员工登录后，使用 T003 的 assignment_id
curl -i -b /tmp/staff.cookie \
  -X POST http://127.0.0.1:8000/api/v1/staff/assignments/<assignment_id>/roleplay-sessions \
  -H 'Content-Type: application/json'

# 预览：不落库
curl -i -b /tmp/staff.cookie \
  -X POST http://127.0.0.1:8000/api/v1/staff/assignments/<assignment_id>/roleplay-preview \
  -H 'Content-Type: application/json' \
  -d '{"answer_text":"您摸摸我们拆好的样品，这款虽然 59 元但它是日本正版联名授权，定制超柔短毛绒手感非常软糯！如果想稳抽乌萨奇可以摇盒挑手感，或者和朋友拼端盒 6 个绝对不重复，结账还可以加 9.9 元换购防尘挂袋挂包不怕脏哦！","question_variant":"default"}'

# 正式轮次
curl -i -b /tmp/staff.cookie \
  -X POST http://127.0.0.1:8000/api/v1/staff/roleplay-sessions/<session_id>/rounds \
  -H 'Content-Type: application/json' \
  -d '{"client_round_id":"0f8fad5b-d9cb-469f-a165-70867728950e","answer_text":"这款是日本正版授权的联名毛绒公仔，手感软糯，五十九块钱一个；端盒六个不重样，您要不要摸一下拆开的样品？加 9.9 元还能配防尘挂袋。","question_variant":"default"}'

# 刷新或重启后恢复
curl -b /tmp/staff.cookie \
  http://127.0.0.1:8000/api/v1/staff/roleplay-sessions/<session_id>
```

- 契约四个样本由模型替身和业务层共同覆盖：正确 `99`、同义表达 `91`、漏讲 `99` 但必考事实一票否决、事实错误 `69` 且命中红线。
- `question_variant` 为 `default` / `alt`；M1 的 `answer_source` 只写 `text`。
- 同一 `client_round_id` 已评分时返回同一轮次和成绩，`replayed=true`；正在评分返回 `409 SCORING_IN_PROGRESS`，`details.retry_after_seconds` 给出建议等待秒数。
- 轮次进入 `scoring` 时持久化 `scoring_started_at`，租约为 30 秒。进程在评分中退出后，租约内仍返回 409；过期后同一键可重新认领该轮，最终只写一条正式成绩。
- 模型超时/失败返回 `503 SCORING_UNAVAILABLE`，输出无法核验返回 `502 SCORING_INVALID_OUTPUT`；轮次保留为 `failed`，同一键重试可重新评分。
- 评分前再次校验批次绑定的规则。已存规则不兼容 M1 四维时，预览和正式评分返回 `422 VALIDATION_ERROR`；正式轮次落为 `failed` 且 `failure_code=RUBRIC_INCOMPATIBLE`，不写成绩。
- 评分完成后在同一短事务写入成绩并更新任务分数、`qualified_at`、`state_version`；存在进行中补训时推进为 `submitted_unfixed` 或 `fixed_pending_review`，待复查后冻结证据。

## 迁移约定

- 修改模型后生成草稿并人工审阅：

```bash
uv run alembic revision --autogenerate -m "describe change"
uv run alembic upgrade head
uv run alembic check
```

- 迁移文件必须审阅：Alembic 对重命名、CHECK 约束和 server_default 有盲区。当前初始迁移使用 MySQL 原生 ENUM 表达角色和状态，`retrains.open_flag` 是生成列，不能手工写入。
- `9d3f2a7c1b45_add_roleplay_scoring_lease` 为 `roleplay_rounds` 增加可空的 `scoring_started_at`；历史行保持 `NULL`，恢复逻辑回退到 `submitted_at` 计算租约。该列不对外暴露。
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
- LangGraph 评分样本（正确、同义表达、漏讲、事实错误）、价格否定和非法模型候选
- 对练章节门槛、预览不落库、轮次幂等/恢复、失败/超时/无效输出重试
- 并发轮次编号、同 `client_round_id` 冲突、复练推进到待复查并冻结证据
- M1 四维规则校验、审校/发布拒绝已存不兼容规则、对练预览/正式评分的定义错误
- 固定亚毫秒时间下章节首次完成/重放/详情时间一致，以及评分租约过期后的同键恢复

当前 `uv run pytest` 共 **72 passed**。

MySQL 迁移和真实连接由以下命令验证（不使用 SQLite 代替）：

```bash
uv run alembic upgrade head
uv run alembic check
uv run python -m app.seed
uv run python -m app.seed
```

T003/T004 在临时 MySQL 8.4.13 容器复验了审校发布、名单快照、员工续学、并发克隆唯一版本号和同键发布重放。返工后又验证了：同课程两个已审校版本并发发布均返回 `201`、无死锁；固定 `.123900` 亚毫秒时间下章节首次/重放/详情均为 `.123Z`；评分中断并切换新应用实例后，租约内返回 `409`、过期后同键恢复且只有一条成绩；已存不兼容规则在审校、发布、预览和正式评分均返回定义错误，正式轮次进入 `failed` 且无成绩。新增迁移 `9d3f2a7c1b45`。

## 路由扩展约定（交给 T005）

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

### T004 交接给 T005

- T004 已写入 `roleplay_attempts`，并同步维护 `assignments.last_score`、`best_score`、`last_attempt_at`、`first_passed_at`、`qualified_at`、`status` 和 `state_version`。
- 存在进行中补训时，正式复练会把 `retrains.status` 推进为 `submitted_unfixed` 或 `fixed_pending_review`，写入 `evidence_round_no`/`evidence_attempt_id`，并递增 `version`；进入待复查后证据冻结。
- T005 指派补训时使用当前 `roleplay_sessions.last_round_no` 作为 `baseline_round_no`；确认/驳回使用 `expected_version` 和冻结的 `evidence_attempt_id`，不要重新选择最新成绩。
- 评分中断的轮次可能短暂停在 `scoring`；租约到期后由同一 `client_round_id` 恢复。正式成绩只存在于 `roleplay_attempts`，T005 统计和复查不要依赖轮次状态代替成绩。
- 员工任务详情已返回最近 10 条成绩和 `open_retrain`；T005 写复查后继续沿用同一状态派生。

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

已确认与空目录、`--no-defaults`、外部 `innodb_undo_directory` 无关，属于本机 MySQL 安装/数据字典问题，不是迁移脚本问题。真实验证改用 Docker `mysql:8.4`（本轮为 8.4.13）临时实例，迁移、`alembic check`、种子和 API 复验均通过；T004 返工新增的 `scoring_started_at` 已在该版本验证。T004 的评分依赖 `langgraph`，由 `uv sync` 安装；M1 不配置真实模型密钥。使用其他 8.4 实例时，只需改 `.env` 中的两个 URL，重跑：

```bash
uv run alembic upgrade head
uv run alembic check
uv run python -m app.seed
```

生产环境不要使用 `.env.example` 中的开发密码，也不要沿用单一账号同时做迁移和运行时；应拆分迁移账号与最小权限运行时账号。