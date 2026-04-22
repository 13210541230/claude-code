import { beforeEach, describe, expect, mock, test } from "bun:test";

const gracefulShutdownMock = mock(() => Promise.resolve());
const isBgSessionMock = mock(() => false);
const getCurrentWorktreeSessionMock = mock(() => null);

mock.module("../../utils/gracefulShutdown.js", () => ({
  gracefulShutdown: gracefulShutdownMock,
  gracefulShutdownSync: mock(() => {}),
  isShuttingDown: mock(() => false),
}));

mock.module("../../utils/concurrentSessions.js", () => ({
  isBgSession: isBgSessionMock,
}));

mock.module("../../utils/worktree.js", () => ({
  getCurrentWorktreeSession: getCurrentWorktreeSessionMock,
}));

mock.module("../../components/ExitFlow.js", () => ({
  ExitFlow: () => null,
}));

const { call } = await import("./exit.js");

describe("exit command", () => {
  beforeEach(() => {
    gracefulShutdownMock.mockClear();
    isBgSessionMock.mockReset();
    isBgSessionMock.mockReturnValue(false);
    getCurrentWorktreeSessionMock.mockReset();
    getCurrentWorktreeSessionMock.mockReturnValue(null);
  });

  test("starts graceful shutdown after invoking onDone on normal exit", async () => {
    let resolveShutdown!: () => void;
    const callOrder: string[] = [];
    gracefulShutdownMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          callOrder.push("gracefulShutdown");
          resolveShutdown = resolve;
        }),
    );

    const onDone = mock(() => {
      callOrder.push("onDone");
    });
    let resolved = false;

    const promise = call(onDone).then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(callOrder).toEqual(["onDone", "gracefulShutdown"]);
    expect(gracefulShutdownMock).toHaveBeenCalledWith(0, "prompt_input_exit");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);

    resolveShutdown();
    await promise;

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
