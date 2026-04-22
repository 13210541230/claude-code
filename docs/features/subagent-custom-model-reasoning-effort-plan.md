# Subagent 自定义模型与 reasoning_effort 方案

## 1. 目标与边界

### 1.1 目标
- 允许 `AgentTool` / subagent 调用方显式指定自定义 `model`（不再仅限 `sonnet|opus|haiku`）。
- 允许调用方显式指定 `reasoning_effort`，并在模型能力允许时透传给子代理。
- 保持与现有 `/model` 列表、Provider 选择与 alias 机制一致，不引入绕过路径。

### 1.2 非目标
- 不改动默认模型选择策略（未显式指定 `model` 时保持当前行为）。
- 不在本阶段新增新的模型发现来源（仅复用现有模型注册/可见性来源）。
- 不调整跨 Provider 的计费、配额、限流策略。

## 2. 现状与差距

## 2.1 现状
- `AgentTool` 入参 schema 仍将 `model` 限定为枚举（`sonnet|opus|haiku`），导致无法输入 `/model` 中的其他可见模型。
- 下游 `getAgentModel` 已支持 `toolSpecifiedModel?: string` 的解析路径，说明底层具备字符串模型处理能力。
- `reasoning_effort` 在 subagent 场景尚未形成“输入校验 -> 能力判定 -> 透传”的完整链路。

## 2.2 差距
- 入口约束与底层能力不一致：入口过窄。
- `reasoning_effort` 缺少统一 gate（模型不支持时的降级/拒绝策略需明确）。

## 3. 方案设计

## 3.1 阶段 A：开放 model 入参并复用现有校验链
- 将 `AgentTool` 的 `model` schema 从固定 enum 改为字符串输入（可空）。
- V1 模型准入规则（写死）：复用 `/model <arg>` 的完整校验链，最终以 `validateModel()` 结果为准。
- `getModelOptions()` 仅作为“候选可见列表”与错误提示来源，不作为最终真值。
- 校验失败策略：返回明确可操作错误（含失败原因与建议：先执行 `/model` 查看/设置模型）。
- 向后兼容：`sonnet|opus|haiku` 仍可作为合法字符串使用，语义不变。

## 3.2 阶段 B：接入 reasoning_effort
- 在工具 schema 增加 `reasoning_effort` 可选字段（值域与主流程一致）。
- 进入 subagent 创建前执行能力判定：
  - 若模型支持 effort：按用户指定透传。
  - 若模型不支持 effort：V1 固定为“与当前 API 层一致的静默忽略”。
- 可观测性：将最终生效参数写入 debug/trace，固定字段为 `requestedModel`、`resolvedModel`、`requestedEffort`、`appliedEffort`、`effortDroppedReason`。
- V1 不引入“严格报错”策略，避免新增行为分叉；严格模式延期到后续版本评估。

## 3.3 参数优先级
- `reasoning_effort` 优先级：`subagent 显式 effort` > `agent 定义/frontmatter effort` > `父 agent 显式 effort(state.effortValue)` > `系统默认`。
- `model` 优先级：`subagent 显式 model` > `agent 定义/frontmatter model` > `父 agent 当前模型上下文` > `系统默认映射`。
- 若 `model` 被显式指定，则 `reasoning_effort` 的支持性以该模型为准。

## 3.4 兼容与回退
- Feature Flag：`CLAUDE_CODE_SUBAGENT_CUSTOM_MODEL_EFFORT`（默认关闭，灰度开启）。
- 关闭开关后，行为完全回退到当前主线逻辑。

## 4. 风险评估与防护

## 4.1 主要风险
- 风险 R1：传入未注册模型导致运行时失败。
- 风险 R2：不支持 effort 的模型被透传 effort 导致 API 报错。
- 风险 R3：不同 Provider 下 alias 映射语义漂移。

## 4.2 防护措施
- M1：入口复用 `/model <arg>` 校验链（`getModelOptions()` 候选 + `validateModel()` 真值校验）。
- M2：统一 `modelSupportsEffort` 判定并在发送请求前 gate。
- M3：补充 alias + tier 继承回归测试，确保已有行为不回归。

## 5. 验收标准

- AC1：可使用 `/model` 中任一可见模型启动 subagent。
- AC2：`sonnet|opus|haiku` 旧调用方式全兼容。
- AC3：支持 effort 的模型可正确应用 `reasoning_effort`。
- AC4：不支持 effort 的模型按 V1 规则静默忽略，且 debug/trace 可见 `effortDroppedReason`。
- AC5：全量测试通过，且新增/修改测试覆盖上述分支。

## 6. 测试计划

## 6.1 单元测试
- `AgentTool` schema 与参数解析测试（合法/非法模型、空值、拼写错误）。
- `reasoning_effort` gate 测试（支持/不支持/未指定）。
- 参数优先级测试（subagent、frontmatter、父级三层覆盖）。
- Feature Flag 开/关测试（开关关闭时完全回退旧路径）。

## 6.2 集成测试
- 端到端验证：`/model` 列出的可见模型可被 subagent 成功使用。
- Provider 差异验证：至少覆盖 firstParty + 一个兼容 Provider。
- 非法模型分支：subagent 显式传入非法模型时返回可操作错误。
- 后台/恢复路径：后台 agent 与会话恢复场景下参数语义一致。

## 6.3 回归测试
- 现有 agent tool、task tool、model alias、frontmatter effort 相关回归集。
- 全量 `bun test` 作为合并门禁。

## 7. 实施步骤（审查通过后执行）

1. 调整 `AgentTool` schema 与参数对象定义。
2. 复用现有模型可见性来源，增加入口校验函数。
3. 接入 `reasoning_effort` 字段与能力 gate。
4. 补充单测/集测并执行全量测试。
5. 灰度开关验证后再默认启用（或保持开关受控）。

## 8. 回滚策略

- 软回滚：关闭 `CLAUDE_CODE_SUBAGENT_CUSTOM_MODEL_EFFORT`。
- 硬回滚：回退本特性提交，不影响既有 `sonnet|opus|haiku` 路径。

## 9. 审查门禁（必须通过）

- 门禁 G1：设计审查结论为 PASS（无阻断项）。
- 门禁 G2：实现后测试门禁通过（全量 0 fail）。
- 门禁 G3：兼容性检查通过（旧调用脚本无需改动）。
