# MINISO 门店培训项目协作规范

本文件适用于项目根目录及其子目录的开发、审查和联调。产品范围以 [PRD](PRD.md) 与用户已确认的试点要求为准。现有 `index.html`、`app.js`、`server.js` 用于核对原型交互和业务规则。

## 工程化技术栈

- 前端采用 Vue 3、TypeScript、Vite、Vue Router。员工和店长通过企业微信工作台进入 H5，总部使用 PC 网页。
- 后端采用 Python 3.13、FastAPI、Pydantic 2，提供同域 HTTPS 下的 `/api/v1` REST 接口，使用服务端会话。需要流式回复时使用 SSE。
- AI 流程由 LangGraph `StateGraph` 编排，LangChain 组件负责模型接入和结构化输出。首期每轮从 MySQL 读取已保存的上下文，运行一次短流程，按已保存的对话轮次恢复。
- 业务数据使用 MySQL 8.4 LTS 和 InnoDB，应用侧使用 SQLAlchemy 2、`aiomysql` 及 Alembic。

## 按任务使用的 Skills

改动或审查以下模块时，按表查阅相应技能。优先读取本地可用的同名 `SKILL.md`，也可按表读取 GitHub 原文和相关章节。以本项目选型、业务规则和依赖版本为准，按需采用上游示例。

| 优先级 | Skill | 应用场景 | 上游来源 |
| --- | --- | --- | --- |
| 首选 | `fastapi` | 路由分组、Pydantic 请求与响应、身份依赖、SSE。ORM 使用项目已选定的 SQLAlchemy 2。 | [FastAPI 官方](https://github.com/fastapi/fastapi/blob/master/fastapi/.agents/skills/fastapi/SKILL.md) |
| 首选 | `langchain-build-agent` | 顾客对话流程、图状态、结构化评分证据。使用当前技能入口，旧资料可能称作 `langgraph-fundamentals`。 | [LangChain 官方](https://github.com/langchain-ai/langchain-skills/blob/main/skills/langchain-build-agent/SKILL.md) |
| 首选 | `mysql-patterns` | 审查事务边界、并发与锁、幂等约束、门店与发布批次的查询索引。 | [ECC 社区](https://github.com/affaan-m/ECC/blob/main/skills/mysql-patterns/SKILL.md) |
| 按需 | `sqlalchemy`、`alembic` | 会话生命周期、连接池及迁移脚本审查。按本项目的 MySQL 8.4 和 `aiomysql` 核对示例。 | [SQLAlchemy 技能](https://github.com/bm629/agent-skills/blob/main/skills/sqlalchemy/SKILL.md)、[Alembic 技能](https://github.com/bm629/agent-skills/blob/main/skills/alembic/SKILL.md) |
| 按需 | `langchain-agent-experiments` | 用人工标注的正确、漏讲、同义表达、事实错误样本回归评分。使用其 LangSmith 实验流程时按环境配置。 | [LangChain 官方](https://github.com/langchain-ai/langchain-skills/blob/main/skills/langchain-agent-experiments/SKILL.md) |
| 按需 | `wecom-auth` | 企业微信自建应用 H5 网页授权与总部 PC 扫码登录。可信域名、回调及接口参数以企微官方文档为准。 | [Open-Wecom-Skills 社区](https://github.com/OmniSocKit/Open-Wecom-Skills/blob/main/skills/enterprise/wecom-auth.md) |
| 按需 | `vue-best-practices` | 将原型迁移到 Vue 3 时参考组件拆分、组合式 API、TypeScript 和状态管理。 | [Vue 社区](https://github.com/vuejs-ai/skills/blob/main/skills/vue-best-practices/SKILL.md) |

## 项目实现与审查约定

- **授权与发布。** 企微用于确认身份。FastAPI 按服务端会话、角色、门店成员关系与发布范围鉴权。总部人工审校并发布，员工只读取面向所属门店的已发布课程，店长只处理有权限的门店。保留发布和复查的操作人及时间。
- **评分与补训。** 按发布时绑定的课程和评分规则版本核验模型给出的命中项、缺失项和证据，由 Python 业务层计算正式成绩并推进状态。复练仍漏讲时保留待办，补齐后进入待复查，店长确认后完成。答疑使用已发布的商品知识，未覆盖的事实按 PRD 口径回应。
- **事务与会话恢复。** 模型调用放在数据库事务外。核验后在短事务内写入正式成绩并更新补训状态，保证重复提交返回同一份结果。通过已落库的对话轮次恢复会话。
- **试点统计。** 48 小时指标以服务端发布时间和发布批次的应训名单计算。原型课程可作为测试数据，正式成绩从新系统起算。

## 首个工程化验收

用一款新品、两家门店和总部、员工、店长三个角色，走通审校发布、学习、对练、补训与复查。

- 验证草稿与非目标门店隔离，并检查直接访问接口时的角色与门店权限。
- 验证刷新或服务重启后可以继续已保存的对练，重复提交只产生一份正式成绩，并发更新互不覆盖。
- 用「端盒 6 个不重复」覆盖正确、漏讲、同义表达和事实错误。验证补训待办、待复查、店长确认与审计记录。
- 验证应训名单与 48 小时时间窗口。本地可用可重复的模型替身验证业务流转，企微联调时在 iOS 和 Android 客户端验证工作台入口、登录与语音。

## Context7 文档查询

涉及库、框架、SDK、API、CLI 或云服务的用法、配置、版本与排错时，用 Context7 CLI 查当前文档。一般重构、从零编写脚本、业务逻辑排错、代码审查和通用编程概念无需触发此步骤。

1. 先运行 `npx ctx7@latest library <名称> "<具体问题>"`，选择与官方项目和任务最匹配的 ID。已提供明确 `/org/project` ID 时直接查文档。
2. 运行 `npx ctx7@latest docs <libraryId> "<具体问题>"`，涉及特定版本时使用匹配的版本 ID。每个问题最多运行三条命令，查询内容应去除密钥、口令及凭据。
3. 在默认沙箱外运行 Context7 查询并遵循当前审批机制。遇配额限制时说明情况，并提示 `npx ctx7@latest login` 或设置 `CONTEXT7_API_KEY`。
