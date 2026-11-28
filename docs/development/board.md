# 任务看板

**M1 本地三角色闭环已于 2026-11-28 完成。**任务按依赖解锁，状态和认领以本表为准。「开放」表示满足前置条件的 Agent 可领取，「Antigravity App 专属」表示只由该 Agent 领取和实现。 [领取与交付规则](README.md) · [路线图](roadmap.md)

| 任务 | 负责范围 | 前置任务 | 状态 | 领取资格 | 承接 Agent | 分支 / 工作树 | 更新时间 | 交付 / 阻塞说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [T001](tasks/T001-contract.md) | 身份、业务状态及接口契约 | — | 已完成 | 开放 | QoderCN / Codex 验收 | qoder | 2026-11-23 | v1.0 契约已验收，已纳入 qoder 基线；原型重构与 AGENTS/skills 未包含 |
| [T002](tasks/T002-backend-foundation.md) | 后端、数据库及会话底座 | T001 | 已完成 | 开放 | QoderCN / Codex 验收 | qoder | 2026-11-23 | `3bc9489` 已纳入 qoder 基线；Codex 独立复跑 32 项测试及 MySQL 8.4.13，四项返工通过 |
| [T003](tasks/T003-course-delivery.md) | 审校发布与员工学习 API | T002 | 已完成 | 开放 | Codex / Antigravity App 复验 | integration/m1-consolidated (qoder) | 2026-11-27 | `1c3c1ac` 已通过 Codex 与 2026-11-25 独立 MySQL 8.4.13 复验（共 76 项），已纳入 `integration/m1-consolidated` 整合基线（`origin/qoder` 待后续同步） |
| [T004](tasks/T004-roleplay.md) | 对练、评分及复练回写 | T002 | 已完成 | 开放 | QoderCN / Codex 验收 | integration/m1-consolidated (qoder) | 2026-11-23 | `3f1057c` 已纳入共享基线与 `integration/m1-consolidated`。Codex 独立复跑 75 项测试及 MySQL 8.4.13，旧评分请求接管后成功和失败写入均被拒绝 |
| [T005](tasks/T005-store-review.md) | 店长补训、复查及统计 API | T002 | 已完成 | 开放 | Antigravity App | integration/m1-consolidated (feat/t005-store-review) | 2026-11-27 | `e8b196d` 经 Codex 2026-11-25 复验通过（MySQL 并发补训、12 轮冻结证据与 H5 复查闭环），已通过 `0167864` 纳入 `integration/m1-consolidated` |
| [T006](tasks/T006-employee-h5.md) | Vue 公共入口与员工 H5 | T001 | 已完成 | Antigravity App 专属 | Antigravity App | integration/m1-consolidated (feat/t006-employee-h5) | 2026-11-27 | `908fc80` / `e5712d6` 经 Codex 复验通过（19 项测试、双模式构建及移动端回归通过），已随 `feat/t007-operations-ui` 纳入 `integration/m1-consolidated` |
| [T007](tasks/T007-operations-ui.md) | 总部 PC 与店长 H5 | T006 | 已完成 | Antigravity App 专属 | Antigravity App | integration/m1-consolidated (feat/t007-operations-ui) | 2026-11-27 | `fa52694` 与 T005 P2 联动提交 `f7b874b` 均已复验通过（37 项测试与双模式构建通过），已纳入 `integration/m1-consolidated` |
| [T008](tasks/T008-e2e.md) | 三角色闭环联调与验收 | T003、T004、T005、T007 | 已完成 | 开放 | Antigravity App / Codex 验收 | feat/t008-e2e | 2026-11-28 | `62476e8` 通过独立 MySQL 8.4.13 三套实库、前后端回归及三角色页面抽验，实测进程重启后恢复 3 轮。交付及验收记录 `5e2259a` 已纳入 `integration/m1-consolidated` |

| 状态 | 含义 |
| --- | --- |
| 排队 | 前置任务尚未验收完成 |
| 待领取 | 前置条件已满足，尚未认领 |
| 进行中 | 已登记承接者，实施或返工中 |
| 待验收 | 已填写交付记录，等待 Codex 验收 |
| 已验收（待整合） | Codex 已验收任务分支，交付待纳入共享基线 |
| 已完成 | Codex 已验收且交付已纳入共享基线 |
| 阻塞 | 填写阻塞原因、恢复条件和需要协作的事项 |

更新时间填 `YYYY-MM-DD`。涉及多个阶段的任务按交付边界拆卡。 [任务卡模板](tasks/TEMPLATE.md)
