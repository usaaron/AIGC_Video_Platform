# 13_Orchestrator

负责融合所有资产。

检查：
- 一致性
- 风格
- 人设
- 平台规则
输出：
`OrchestrationPlan`

## 当前阶段约束

当前阶段 Orchestrator 的主要职责是：

- 基于 `ContentSpec`
- 融合平台规则
- 融合受控标签与相关资产
- 为 Script Engine 组织生成输入

当前阶段输出应服务于 `MasterScript` 生成，而不是直接承担视频侧职责。

## 当前最小实现

当前最小实现中，Orchestrator 输出结构化 `OrchestrationPlan`，其中包含：

- asset_requests
- script_constraints
- scene_blueprints

这些数据将作为后续 Retrieval Engine 与 Script Engine 的受控输入。

当前最小实现说明：

- Orchestrator 当前先负责把 `ContentSpec` 转成结构化 `asset_requests`
- Retrieval Engine 当前再根据这些请求返回候选 `Asset`
- 后续如需更强一致性融合，再在 orchestration stage 上继续增强
