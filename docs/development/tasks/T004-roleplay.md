# T004 对练、评分及复练回写

前置任务为 T002。可用同契约的已发布课程测试数据与 T003、T005 并行。 [任务看板](../board.md)

## 目标与范围

负责 `backend/` 中对练、评分模块及其测试。用 LangGraph `StateGraph` 编排文字对练和结构化评分证据，按 MySQL 中已保存的轮次恢复。业务层计算正式成绩并负责复练时的自动状态推进，店长指派和复查由 T005 实现。查阅 `langchain-build-agent`、`fastapi`、`sqlalchemy`、`mysql-patterns`。 [项目 Skills](../../../.agents/skills/README.md)

## 交付与验收

- [x] 创建会话时校验参与人和发布批次，绑定已发布的课程和评分规则版本。轮次顺序与重试结果在刷新或服务重启后可恢复。
- [x] 提供可重复的模型替身和「端盒 6 个不重复」样本，覆盖正确、同义表达、漏讲、事实错误。业务层按绑定规则核验命中、缺失和证据，产出可解释成绩。
- [x] 模型调用在事务外。核验后在同一短事务内写正式成绩及复练结果。重复提交返回同一份成绩，并发轮次按契约有序写入或返回冲突，过期结果不会覆盖当前补训状态。
- [x] 为漏讲保留补训待办，改正后推进至待复查。模型调用失败或输出无效时保留已保存轮次，允许重试，且不产生正式成绩。

## T002 公共依赖接入说明（2026-11-23 返工后）

- `DbDep` 进入路由时没有活动事务；鉴权依赖已在返回前结束只读事务。
- 模型调用必须在事务外。等待模型响应期间不得持有数据库事务；核验完成后用 `async with session.begin():` 写正式成绩和复练结果。
- 门店路由统一使用 `require_store_access`；门店范围已过滤停用门店和角色不一致的成员关系。
- 所有 `POST` / `PUT` / `PATCH` / `DELETE` 必须带 `Content-Type: application/json`。
- M1 的 `answer_source` 只允许 `text`；数据库中预留的 `voice` 留到 M2，不得写入。字段校验按 [backend/README.md](../../../backend/README.md) 的「与 M1 §4.2 的有意字段差异」执行。

## T003 数据交接

- 发布批次与应训名单已由 T003 落库：`Release` 绑定课程/规则版本，`Assignment` 是发布时快照；正式对练按 `assignment_id` 和 `release.rubric_version_id` 读取绑定版本，不按当前门店成员关系重算。
- 写正式成绩时在同一短事务更新 `assignments.status`、`last_score`、`best_score`、`qualified_at`、`state_version`；状态派生可复用 `app/services/learning.py` 的 `derive_assignment_status`。
- 员工任务详情已返回最近 10 条 `roleplay_attempts` 和 `open_retrain` 读模型；T004 写入后保持这些字段与正式成绩一致。
- `GET /hq/releases/{id}` 已提供 `assigned_total`、`qualified_in_window`、`pending_review`、`open_retrains` 汇总；T004 只需写业务事实，不另建统计表。

## 交付记录

- 认领：2026-11-23，QoderCN，`qoder`。
- 变更文件：
  - `backend/app/schemas/roleplay.py`：预览与正式轮次请求，`client_round_id` UUID 校验。
  - `backend/app/services/roleplay.py`：会话创建/恢复、预览、轮次分配、成绩落库、补训推进。
  - `backend/app/services/roleplay_scoring.py`：LangGraph `StateGraph` 评分图、确定性模型替身、规则核验与四维计分。
  - `backend/app/api/routers/staff_roleplay.py`：M1 §6.6.4–§6.6.7；`main.py` 注册。
  - `backend/tests/test_roleplay.py`、`test_roleplay_scoring.py`：T004 接口、样本、失败和并发测试。
  - `backend/pyproject.toml`、`uv.lock`：新增 `langgraph`；`backend/README.md` 更新 T004 说明与 T005 交接。
- 提交 / PR：T004 首轮成果提交到 `qoder` 分支，没有新增迁移；返工新增 `9d3f2a7c1b45` 评分租约列，见下。
- 接口范围：创建/恢复对练会话、示例话术预览、恢复已保存轮次、提交正式轮次。
- 验证命令与结果：
  - `cd backend && uv run pytest`：**67 passed**（T003 基线 50 + T004 新增 17）。
  - `cd backend && uv run python -m compileall -q app tests`：通过；新增 T004 文件 Ruff 检查通过。
  - 四个契约样本：正确 `99`、同义表达 `91`、漏讲 `99` 但 `fact_box_rule` 一票否决、事实错误 `69` 且 `买一送一` 红线；价格否定防护通过。
  - 故障路径：模型不可用 `503`、超时 `503`、输出无效 `502`，均保留 `failed` 轮次且不写成绩；同 `client_round_id` 重试成功。
  - MySQL 8.0.46 临时库：并发不同 `client_round_id` 得到轮次 1/2，同一键并发得到 `409 SCORING_IN_PROGRESS`/`201`，数据库只有对应成绩；任务 `last_score/best_score=99`、`qualified_at` 写入、`state_version` 递增。
  - 补训推进：`pending` → `submitted_unfixed` → `fixed_pending_review`，`version` 递增；进入待复查后后续成绩不再改写证据。
- 未验证 / 环境限制：
  - M1 只使用确定性模型替身，未接真实模型或 LangSmith 实验；真实提供方超时/重试和结构化输出留到 M2。
  - 本机原生 MySQL 8.4.8 仍无法启动；T004 无 DDL，接口在 MySQL 8.0.46 验证，T002 迁移基线由 Codex 在 MySQL 8.4.13 验证。
  - 临时 MySQL 库 `shouke_t004` 用户已确认清理，但本机权限分类器仍阻止自动执行 `DROP`；需在宿主手动删除，不影响项目库。
  - 前端 T006/T007 未改动；按规范由 Antigravity App 领取。
- 接口示例：见 [backend/README.md](../../../backend/README.md) 的「T004 对练与评分接口」。

## Codex 验收 · 2026-11-23

**未通过，退回 QoderCN 返工。** 本轮在 `qoder` 的交付提交 `9cbd794` 验证，M1 评分使用确定性模型替身。

- 独立复跑后端测试，67 项全部通过。用隔离 MySQL 8.4.13 验证四个样本，正确话术 99 分通过，同义表达 91 分通过，漏讲 99 分未通过，事实错误 69 分未通过。
- 核对已评分的同一轮重放返回同一份成绩，对仍在执行的评分重复提交返回 `409 SCORING_IN_PROGRESS`。让第 5 轮评分晚于第 6 轮完成，第 6 轮通过后将补训推进至待复查并冻结证据，第 5 轮晚到后未改写该证据。

| 优先级 | 已复现差项 | 复验条件 |
| --- | --- | --- |
| P1 | 正式轮次已保存为 `scoring`，在等待评分期间取消请求，关闭旧连接池并用同一 MySQL 创建新应用实例。GET 仍显示 `scoring`，同一 `client_round_id` 重试仍返回 `409 SCORING_IN_PROGRESS`。当前分支对该状态没有恢复路径。[评分重试](../../../backend/app/services/roleplay.py#L382) | 在 MySQL 8.4 覆盖评分中断和服务重启，在明确的有限时间内用同一键恢复同一轮。正在执行时仍返回 `409`，恢复完成后重放同一成绩，最终只有一条正式成绩。 |
| P2 | T003 允许发布把 `affinity` 改名为 `service` 的规则，员工对练预览按固定四维取值时报错并返回 `500 INTERNAL_ERROR`。[评分维度读取](../../../backend/app/services/roleplay_scoring.py#L356) · [T003 验收](T003-course-delivery.md#codex-验收--2026-11-23) | 与 T003 共用 M1 维度约束。用预置的不兼容规则测试预览和正式评分，返回有定义的错误。正式轮次进入可重试状态，并核对没有写入正式成绩。 |

## QoderCN 返工记录 · 2026-11-23

- 认领：2026-11-23，QoderCN，`qoder`。
- 返工变更：
  - `backend/app/models/roleplay.py`、`backend/alembic/versions/9d3f2a7c1b45_add_roleplay_scoring_lease.py`：新增可空 `roleplay_rounds.scoring_started_at`；历史行回退到 `submitted_at`。
  - `backend/app/services/roleplay.py`：`scoring` 轮次使用 30 秒持久化租约；租约内返回 `409` 和 `retry_after_seconds`，过期后同一键重新认领；失败重试刷新租约。
  - `backend/app/services/common.py`、`courses.py`、`roleplay.py`：评分前复检 M1 四维；不兼容规则返回 `422 VALIDATION_ERROR`，正式轮次落为 `failed/RUBRIC_INCOMPATIBLE`，不写成绩。
  - `backend/tests/test_roleplay.py`：租约冲突、过期恢复、不兼容规则预览/正式评分回归。
  - `backend/README.md`：补恢复与错误处理说明。
- 验证命令与结果：
  - `cd backend && uv run pytest -q`：**72 passed**（新增或更新 5 项跨 T003/T004 回归）。
  - Docker `mysql:8.4.13`：新迁移通过 `upgrade`、`check`、`downgrade base`、重建和种子。
  - 评分中断：员工等待评分时取消请求，关闭旧应用的连接池，并用同一数据库创建新应用实例；`GET` 显示 `scoring`，立即重试返回 `409 SCORING_IN_PROGRESS`。实际等待 31 秒超过 30 秒租约后，用同一 `client_round_id` 重试得到 `201`、99 分；数据库只有 1 条成绩，再次提交返回同一 `attempt_id` 且 `replayed=true`。
  - 不兼容规则：预置 `affinity→service` 后，预览和正式评分均 `422 VALIDATION_ERROR`；正式轮次为 `failed`、`failure_code=RUBRIC_INCOMPATIBLE`，该轮成绩数为 0。
  - 审校/发布复检：同一不兼容规则分别返回 `422`，不生成发布批次。
  - 新迁移使 T003/T004 产生 DDL，已在上表登记；临时 MySQL 8.4 容器已停止并自动移除。
- 未验证：前端 T006/T007；真实模型提供方。M1 仍使用确定性替身。

## Codex 复验 · 2026-11-23

**未通过，退回 QoderCN 返工。** 复验基线为 `qoder` 与 `origin/qoder` 上的 `0b809f6`。

- 72 项后端测试通过。独立使用 MySQL 8.4.13 验证迁移 `9d3f2a7c1b45` 升降级、空库重建、`alembic check` 和种子重跑。`check` 仅有既有生成列警告。
- 等待评分期间取消请求，销毁旧连接池并新建应用实例。租约有效时返回 `409 SCORING_IN_PROGRESS`，等待 31 秒后用同一键恢复同一轮，得到 `201`。再次请求重放同一份成绩，数据库只有 1 条成绩。预置不兼容规则时，预览和正式评分均返回 `422`，正式轮次为 `failed/RUBRIC_INCOMPATIBLE`，成绩数为 0。恢复有效规则后同键重试成功。
- **P1 · 旧租约失效后仍能写入成绩或失败状态。** 用同步点将请求 A 暂停在结果落库前，推进应用时钟使租约到期，让请求 B 接管同一轮，再恢复 A。A 先写成功时返回 `201`，B 重放 A 的成绩。A 先写失败时返回 `503` 并将 B 正在处理的轮次改为 `failed`，B 手握有效评分却收到 `409 STATE_CONFLICT`，最终成绩数为 0。成功、失败写入均只检查轮次状态，未校验本次认领仍有效。[租约接管](../../../backend/app/services/roleplay.py#L410) · [失败写入](../../../backend/app/services/roleplay.py#L489) · [成绩写入](../../../backend/app/services/roleplay.py#L534)
- 复验条件是在成绩和失败状态的落库事务内校验本次认领标识。在 MySQL 8.4 覆盖接管后旧请求分别返回成功和失败的时序，确认两者均无法改变轮次、成绩或补训状态。有效的新请求须能完成同一轮，最终只保留一条成绩并可同键重放。

## QoderCN 二次返工记录 · 2026-11-23

- 认领：2026-11-23，QoderCN，`qoder`。
- 返工变更：
  - `backend/app/services/roleplay.py`：`_RoundWork` 携带本次 `lease_started_at`；新增认领比较与冲突错误。
  - `_persist_attempt` 在状态校验后、写成绩前校验认领；`_mark_round_failed` 在写失败前校验认领。租约被接管时旧请求返回 `409 SCORING_IN_PROGRESS`，不修改轮次或成绩。
  - `backend/tests/test_roleplay.py`：覆盖接管后旧请求分别“评分成功”和“评分失败”两条路径，并验证新请求仍可完成同一轮。
  - `backend/README.md`：补充评分租约写入约束。
- 验证命令与结果：
  - `cd backend && uv run pytest -q`：**75 passed**。
  - `uv run python -m compileall -q app tests alembic`：通过；改动文件 E/F lint 通过。
  - Docker `mysql:8.4.13`：暂停旧请求在成绩落库前，更新认领模拟新请求接管；旧请求成功/失败两条路径均返回 `409 SCORING_IN_PROGRESS`，轮次保持 `scoring` 且该轮成绩数为 0。
  - 将租约恢复为过期后，用同一 `client_round_id` 重试均得到 `201`、99 分，每轮只有一条成绩；两轮共 2 条成绩。
  - 本次没有新增迁移或 DDL；临时 MySQL 8.4 容器已停止并自动移除。
- 未验证：前端 T006/T007；真实模型提供方。M1 仍使用确定性替身。

## Codex 二次复验 · 2026-11-23

**通过，标记为已完成。** 复验基线 `3f1057c` 已纳入 `qoder` 共享分支，75 项后端测试全通过。

- 在 MySQL 8.4.13 上让旧请求暂停在成功或失败落库之前，推进应用时钟使租约过期，再用同一 `client_round_id` 发起真实 API 请求接管。两条路径中旧请求均返回 `409 SCORING_IN_PROGRESS`，新请求均返回 `201` 并完成原轮次。每轮只有一条正式成绩，成功路径的同键重放返回相同成绩。
- 对练中断并重建应用实例后，租约有效期内正常返回 `409`，实际等待 31 秒后可恢复同一轮。历史不兼容规则的预览与正式评分均返回 `422` 且无成绩残留，恢复规则后同键重试通过。四个评分样本和冻结补训证据的回归通过。
- MySQL 8.4.13 迁移升降级、空库重建和种子验证通过。M1 验收使用确定性评分替身。
