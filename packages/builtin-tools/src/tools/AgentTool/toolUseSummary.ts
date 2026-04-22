import type { ContentItem, Message as MessageType } from 'src/types/message.js'

export function countToolUses(messages: MessageType[]): number {
  let count = 0
  for (const message of messages) {
    if (message.type !== 'assistant') continue

    const content = message.message?.content as ContentItem[] | undefined
    for (const block of content ?? []) {
      if (block.type === 'tool_use') {
        count++
      }
    }
  }

  return count
}

export function getLastToolUseName(message: MessageType): string | undefined {
  if (message.type !== 'assistant') return undefined

  const block = (message.message?.content as ContentItem[] ?? []).findLast(
    contentItem => contentItem.type === 'tool_use',
  )

  return block?.type === 'tool_use' ? block.name : undefined
}
