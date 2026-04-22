import { beforeEach, describe, expect, mock, test } from 'bun:test'

let validationResult: { valid: boolean; error?: string } = { valid: true }
let validateCalls: string[] = []
let mockModelOptions = [
  {
    value: 'sonnet',
    label: 'Sonnet',
    description: 'Balanced performance',
  },
  {
    value: 'claude-sonnet-4-6-20250514',
    label: 'Claude Sonnet 4.6',
    description: 'Full model id',
  },
]

mock.module('../validateModel.js', () => ({
  validateModel: async (model: string) => {
    validateCalls.push(model)
    return validationResult
  },
}))

mock.module('../modelOptions.js', () => ({
  getModelOptions: () => mockModelOptions,
}))

const { validateAgentToolModelInput, resolveAgentEffortValue } = await import(
  '../agent.js'
)

describe('validateAgentToolModelInput', () => {
  beforeEach(() => {
    validationResult = { valid: true }
    validateCalls = []
  })

  test('returns undefined when model is omitted', async () => {
    await expect(validateAgentToolModelInput(undefined)).resolves.toEqual({
      normalizedModel: undefined,
    })
    expect(validateCalls).toEqual([])
  })

  test('trims and validates explicit model', async () => {
    await expect(
      validateAgentToolModelInput('  claude-sonnet-4-6-20250514  '),
    ).resolves.toEqual({
      normalizedModel: 'claude-sonnet-4-6-20250514',
    })
    expect(validateCalls).toEqual(['claude-sonnet-4-6-20250514'])
  })

  test('passes through inherit without validateModel call', async () => {
    await expect(validateAgentToolModelInput('inherit')).resolves.toEqual({
      normalizedModel: 'inherit',
    })
    expect(validateCalls).toEqual([])
  })

  test('keeps legacy alias model opus valid without effort input', async () => {
    await expect(validateAgentToolModelInput('opus')).resolves.toEqual({
      normalizedModel: 'opus',
    })
    expect(validateCalls).toEqual(['opus'])
  })

  test('throws actionable error for invalid model', async () => {
    validationResult = {
      valid: false,
      error: "Model 'bad-model' not found",
    }

    await expect(validateAgentToolModelInput('bad-model')).rejects.toThrow(
      /Run \/model to inspect or set an available model\./,
    )
    await expect(validateAgentToolModelInput('bad-model')).rejects.toThrow(
      /Available models include: sonnet, claude-sonnet-4-6-20250514\./,
    )
  })
})

describe('resolveAgentEffortValue', () => {
  test('prefers explicit subagent effort over all others', () => {
    expect(resolveAgentEffortValue('max', 'high', 'low')).toBe('max')
  })

  test('falls back to agent frontmatter effort', () => {
    expect(resolveAgentEffortValue(undefined, 'high', 'low')).toBe('high')
  })

  test('falls back to parent effort when others missing', () => {
    expect(resolveAgentEffortValue(undefined, undefined, 'medium')).toBe(
      'medium',
    )
  })

  test('keeps legacy no-effort behavior when all effort sources are absent', () => {
    expect(resolveAgentEffortValue(undefined, undefined, undefined)).toBe(
      undefined,
    )
  })
})
