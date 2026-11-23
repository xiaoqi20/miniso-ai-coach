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
- Codex 验收结论：待验收。请重点检查会话鉴权语义、17 张业务表的迁移基线、MySQL 8.4 环境复跑要求和 T003–T005 的路由扩展方式。
