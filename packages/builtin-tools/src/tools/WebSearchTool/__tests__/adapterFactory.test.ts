import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let isFirstPartyBaseUrl = true

class AbortError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = 'AbortError'
  }
}

const abortErrorModule = {
  AbortError,
  isAbortError: (e: unknown) => e instanceof Error && (e as Error).name === 'AbortError',
}

const applyAdapterFactoryMocks = () => {
  mock.module('src/utils/errors.js', () => abortErrorModule)
  mock.module('src/utils/errors', () => abortErrorModule)
  mock.module('src/services/api/claude.js', () => ({
    queryModelWithStreaming: async function* () {
      yield* []
    },
  }))
  mock.module('src/services/langfuse/index.js', () => ({
    createTrace: () => null,
    endTrace: () => {},
    isLangfuseEnabled: () => false,
  }))
  mock.module('src/bootstrap/state.js', () => ({
    getSessionId: () => 'test-session-id',
  }))
  mock.module('src/utils/messages.js', () => ({
    createUserMessage: ({ content }: { content: string }) => ({ role: 'user', content }),
  }))
  mock.module('src/utils/model/model.js', () => ({
    getMainLoopModel: () => 'claude-sonnet-4.5',
    getSmallFastModel: () => 'claude-haiku-4.5',
  }))
  mock.module('src/utils/slowOperations.js', () => ({
    jsonParse: (value: string) => JSON.parse(value),
  }))
  mock.module('src/utils/systemPromptType.js', () => ({
    asSystemPrompt: (value: string[]) => value,
  }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    getFeatureValue_CACHED_MAY_BE_STALE: () => false,
  }))
  mock.module('src/utils/model/providers.js', () => ({
    isFirstPartyAnthropicBaseUrl: () => isFirstPartyBaseUrl,
    getAPIProvider: () => 'firstParty',
    getAPIProviderForStatsig: () => 'firstParty',
  }))
}

applyAdapterFactoryMocks()

const importFresh = async (modulePath: string) =>
  await import(`${modulePath}?test=${Date.now()}-${Math.random()}`)

const loadAdapterFactory = async () => {
  applyAdapterFactoryMocks()
  return await importFresh('../adapters/index')
}

const originalWebSearchAdapter = process.env.WEB_SEARCH_ADAPTER

beforeEach(() => {
  applyAdapterFactoryMocks()
})

afterEach(() => {
  isFirstPartyBaseUrl = true

  if (originalWebSearchAdapter === undefined) {
    delete process.env.WEB_SEARCH_ADAPTER
  } else {
    process.env.WEB_SEARCH_ADAPTER = originalWebSearchAdapter
  }
})

afterAll(() => {
  mock.restore()
})

describe('createAdapter', () => {
  test('reuses the same instance when the selected backend does not change', async () => {
    process.env.WEB_SEARCH_ADAPTER = 'brave'
    const { createAdapter } = await loadAdapterFactory()

    const firstAdapter = createAdapter()
    const secondAdapter = createAdapter()

    expect(firstAdapter).toBe(secondAdapter)
    expect(firstAdapter.constructor.name).toBe('BraveSearchAdapter')
  })

  test('rebuilds the adapter when WEB_SEARCH_ADAPTER changes', async () => {
    process.env.WEB_SEARCH_ADAPTER = 'brave'
    const { createAdapter } = await loadAdapterFactory()
    const braveAdapter = createAdapter()

    process.env.WEB_SEARCH_ADAPTER = 'bing'
    const bingAdapter = createAdapter()

    expect(bingAdapter).not.toBe(braveAdapter)
    expect(bingAdapter.constructor.name).toBe('BingSearchAdapter')
  })

  test('selects the API adapter for first-party Anthropic URLs', async () => {
    delete process.env.WEB_SEARCH_ADAPTER
    isFirstPartyBaseUrl = true
    const { createAdapter } = await loadAdapterFactory()

    expect(createAdapter().constructor.name).toBe('ApiSearchAdapter')
  })

  test('selects the Bing adapter for third-party Anthropic base URLs', async () => {
    delete process.env.WEB_SEARCH_ADAPTER
    isFirstPartyBaseUrl = false
    const { createAdapter } = await loadAdapterFactory()

    expect(createAdapter().constructor.name).toBe('BingSearchAdapter')
  })
})
