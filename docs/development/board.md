# 任务看板

当前里程碑为 **M1 本地三角色闭环**。任务按依赖解锁，状态和认领以本表为准。「开放」表示满足前置条件的 Agent 可领取，「Antigravity App 专属」表示只由该 Agent 领取和实现。 [领取与交付规则](README.md) · [路线图](roadmap.md)

| 任务 | 负责范围 | 前置任务 | 状态 | 领取资格 | 承接 Agent | 分支 / 工作树 | 更新时间 | 交付 / 阻塞说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [T001](tasks/T001-contract.md) | 身份、业务状态及接口契约 | — | 已完成 | 开放 | QoderCN / Codex 验收 | qoder | 2026-11-23 | v1.0 契约已验收，已纳入 qoder 基线；原型重构与 AGENTS/skills 未包含 |
| [T002](tasks/T002-backend-foundation.md) | 后端、数据库及会话底座 | T001 | 已完成 | 开放 | QoderCN / Codex 验收 | qoder | 2026-11-23 | `3bc9489` 已纳入 qoder 基线；Codex 独立复跑 32 项测试及 MySQL 8.4.13，四项返工通过 |
| [T003](tasks/T003-course-delivery.md) | 审校发布与员工学习 API | T002 | 待验收 | 开放 | QoderCN / Codex 验收 | qoder | 2026-11-23 | 审校发布、版本克隆、幂等发布与员工学习 API 已完成；50 项测试通过，MySQL 并发/幂等已验证，详见任务卡 |
| [T004](tasks/T004-roleplay.md) | 对练、评分及复练回写 | T002 | 待领取 | 开放 | — | — | 2026-11-23 | T002 已验收 |
| [T005](tasks/T005-store-review.md) | 店长补训、复查及统计 API | T002 | 待领取 | 开放 | — | — | 2026-11-23 | T002 已验收 |
| [T006](tasks/T006-employee-h5.md) | Vue 公共入口与员工 H5 | T001 | 待领取 | Antigravity App 专属 | — | — | 2026-11-23 | T001 已验收；仅 Antigravity App 可领取 |
| [T007](tasks/T007-operations-ui.md) | 总部 PC 与店长 H5 | T006 | 排队 | Antigravity App 专属 | — | — | — | — |
| [T008](tasks/T008-e2e.md) | 三角色闭环联调与验收 | T003、T004、T005、T007 | 排队 | 开放 | — | — | — | — |

| 状态 | 含义 |
| --- | --- |
| 排队 | 前置任务尚未验收完成 |
| 待领取 | 前置条件已满足，尚未认领 |
| 进行中 | 已登记承接者，实施或返工中 |
| 待验收 | 已填写交付记录，等待 Codex 验收 |
| 已完成 | Codex 已验收且交付已纳入共享基线 |
| 阻塞 | 填写阻塞原因、恢复条件和需要协作的事项 |

更新时间填 `YYYY-MM-DD`。涉及多个阶段的任务按交付边界拆卡。 [任务卡模板](tasks/TEMPLATE.md)
