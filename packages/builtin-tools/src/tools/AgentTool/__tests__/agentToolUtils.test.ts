import { describe, expect, test } from 'bun:test'

import { countToolUses, getLastToolUseName } from '../toolUseSummary'

function makeAssistantMessage(content: any[]): any {
  return { type: 'assistant', message: { content } }
}

function makeUserMessage(text: string): any {
  return { type: 'user', message: { content: text } }
}

describe('countToolUses', () => {
  test('counts tool_use blocks in messages', () => {
    const messages = [
      makeAssistantMessage([
        { type: 'tool_use', name: 'Read' },
        { type: 'text', text: 'hello' },
      ]),
    ]
    expect(countToolUses(messages)).toBe(1)
  })

  test('returns 0 for messages without tool_use', () => {
    const messages = [
      makeAssistantMessage([{ type: 'text', text: 'hello' }]),
    ]
    expect(countToolUses(messages)).toBe(0)
  })

  test('returns 0 for empty array', () => {
    expect(countToolUses([])).toBe(0)
  })

  test('counts multiple tool_use blocks across messages', () => {
    const messages = [
      makeAssistantMessage([{ type: 'tool_use', name: 'Read' }]),
      makeUserMessage('ok'),
      makeAssistantMessage([{ type: 'tool_use', name: 'Write' }]),
    ]
    expect(countToolUses(messages)).toBe(2)
  })

  test('counts tool_use in single message with multiple blocks', () => {
    const messages = [
      makeAssistantMessage([
        { type: 'tool_use', name: 'Read' },
        { type: 'tool_use', name: 'Grep' },
        { type: 'tool_use', name: 'Write' },
      ]),
    ]
    expect(countToolUses(messages)).toBe(3)
  })
})

describe('getLastToolUseName', () => {
  test('returns last tool name from assistant message', () => {
    const message = makeAssistantMessage([
      { type: 'tool_use', name: 'Read' },
      { type: 'tool_use', name: 'Write' },
    ])
    expect(getLastToolUseName(message)).toBe('Write')
  })

  test('returns undefined for message without tool_use', () => {
    const message = makeAssistantMessage([{ type: 'text', text: 'hello' }])
    expect(getLastToolUseName(message)).toBeUndefined()
  })

  test('returns the last tool when multiple tool_uses present', () => {
    const message = makeAssistantMessage([
      { type: 'tool_use', name: 'Read' },
      { type: 'tool_use', name: 'Grep' },
      { type: 'tool_use', name: 'Edit' },
    ])
    expect(getLastToolUseName(message)).toBe('Edit')
  })

  test('returns undefined for non-assistant message', () => {
    const message = makeUserMessage('hello')
    expect(getLastToolUseName(message)).toBeUndefined()
  })

  test('handles message with null content', () => {
    const message = { type: 'assistant', message: { content: null } } as any
    expect(getLastToolUseName(message)).toBeUndefined()
  })
})
