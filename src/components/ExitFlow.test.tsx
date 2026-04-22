import { beforeEach, describe, expect, mock, test } from 'bun:test'

const gracefulShutdownMock = mock(() => Promise.resolve())

mock.module('../utils/gracefulShutdown.js', () => ({
  gracefulShutdown: gracefulShutdownMock,
  gracefulShutdownSync: mock(() => {}),
  isShuttingDown: mock(() => false),
}))

const { ExitFlow } = await import('./ExitFlow.js')

describe('ExitFlow', () => {
  beforeEach(() => {
    gracefulShutdownMock.mockClear()
  })

  test('calls onDone before shutdown in worktree flow', async () => {
    let resolveShutdown!: () => void
    const callOrder: string[] = []
    gracefulShutdownMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          callOrder.push('gracefulShutdown')
          resolveShutdown = resolve
        }),
    )

    const onDone = mock((message?: string) => {
      callOrder.push(`onDone:${message ?? ''}`)
    })

    const rendered = ExitFlow({
      showWorktree: true,
      onDone,
      onCancel: mock(() => {}),
    }) as any

    const exitPromise = rendered.props.onDone('Bye').then(() => {
      callOrder.push('exitResolved')
    })

    await Promise.resolve()

    expect(callOrder).toEqual(['onDone:Bye', 'gracefulShutdown'])
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(gracefulShutdownMock).toHaveBeenCalledWith(0, 'prompt_input_exit')

    resolveShutdown()
    await exitPromise
    expect(callOrder).toEqual(['onDone:Bye', 'gracefulShutdown', 'exitResolved'])
  })
})
