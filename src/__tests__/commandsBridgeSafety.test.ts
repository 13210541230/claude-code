import { describe, expect, test } from 'bun:test'

import {
  filterCommandsForHeadlessMode,
  filterOutPromptCommands,
  findCommand,
  isBridgeSafeCommand,
} from '../commands.js'
import clear from '../commands/clear/index.js'
import commit from '../commands/commit.js'
import { contextNonInteractive } from '../commands/context/index.js'
import exit from '../commands/exit/index.js'
import plan from '../commands/plan/index.js'
import proactive from '../commands/proactive.js'

describe('isBridgeSafeCommand', () => {
  test('allows bridge-safe local-jsx commands', () => {
    expect(isBridgeSafeCommand(plan)).toBe(true)
    expect(isBridgeSafeCommand(proactive)).toBe(true)
  })

  test('continues allowing explicit local bridge-safe commands', () => {
    expect(isBridgeSafeCommand(clear)).toBe(true)
  })
})

describe('filterOutPromptCommands', () => {
  test('removes prompt commands but keeps local/local-jsx commands', () => {
    const filtered = filterOutPromptCommands([commit, clear, exit])

    expect(filtered).toEqual([clear, exit])
  })
})

describe('filterCommandsForHeadlessMode', () => {
  test('keeps prompt commands and non-interactive locals by default', () => {
    const filtered = filterCommandsForHeadlessMode([
      commit,
      clear,
      contextNonInteractive,
      exit,
    ])

    expect(filtered).toEqual([commit, contextNonInteractive, exit])
  })

  test('disables prompt commands only when disablePromptCommands is true', () => {
    const filtered = filterCommandsForHeadlessMode(
      [commit, contextNonInteractive, exit],
      true,
    )

    expect(filtered).toEqual([contextNonInteractive, exit])
  })

  test('keeps quit alias resolvable when prompt commands are disabled', () => {
    const filtered = filterCommandsForHeadlessMode([commit, exit], true)

    expect(findCommand('commit', filtered)).toBeUndefined()
    expect(findCommand('quit', filtered)).toBe(exit)
  })
})
