# T005 店长补训、复查及统计 API

前置任务为 T002。可用同契约的批次、成绩和补训测试数据与 T003、T004 并行。 [任务看板](../board.md)

## 目标与范围

负责 `backend/` 中店长看板、补训指派、人工复查、试点统计及其测试。读取对练成绩和复练证据，按当前状态写入店长操作及审计记录。查阅 `fastapi`、`sqlalchemy`、`mysql-patterns`。 [项目 Skills](../../../.agents/skills/README.md)

## 交付与验收

- [ ] 店长能查看授权门店的应训名单、员工进度和卡点，能根据漏讲项发起补训。读写接口均按服务端身份和门店成员关系校验。
- [ ] 店长只能确认符合契约的待复查记录。校验所依据的复练证据和状态版本，重复操作结果符合幂等约定。已完成复查包含操作人和服务端时间。
- [ ] 跨店读写、在考点未改正时提前确认，以及基于过期状态复查都按契约处理。
- [ ] 提供批次的 48 小时通关统计，验证两家门店的发布范围、历史应训名单、时间边界、重复通关及空名单口径。

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

## 交付记录

认领后在此登记交付、验证和 Codex 验收结论。 [记录模板](TEMPLATE.md)
