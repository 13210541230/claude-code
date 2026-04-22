import type { PermissionMode } from '../permissions/PermissionMode.js'
import type { EffortValue } from '../effort.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_ALIASES, type ModelAlias, isModelAlias } from './aliases.js'
import { applyBedrockRegionPrefix, getBedrockRegionPrefix } from './bedrock.js'
import { getCanonicalName, parseUserSpecifiedModel } from './model.js'
import { getModelOptions } from './modelOptions.js'
import { getAPIProvider } from './providers.js'
import { validateModel } from './validateModel.js'

export const AGENT_MODEL_OPTIONS = [...MODEL_ALIASES, 'inherit'] as const
export type AgentModelAlias = (typeof AGENT_MODEL_OPTIONS)[number]

export type AgentModelOption = {
  value: AgentModelAlias
  label: string
  description: string
}

/**
 * Get the default subagent model. Returns 'inherit' so subagents inherit
 * the model from the parent thread.
 */
export function getDefaultSubagentModel(): string {
  return 'inherit'
}

/**
 * Get the effective model string for an agent.
 *
 * For Bedrock, if the parent model uses a cross-region inference prefix (e.g., "eu.", "us."),
 * that prefix is inherited by subagents using alias models (e.g., "sonnet", "haiku", "opus").
 * This ensures subagents use the same region as the parent, which is necessary when
 * IAM permissions are scoped to specific cross-region inference profiles.
 */
export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: string,
  permissionMode?: PermissionMode,
): string {
  if (process.env.CLAUDE_CODE_SUBAGENT_MODEL) {
    return parseUserSpecifiedModel(process.env.CLAUDE_CODE_SUBAGENT_MODEL)
  }

  // Extract Bedrock region prefix from parent model to inherit for subagents.
  // This ensures subagents use the same cross-region inference profile (e.g., "eu.", "us.")
  // as the parent, which is required when IAM permissions only allow specific regions.
  const parentRegionPrefix = getBedrockRegionPrefix(parentModel)

  // Helper to apply parent region prefix for Bedrock models.
  // `originalSpec` is the raw model string before resolution (alias or full ID).
  // If the user explicitly specified a full model ID that already carries its own
  // region prefix (e.g., "eu.anthropic.…"), we preserve it instead of overwriting
  // with the parent's prefix. This prevents silent data-residency violations when
  // an agent config intentionally pins to a different region than the parent.
  const applyParentRegionPrefix = (
    resolvedModel: string,
    originalSpec: string,
  ): string => {
    if (parentRegionPrefix && getAPIProvider() === 'bedrock') {
      if (getBedrockRegionPrefix(originalSpec)) return resolvedModel
      return applyBedrockRegionPrefix(resolvedModel, parentRegionPrefix)
    }
    return resolvedModel
  }

  // Prioritize tool-specified model if provided
  const normalizedToolSpecifiedModel = toolSpecifiedModel?.trim()
  if (normalizedToolSpecifiedModel) {
    if (normalizedToolSpecifiedModel === 'inherit') {
      return parentModel
    }
    if (isModelAlias(normalizedToolSpecifiedModel)) {
      if (aliasMatchesParentTier(normalizedToolSpecifiedModel, parentModel)) {
        return parentModel
      }
      const model = parseUserSpecifiedModel(normalizedToolSpecifiedModel)
      return applyParentRegionPrefix(model, normalizedToolSpecifiedModel)
    }
    return applyParentRegionPrefix(
      normalizedToolSpecifiedModel,
      normalizedToolSpecifiedModel,
    )
  }

  const agentModelWithExp = agentModel ?? getDefaultSubagentModel()

  if (agentModelWithExp === 'inherit') {
    return parentModel
  }

  if (aliasMatchesParentTier(agentModelWithExp, parentModel)) {
    return parentModel
  }
  const model = parseUserSpecifiedModel(agentModelWithExp)
  return applyParentRegionPrefix(model, agentModelWithExp)
}

/**
 * Check if a bare family alias (opus/sonnet/haiku) matches the parent model's
 * tier. When it does, the subagent inherits the parent's exact model string
 * instead of resolving the alias to a provider default.
 *
 * Prevents surprising downgrades: a Vertex user on Opus 4.6 (via /model) who
 * spawns a subagent with `model: opus` should get Opus 4.6, not whatever
 * getDefaultOpusModel() returns for 3P.
 * See https://github.com/anthropics/claude-code/issues/30815.
 *
 * Only bare family aliases match. `opus[1m]`, `best`, `opusplan` fall through
 * since they carry semantics beyond "same tier as parent".
 */
function aliasMatchesParentTier(alias: string, parentModel: string): boolean {
  const canonical = getCanonicalName(parentModel)
  switch (alias.toLowerCase()) {
    case 'opus':
      return canonical.includes('opus')
    case 'sonnet':
      return canonical.includes('sonnet')
    case 'haiku':
      return canonical.includes('haiku')
    default:
      return false
  }
}

export function getAgentModelDisplay(model: string | undefined): string {
  // When model is omitted, getDefaultSubagentModel() returns 'inherit' at runtime
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return capitalize(model)
}

export function resolveAgentEffortValue(
  toolSpecifiedEffort: EffortValue | undefined,
  agentDefinedEffort: EffortValue | undefined,
  parentEffort: EffortValue | undefined,
): EffortValue | undefined {
  if (toolSpecifiedEffort !== undefined) {
    return toolSpecifiedEffort
  }
  if (agentDefinedEffort !== undefined) {
    return agentDefinedEffort
  }
  return parentEffort
}

export async function validateAgentToolModelInput(
  toolSpecifiedModel: string | undefined,
): Promise<{ normalizedModel: string | undefined }> {
  const normalizedModel = toolSpecifiedModel?.trim()
  if (normalizedModel === undefined) {
    return { normalizedModel: undefined }
  }

  if (normalizedModel.length === 0) {
    throw new Error('Model name cannot be empty')
  }

  if (normalizedModel === 'inherit') {
    return { normalizedModel }
  }

  const validation = await validateModel(normalizedModel)
  if (!validation.valid) {
    const visibleModels = getModelOptions()
      .map(option => option.value)
      .filter((value): value is string => value !== null)
    const preview = visibleModels.slice(0, 8).join(', ')
    const hint =
      preview.length > 0
        ? ` Available models include: ${preview}.`
        : ''
    throw new Error(
      `Invalid subagent model '${normalizedModel}': ${validation.error ?? 'unknown validation error'}. Run /model to inspect or set an available model.${hint}`,
    )
  }

  return { normalizedModel }
}

/**
 * Get available model options for agents
 */
export function getAgentModelOptions(): AgentModelOption[] {
  return [
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Balanced performance - best for most agents',
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Most capable for complex reasoning tasks',
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fast and efficient for simple tasks',
    },
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]
}
