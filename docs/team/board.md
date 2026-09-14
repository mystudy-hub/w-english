# 任务看板 — 韦氏儿童英语 Web 学习平台

> 最后更新: 2026-09-10T07:33Z | Leader 独占写入，增量更新

## 任务状态

| 任务 | 负责人 | 状态 | 产物路径 | 轮次 | 最后更新 | 备注 |
|:---|:---|:---|:---|:---|:---|:---|
| PRD-0 | product_owner | DOING | docs/PRD.md | 1 | 2026-09-10T07:33 | leader 已派发，PO 正在提取 PRD |
| ARCH-0 | architect | DOING | docs/api-contract.md | 1 | 2026-09-10T07:33 | leader 已派发，可先预研，待 PRD 冻结后对齐 |
| UX-0 | ux_designer | BLOCKED | docs/design-spec/*.md | 1 | 2026-09-10T07:33 | 已预研 PROJECT_PLAN，等待 PRD 冻结后产出
| FE-0 | frontend_coder | BLOCKED | - | 1 | - | 等待 PRD/API/设计规范冻结 |
| BE-0 | backend_coder | BLOCKED | - | 1 | - | 等待 PRD/API 冻结 (Dexie/schema/算法/SW/脚本) |
| DEVOPS-0 | devops | BLOCKED | - | 1 | - | 等待 API 契约冻结 + 前后端脚手架落盘 |
| QA-0 | qa_reviewer | BLOCKED | - | 1 | - | 等待前后端 + DevOps 交付 |
| LEADER-0 | leader | DOING | docs/team/board.md | 1 | 2026-09-10T07:32 | 初始化看板，协调 Phase 1 |

## 阶段定义

- **Phase 1 (冻结期)**: PRD-0 → ARCH-0 → UX-0，三者冻结后进入 Phase 2
- **Phase 2 (并行编码)**: FE-0 ∥ BE-0，落盘后 DevOps 集成
- **Phase 3 (验收)**: QA-0 审查，leader 闭环

## 契约冻结状态

- [ ] docs/PRD.md 冻结
- [ ] docs/api-contract.md 冻结
- [ ] docs/design-spec/*.md 冻结