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
- 提交 / PR：T003 首轮成果提交到 `qoder` 分支，没有新增迁移；返工新增 `9d3f2a7c1b45` 评分租约列，见下。
- 接口范围：总部课程列表/创建/详情、版本克隆、草稿修改、审校、定向发布、批次详情与应训名单；员工任务列表、任务详情和章节完成。`GET /hq/releases/{id}/stats` 与店长统计属于 M1 §6.8/§7，留给 T005 共用的 48 小时统计实现。
- 验证命令与结果：
  - `cd backend && uv run pytest`：**50 passed**（T002 基线 32 + T003 新增 18）。
  - `cd backend && uv run python -m compileall -q app tests`：通过。
  - 临时 MySQL 8.0.46 库：`alembic upgrade head`、`alembic check`（No new upgrade operations；仅 `retrains.open_flag` 生成列警告）、种子 2 门店/9 用户/7 成员/1 草稿课程；真实 API 走通总部登录、审校、发布、批次/名单读取、员工登录、任务详情和章节续学。
  - MySQL 并发验证：两个并发版本克隆分别得到 `version_no=2/3`；两个并发相同 `Idempotency-Key` 发布返回同一 `release_id`、一个 `Idempotent-Replay: true`，数据库仅 1 个发布批次。
  - 首轮临时库、临时账号和验收实例均已清理；返工新增字段与迁移见下。
- 未验证 / 环境限制：
  - 本机原生 MySQL 8.4.8 仍无法启动；T003 无 DDL，业务接口在 MySQL 8.0.46 验证，T002 基线由 Codex 在 MySQL 8.4.13 验证。8.4 实例可用后按 README 重跑迁移和种子即可。
  - 前端 T006/T007 未改动；按规范由 Antigravity App 领取。
  - 真实模型评分不在 T003；T004 负责对练轮次、评分和补训状态推进。
- 接口示例：见 [backend/README.md](../../../backend/README.md) 的「T003 课程发布与学习接口」。

## Codex 验收 · 2026-11-23

**未通过，退回 QoderCN 返工。** T003 交付为 `b14c5f4`，本轮在 `qoder` 的 `9cbd794` 联合验证 T003 与 T004。

- 独立复跑后端测试，67 项全部通过。隔离 MySQL 8.4.13 通过迁移、`alembic check`、降级重建和试点种子验证。
- 在 MySQL 8.4.13 上走通总部审校与定向发布，校验发布批次的 3 人应训名单、跨店读取与写进度均返回 `404`、员工完成章节后进入 `ready_for_roleplay`。并发克隆分配版本 2/3，同一幂等键并发发布返回同一批次。

| 优先级 | 已复现差项 | 复验条件 |
| --- | --- | --- |
| P2 | 同一课程的两个已审校版本并发发布时，让两个请求各自锁定目标版本后再同时继续。MySQL 报死锁 `1213`，两个请求分别返回 `201` 和 `500 INTERNAL_ERROR`。发布事务锁住目标版本后，还会更新同课程的其他版本。[版本锁](../../../backend/app/services/courses.py#L499) · [替代旧版本](../../../backend/app/services/courses.py#L605) | 在 MySQL 8.4 并发发布不同版本，两个请求均得到契约定义的结果，且无 `500`。课程版本、批次、应训名单与审计一致。回归同键并发重放只生成一个批次。 |
| P2 | 固定章节完成时间的小数秒为 `.123900Z`，首次完成返回 `.123Z`，立即重放返回 `.124Z`。首次响应截断到毫秒，MySQL `DATETIME(3)` 写入时舍入到毫秒。两次 `state_version` 相同，但 `completed_at` 违反 M1 §5.4.1 和 §6.6.3。[时间写入](../../../backend/app/services/learning.py#L309) | 在 MySQL 8.4 用固定亚毫秒时间验证首次响应、详情读取与重复上报的 `completed_at` 一致，重复上报保持 `state_version` 且返回 `already_completed=true`。 |
| P2 | 同时把规则的 `weights` 和 `dimensions` 中的 `affinity` 改为 `service`。创建、审校、发布依次返回 `201`、`200`、`201`，员工预览返回 `500 INTERNAL_ERROR`。两组键相等即可通过 T003 校验，但缺失的维度是 T004 计分必需项。[评分规则校验](../../../backend/app/schemas/course.py#L102) · [T004 验收](T004-roleplay.md#codex-验收--2026-11-23) | 创建和修改草稿时拒绝缺失或未知的 M1 维度，审校和发布不得让已存的不兼容规则流入员工任务。有效四维规则须通过发布及员工预览回归。 |

## QoderCN 返工记录 · 2026-11-23

- 认领：2026-11-23，QoderCN，`qoder`。
- 返工变更：
  - `backend/app/services/courses.py`：发布事务先锁 `courses` 行，再锁目标版本；与克隆使用同一锁顺序，同课程发布串行化。
  - `backend/app/models/base.py`：`UTCDateTime` 写库前截断到毫秒，与 API 输出和 MySQL `DATETIME(3)` 对齐。
  - `backend/app/schemas/course.py`、`services/common.py`、`services/courses.py`：强制 M1 四维；审校、发布前复检已存规则。
  - `backend/tests/test_courses.py`、`test_learning.py`、`helpers.py`：并发发布语义、固定亚毫秒时间、已存不兼容规则回归。
  - `backend/README.md`：补返工行为、迁移和验证说明。
- 验证命令与结果：
  - `cd backend && uv run pytest -q`：**72 passed**。
  - `uv run python -m compileall -q app tests alembic`：通过。
  - Docker `mysql:8.4.13`：`alembic upgrade head`、`alembic check`、`downgrade base`、重建、种子均通过；`check` 仅保留既有生成列警告。
  - 同课程两个已审校版本并发发布：两个请求均 `201`，无死锁/`500`；最终一个 `published`、一个 `superseded`，两个批次各 3 名应训，两条发布审计。
  - 同一 `Idempotency-Key` 并发发布新版本：返回同一 `release_id`，仅一个 `Idempotent-Replay: true`，不新增重复批次。
  - 固定 `2026-11-24T09:35:00.123900Z`：首次完成、立即重放、任务详情均为 `.123Z`；重复上报 `state_version` 不变。
  - 预置 `affinity→service` 规则：创建 `422`；审校和发布各 `422 VALIDATION_ERROR`，发布不生成批次。
  - 临时 MySQL 容器已停止并自动移除；没有改动前端。
- 交接：正式评分前的规则复检和租约恢复见 [T004 返工记录](T004-roleplay.md#qodercn-返工记录--2026-11-23)。
