# T007 总部 PC 与店长 H5

仅 Antigravity App 可领取和实现。前置任务为 T006。后端实现期间可使用已审契约和 Mock。 [任务看板](../board.md)

## 目标与范围

维护 `frontend/` 中的总部、店长视图及各自路由模块。沿用 T006 的会话、公共 API 层和路由扩展方式。查阅 `vue-best-practices`。 [项目 Skills](../../../.agents/skills/README.md)

## 交付与验收

- [x] 总部 PC 页能查看及审校新品草稿、核对目标门店和截止时间、提交发布并查看结果。
- [x] 店长 H5 能查看授权店员的培训进度、48 小时统计与卡点，可指派补训、查看复练证据、确认待复查结果。
- [x] 权限失败、重复提交及状态冲突有可理解的反馈。用桌面视口和移动视口走通各自路径，记录结果供 T008 联调使用。

## 交付记录

- **认领**：2026-11-24，Antigravity App，`feat/t007-operations-ui`（基于 T006 返工提交 `feat/t006-employee-h5@e5712d6`）。
- **变更文件**：
  - `frontend/src/types/api.ts`：补齐 M1 v1.0 契约总部（§6.5）、店长（§6.7）及 48 小时统计（§6.8）全量 `snake_case` 类型与评分规则类型。
  - `frontend/src/api/client.ts`、`hq.ts`、`manager.ts`、`src/utils/errors.ts`、`src/utils/hqReleases.ts`：扩展 `httpRequest` 响应头读取钩子以识别 `Idempotent-Replay: true`；实现总部 10 项接口与店长 7 项接口（`mock` / `real` 双模式同契约分发，发布/补训/复查携带 `Idempotency-Key`）；统一将 403/404/409/422 契约错误码映射为中文提示、恢复引导与刷新入口。
  - `frontend/src/mock/seed.ts`、`server.ts`、`helpers.ts`、`hq.ts`、`manager.ts`：扩展持久化 Mock 服务端，新增待审校新品草稿 `crs_thermos`（不生成任务，不影响员工端初始基线）、升级员工端动态读取绑定课程版本内容与评分规则，完整实现修订号乐观锁、三项审校清单、不可变版本与 `superseded` 替代、`Idempotency-Key` 幂等重放与复用拒绝、跨店 404 隔离、补训单开与证据冻结核验、左闭右开 48 小时统计及空名单 `rate=null` 口径。
  - `frontend/src/components/ReleaseStatsCard.vue`、`HqDraftEditor.vue`、`HqReviewPublishPanel.vue`、`ManagerRetrainReviewCard.vue`：共享 48 小时统计卡（空名单显示「暂无应训人员」）、总部草稿编辑与评分规则核对组件、总部审校清单与定向发布面板（自动维护并按改参轮换幂等键）、店长冻结复练证据核验与补训/复查操作卡。
  - `frontend/src/router/hqRoutes.ts`、`managerRoutes.ts`、`src/views/hq/HqDashboardView.vue`、`HqCourseWorkbenchView.vue`、`HqReleaseDetailView.vue`、`src/views/manager/ManagerHomeView.vue`、`ManagerAssignmentDetailView.vue`：替换 T006 占位页（移除 `src/views/stubs/`），交付总部 PC 端工作台、草稿审校发布页、发布批次结果与 48 小时统计页，以及店长 H5 端进度统计看板、店员复练证据核验、补训指派与复查确认页。
  - `frontend/README.md`：更新总部与店长路由约定及 T008 联调说明。
  - `frontend/tests/operations-mock.spec.ts`、`hq-flow.spec.ts`、`manager-flow.spec.ts`、`http-client.spec.ts`：新增总部/店长契约单测、双角色组件集成测试及真实 HTTP `Idempotency-Key` / `Idempotent-Replay` 校验。
- **提交 / PR**：`feat/t007-operations-ui` 分支代码提交 `f391c6c`。
- **自动化验证命令与结果**：
  - `cd frontend && npm run typecheck`：通过（`vue-tsc --noEmit` 零错误）。
  - `cd frontend && npm test`：**9 个测试文件、27 项测试全部通过**（含既有 T006 19 项回归 + 新增 8 项 T007 契约、权限、幂等、乐观锁冲突与三角色闭环测试）。
  - `cd frontend && npm run build` & `npm run build:real`：Mock 与 Real 双模式生产构建均成功。
- **双视口内置浏览器实测结果（`http://127.0.0.1:5173/`，Mock 模式）**：
  - **桌面视口（1280×800）总部 PC 路径**：以「林敏（`usr_linmin`）」登录 `/hq` -> 进入 `crs_thermos` 编辑保存草稿（修订 `#1`→`#2`）-> 验证未全勾清单触发 `REVIEW_CHECKLIST_INCOMPLETE` 反馈 -> 勾选三项清单审校通过（显示审校人及时间）-> 选定北京路旗舰店 + 佛山祖庙百货店与 72 小时截止提交发布（生成 `rls_mock_11`，应训 5 人）-> 同键再次点击确认命中幂等重放提示且未重复建批 -> 进入 `/hq/releases/rls_mock_11` 核对 48h 统计（`0 / 5`）与 5 人应训名单快照 -> 地址栏直访 `/manager` 成功触发越权拦截并回到 `/hq`。
  - **移动视口（390×844）店长 H5 与跨角色闭环路径**：先以员工「陈阿杰（`usr_chenajie`）」完成同义表达复练（91 分通关，推进至「已改正待复查」）-> 切换店长「李明（`usr_liming`）」登录 `/manager`，验证移动端无横向溢出（宽 390px）、待办提醒横幅（待复查 1 人）、Chiikawa 批次 48h 统计 `1 / 3`（`33.3%`）与授权店员列表 -> 进入陈阿杰详情页核对第 2 轮冻结复练证据（「端盒六个不重样」命中证据）并确认复查通过 -> 验证状态更新为「复查通过」且审计轨迹新增操作人「李明」记录 -> 验证无成绩员工王晓雪详情提示 `NO_ATTEMPT` -> 直访越权/不存在任务 `asg_other_store_404` 清晰展示 `404 NOT_FOUND` 与返回入口；全程零 `console.error` / `pageerror`。
- **尚未验证项 / 交接 T008 说明**：
  - 真实后端三角色在线联调（含 T005 店长补训、复查与 48h 统计 API 及 MySQL 8.4）留待 T005 合并后的 T008 端到端联调验收。`/hq/releases/:releaseId` 已针对 T005 统计接口未部署时的 404 做降级摘要展示，T005 上线后无需修改前端即可展示完整分门店 48h 统计。
- **Codex 验收结论**：待验收。
