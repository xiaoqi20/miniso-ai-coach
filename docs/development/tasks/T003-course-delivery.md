# T003 审校发布与员工学习 API

前置任务为 T002。 [任务看板](../board.md)

## 目标与范围

负责 `backend/` 中课程与学习模块及其测试。实现总部录入或使用种子草稿、人工审校、不可变课程版本克隆、门店定向发布，以及员工课程列表、详情和进度。提供其他业务模块可使用的已发布课程版本和应训数据。查阅 `fastapi`、`sqlalchemy`、`mysql-patterns`。 [项目 Skills](../../../.agents/skills/README.md)

## 交付与验收

- [x] 总部完成审校才能发布。发布写入课程与规则版本、服务端发布时间、目标门店及应训名单，后续改稿和成员变更不回写旧批次。
- [x] 可从已冻结版本克隆新草稿及独立评分规则；版本号并发生成唯一，旧版本和已发布批次保持可追溯。已替代的旧版本不能新建发布。
- [x] 门店 A 员工可读面向本店且分配给本人的已发布课程，门店 B 员工不能看到该课程。直接访问详情和写入进度时同样校验身份与范围。
- [x] 员工学习进度按契约保存，重复上报同一章节后进度保持一致。读取草稿、越权和非法进度请求返回契约规定的结果。
- [x] 使用试点开发数据验证审校、发布、读取及续学，记录接口示例，供前端和闭环验收使用。

## T002 公共依赖接入说明（2026-11-23 返工后）

- `DbDep` 进入路由时没有活动事务；写操作使用 `async with session.begin():` 包住短事务。
- 门店路由统一使用 `require_store_access`。`CurrentUser.memberships` 已过滤停用门店和与 `users.role` 不一致的成员关系，越界返回 `404 NOT_FOUND`。
- 所有 `POST` / `PUT` / `PATCH` / `DELETE` 必须带 `Content-Type: application/json`，无正文写操作也不例外。
- 字段长度和分数类型按 [backend/README.md](../../../backend/README.md) 的「与 M1 §4.2 的有意字段差异」执行，不要按契约示例截断。

## 交付记录

- 认领：2026-11-23，QoderCN，`qoder`。
- 变更文件：
  - `backend/app/schemas/course.py`、`learning.py`：课程内容、评分规则、审校、发布、版本克隆和章节完成请求校验。
  - `backend/app/services/courses.py`、`learning.py`、`idempotency.py`、`common.py`：课程/版本/发布、员工学习、状态派生、幂等和分页。
  - `backend/app/api/routers/hq_courses.py`、`staff_learning.py`：M1 §6.5.1–6.5.9、§6.6.1–6.6.3 路由；`main.py` 注册。
  - `backend/tests/test_courses.py`、`test_learning.py`、`helpers.py`：T003 接口与业务测试。
  - `backend/README.md`：T003 接口示例、测试覆盖和 T004/T005 交接说明。
- 提交 / PR：T003 成果提交到 `qoder` 分支；没有新增迁移。
- 接口范围：总部课程列表/创建/详情、版本克隆、草稿修改、审校、定向发布、批次详情与应训名单；员工任务列表、任务详情和章节完成。`GET /hq/releases/{id}/stats` 与店长统计属于 M1 §6.8/§7，留给 T005 共用的 48 小时统计实现。
- 验证命令与结果：
  - `cd backend && uv run pytest`：**50 passed**（T002 基线 32 + T003 新增 18）。
  - `cd backend && uv run python -m compileall -q app tests`：通过。
  - 临时 MySQL 8.0.46 库：`alembic upgrade head`、`alembic check`（No new upgrade operations；仅 `retrains.open_flag` 生成列警告）、种子 2 门店/9 用户/7 成员/1 草稿课程；真实 API 走通总部登录、审校、发布、批次/名单读取、员工登录、任务详情和章节续学。
  - MySQL 并发验证：两个并发版本克隆分别得到 `version_no=2/3`；两个并发相同 `Idempotency-Key` 发布返回同一 `release_id`、一个 `Idempotent-Replay: true`，数据库仅 1 个发布批次。
  - 临时库、临时账号和验收实例均已清理；没有新增迁移或字段。
- 未验证 / 环境限制：
  - 本机原生 MySQL 8.4.8 仍无法启动；T003 无 DDL，业务接口在 MySQL 8.0.46 验证，T002 基线由 Codex 在 MySQL 8.4.13 验证。8.4 实例可用后按 README 重跑迁移和种子即可。
  - 前端 T006/T007 未改动；按规范由 Antigravity App 领取。
  - 真实模型评分不在 T003；T004 负责对练轮次、评分和补训状态推进。
- 接口示例：见 [backend/README.md](../../../backend/README.md) 的「T003 课程发布与学习接口」。
