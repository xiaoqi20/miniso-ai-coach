# T005 店长补训、复查及统计 API

前置任务为 T002。可用同契约的批次、成绩和补训测试数据与 T003、T004 并行。 [任务看板](../board.md)

## 目标与范围

负责 `backend/` 中店长看板、补训指派、人工复查、试点统计及其测试。读取对练成绩和复练证据，按当前状态写入店长操作及审计记录。查阅 `fastapi`、`sqlalchemy`、`mysql-patterns`。 [项目 Skills](../../../.agents/skills/README.md)

## 交付与验收

- [x] 店长能查看授权门店的应训名单、员工进度和卡点，能根据漏讲项发起补训。读写接口均按服务端身份和门店成员关系校验。
- [x] 店长只能确认符合契约的待复查记录。校验所依据的复练证据和状态版本，重复操作结果符合幂等约定。已完成复查包含操作人和服务端时间。
- [x] 跨店读写、在考点未改正时提前确认，以及基于过期状态复查都按契约处理。
- [x] 提供批次的 48 小时通关统计，验证两家门店的发布范围、历史应训名单、时间边界、重复通关及空名单口径。

## T002 公共依赖接入说明（2026-11-23 返工后）

- 店长路由同时使用 `require_roles(UserRole.store_manager)` 与 `require_store_access`；`CurrentUser.memberships` 已过滤停用门店和与 `users.role` 不一致的成员关系，越界返回 `404 NOT_FOUND`。
- `DbDep` 进入路由时没有活动事务；补训、复查和审计写入使用 `async with session.begin():` 包住短事务，幂等记录与业务写入在同一事务内。
- 所有 `POST` / `PUT` / `PATCH` / `DELETE` 必须带 `Content-Type: application/json`，无正文写操作也不例外。
- 字段长度和分数类型按 [backend/README.md](../../../backend/README.md) 的「与 M1 §4.2 的有意字段差异」执行。

## T003 数据交接

- 发布批次、目标门店、应训名单快照和员工章节进度已由 T003 落库；店长查询按 `Assignment.store_id` 和批次目标门店限定，不按当前成员关系重算。
- `GET /hq/releases/{id}` 已返回 `assigned_total`、`qualified_in_window`、`pending_review`、`open_retrains` 读模型；T005 的 HQ/店长 48 小时统计按 M1 §6.8/§7 共用同一结构。
- 补训/复查写入 `retrains` 后，在同一短事务刷新 `assignments.status` 和 `state_version`；员工列表和批次名单的 `open_retrain` 字段会直接读取该状态。
- `qualified_at` 已由 T003 建表并由 T004 在首次正式通过时写入；T005 只能读取，不因复查确认或窗口外操作回写。

## T004 数据交接

- T004 已写正式成绩并维护 `assignments.last_score/best_score/last_attempt_at/first_passed_at/qualified_at/status/state_version`；T005 不重复计算成绩，只读取冻结结果。
- 存在进行中补训时，T004 已根据整轮成绩推进为 `submitted_unfixed` 或 `fixed_pending_review`，写入 `evidence_round_no`、`evidence_attempt_id` 并递增 `retrains.version`；进入待复查后证据冻结。
- T005 指派补训时以当前 `roleplay_sessions.last_round_no` 作为 `baseline_round_no`；确认/驳回使用 `expected_version` 与冻结的 `evidence_attempt_id`，不要改用最新成绩。
- 失败/无效模型输出只保留 `failed` 轮次，`roleplay_attempts` 为空，不应作为补训证据。

## 交付记录

### 2026-11-25 首次交付（Antigravity App · `feat/t005-store-review`）

- **变更文件**：
  - `backend/app/schemas/manager.py`：新增 `IssueRetrainRequest`、`ReviewRetrainRequest`（`extra="forbid"`，拒绝身份字段与布尔值版本，确认复查强制校验 `evidence_attempt_id`）。
  - `backend/app/services/manager.py`：实现店长看板读模型（`list_manager_releases`、`get_manager_release_detail`、`list_manager_release_assignees`、`get_manager_assignment_detail`）、补训指派（`issue_retrain`）、人工复查确认/驳回（`review_retrain`）以及总部与店长共用的 48 小时统计（`get_release_stats`）。
  - `backend/app/api/routers/manager.py`：注册 `/api/v1/manager` 下 7 个店长接口（均通过 `require_roles(UserRole.store_manager)` 与服务端管辖门店范围校验）。
  - `backend/app/api/routers/hq_courses.py`：新增 `GET /api/v1/hq/releases/{release_id}/stats`，与店长统计共用同一口径实现。
  - `backend/app/main.py`：挂载 `manager_router`。
  - `backend/tests/test_manager.py`：新增 6 组店长看板、补训、复查与 48 小时统计端到端及边界测试。
  - 无新增或修改数据库表结构，无需新增 Alembic 迁移（沿用 T002/T004 现有 17 张业务表及 `retrains.open_flag` 生成列）。
- **关键实现说明**：
  - 写事务锁顺序统一为 `Assignment -> Retrain`，与 T004 `_persist_attempt` 保持一致，避免员工复练落库与店长操作并发发生死锁。
  - `issue_retrain` / `review_retrain` 均在独立只读事务先做归属范围判定（越界直接 `404 NOT_FOUND`），写事务内持锁校验幂等键、状态、乐观锁 `expected_version`、冻结 `evidence_attempt_id`、目标考点命中与整轮通关，并在同一短事务内更新 `assignments.status`/`state_version`、写入 `audit_events` 及保存 `idempotency_records`。
  - `review_retrain` 确认/驳回使用带 `status` 与 `version` 条件的 `UPDATE` 语句实现乐观锁；确认复查不回写 `qualified_at`/`first_passed_at`，驳回复查将 `baseline_round_no` 推进至当前最大轮次并保留历史证据于审计载荷。
  - 48 小时统计严格使用左闭右开 `[published_at, published_at + 48h)` 窗口（不受 `deadline_hours` 影响），按发布快照 `assignments` 与不可回退 `qualified_at` 计算，空名单返回 `rate=null, empty_roster=true`。
- **验证命令与结果**：
  - `cd backend && uv run pytest -v`：`81 passed, 1 skipped`（新增 6 组 T005 测试及既有 75 项回归测试全部通过；1 项跳过为需要外部 `SHOUKE_TEST_MYSQL_URL` 的 T003 MySQL 并发发布测试）。
- **未验证项**：
  - 当前运行环境未连接外部 MySQL 8.4 实例，暂未对 `SHOUKE_TEST_MYSQL_URL` 实库复跑；无新增迁移脚本，MySQL 兼容语法（`with_for_update`、条件 `UPDATE`、`open_flag` 生成列）均遵循既有 T002–T004 约定。
- **Codex 验收结论**：待验收。
