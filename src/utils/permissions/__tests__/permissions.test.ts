import { mock, describe, expect, test } from 'bun:test'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'

const importFresh = async (modulePath: string) =>
  await import(`${modulePath}?test=${Date.now()}-${Math.random()}`)

mock.module('@claude-code-best/builtin-tools/tools/AgentTool/constants.js', () => ({
  AGENT_TOOL_NAME: 'Agent',
  LEGACY_AGENT_TOOL_NAME: 'Task',
  VERIFICATION_AGENT_TYPE: 'verification',
  ONE_SHOT_BUILTIN_AGENT_TYPES: new Set<string>(),
}))
mock.module('@claude-code-best/builtin-tools/tools/BashTool/shouldUseSandbox.js', () => ({
  shouldUseSandbox: () => false,
}))
mock.module('@claude-code-best/builtin-tools/tools/BashTool/toolName.js', () => ({
  BASH_TOOL_NAME: 'Bash',
}))
mock.module('@claude-code-best/builtin-tools/tools/PowerShellTool/toolName.js', () => ({
  POWERSHELL_TOOL_NAME: 'PowerShell',
}))
mock.module('@claude-code-best/builtin-tools/tools/REPLTool/constants.js', () => ({
  REPL_TOOL_NAME: 'REPL',
  REPL_ONLY_TOOLS: new Set<string>(),
  isReplModeEnabled: () => false,
}))
mock.module('@claude-code-best/builtin-tools/tools/TaskOutputTool/constants.js', () => ({
  TASK_OUTPUT_TOOL_NAME: 'TaskOutput',
}))
mock.module('@claude-code-best/builtin-tools/tools/TaskStopTool/prompt.js', () => ({
  TASK_STOP_TOOL_NAME: 'TaskStop',
}))
mock.module('@claude-code-best/builtin-tools/tools/BriefTool/prompt.js', () => ({
  BRIEF_TOOL_NAME: 'SendUserMessage',
  LEGACY_BRIEF_TOOL_NAME: 'Brief',
}))

mock.module('src/utils/log.ts', () => ({
  logError: () => {},
  logToFile: () => {},
  getLogDisplayTitle: () => '',
  logEvent: () => {},
  logMCPError: () => {},
  logMCPDebug: () => {},
  dateToFilename: (d: Date) => d.toISOString().replace(/[:.]/g, '-'),
  getLogFilePath: () => '/tmp/mock-log',
  attachErrorLogSink: () => {},
  getInMemoryErrors: () => [],
  loadErrorLogs: async () => [],
  getErrorLogByIndex: async () => null,
  captureAPIRequest: () => {},
  _resetErrorLogForTesting: () => {},
}))

const {
  getDenyRuleForTool,
  getAskRuleForTool,
  getDenyRuleForAgent,
  filterDeniedAgents,
} = await import('../permissions')

function makeContext(opts: { denyRules?: string[]; askRules?: string[] }) {
  const ctx = getEmptyToolPermissionContext()
  const deny: Record<string, string[]> = {}
  const ask: Record<string, string[]> = {}
  if (opts.denyRules?.length) deny.localSettings = opts.denyRules
  if (opts.askRules?.length) ask.localSettings = opts.askRules
  return { ...ctx, alwaysDenyRules: deny, alwaysAskRules: ask } as any
}

function makeTool(name: string, mcpInfo?: { serverName: string; toolName: string }) {
  return { name, mcpInfo }
}

describe('getDenyRuleForTool', () => {
  test('returns null when no deny rules', () => {
    const ctx = makeContext({})
    expect(getDenyRuleForTool(ctx, makeTool('Bash'))).toBeNull()
  })
  test('returns matching deny rule for tool', () => {
    const ctx = makeContext({ denyRules: ['Bash'] })
    const result = getDenyRuleForTool(ctx, makeTool('Bash'))
    expect(result).not.toBeNull()
    expect(result!.ruleValue.toolName).toBe('Bash')
  })
  test('returns null for non-matching tool', () => {
    const ctx = makeContext({ denyRules: ['Bash'] })
    expect(getDenyRuleForTool(ctx, makeTool('Read'))).toBeNull()
  })
  test('rule with content does not match whole-tool deny', () => {
    const ctx = makeContext({ denyRules: ['Bash(rm -rf)'] })
    const result = getDenyRuleForTool(ctx, makeTool('Bash'))
    expect(result).toBeNull()
  })
})

describe('getAskRuleForTool', () => {
  test('returns null when no ask rules', () => {
    const ctx = makeContext({})
    expect(getAskRuleForTool(ctx, makeTool('Bash'))).toBeNull()
  })
  test('returns matching ask rule', () => {
    const ctx = makeContext({ askRules: ['Write'] })
    const result = getAskRuleForTool(ctx, makeTool('Write'))
    expect(result).not.toBeNull()
  })
  test('returns null for non-matching tool', () => {
    const ctx = makeContext({ askRules: ['Write'] })
    expect(getAskRuleForTool(ctx, makeTool('Bash'))).toBeNull()
  })
})

describe('getDenyRuleForAgent', () => {
  test('returns null when no deny rules', () => {
    const ctx = makeContext({})
    expect(getDenyRuleForAgent(ctx, 'Agent', 'Explore')).toBeNull()
  })
  test('returns matching deny rule for agent type', () => {
    const ctx = makeContext({ denyRules: ['Agent(Explore)'] })
    const result = getDenyRuleForAgent(ctx, 'Agent', 'Explore')
    expect(result).not.toBeNull()
  })
  test('returns null for non-matching agent type', () => {
    const ctx = makeContext({ denyRules: ['Agent(Explore)'] })
    expect(getDenyRuleForAgent(ctx, 'Agent', 'Research')).toBeNull()
  })
})

describe('Langfuse trace propagation', () => {
  test('subagent context preserves parent trace for nested side queries', async () => {
    const { createFileStateCacheWithSizeLimit } = await importFresh(
      '../../../utils/fileStateCache.js',
    )
    const { getEmptyToolPermissionContext } = await importFresh(
      '../../../Tool.js',
    )
    const { createSubagentContext } = await importFresh(
      '../../../utils/forkedAgent.js',
    )
    const parentTrace = { id: 'parent-trace' } as never
    const parentContext = {
      ...getEmptyToolPermissionContext(),
      messages: [],
      abortController: new AbortController(),
      readFileState: createFileStateCacheWithSizeLimit(1),
      getAppState: () => ({ toolPermissionContext: getEmptyToolPermissionContext() }),
      setAppState: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      langfuseTrace: parentTrace,
    } as never
    const subagentContext = createSubagentContext(parentContext)
    expect(subagentContext.langfuseRootTrace).toBe(parentTrace)
  })
})

describe('filterDeniedAgents', () => {
  test('returns all agents when no deny rules', () => {
    const ctx = makeContext({})
    const agents = [{ agentType: 'Explore' }, { agentType: 'Research' }]
    expect(filterDeniedAgents(agents, ctx, 'Agent')).toEqual(agents)
  })
  test('filters out denied agent type', () => {
    const ctx = makeContext({ denyRules: ['Agent(Explore)'] })
    const agents = [{ agentType: 'Explore' }, { agentType: 'Research' }]
    const result = filterDeniedAgents(agents, ctx, 'Agent')
    expect(result).toHaveLength(1)
    expect(result[0]!.agentType).toBe('Research')
  })
  test('returns empty array when all agents denied', () => {
    const ctx = makeContext({ denyRules: ['Agent(Explore)', 'Agent(Research)'] })
    const agents = [{ agentType: 'Explore' }, { agentType: 'Research' }]
    expect(filterDeniedAgents(agents, ctx, 'Agent')).toEqual([])
  })
})
