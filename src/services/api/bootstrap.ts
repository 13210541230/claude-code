import axios from 'axios'
import isEqual from 'lodash-es/isEqual.js'
import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  hasProfileScope,
  isClaudeAISubscriber,
} from 'src/utils/auth.js'
import { z } from 'zod'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import { getAnthropicClient } from '../../services/api/client.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { withOAuth401Retry } from '../../utils/http.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

const bootstrapResponseSchema = lazySchema(() =>
  z.object({
    client_data: z.record(z.string(), z.unknown()).nullish(),
    additional_model_options: z
      .array(
        z
          .object({
            model: z.string(),
            name: z.string(),
            description: z.string(),
          })
          .transform(({ model, name, description }) => ({
            value: model,
            label: name,
            description,
          })),
      )
      .nullish(),
  }),
)

type BootstrapResponse = z.infer<ReturnType<typeof bootstrapResponseSchema>>

const modelEntrySchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      display_name: z.string().optional(),
      name: z.string().optional(),
    })
    .passthrough(),
)

function mergeModelOptions(...groups: ModelOption[][]): ModelOption[] {
  const merged: ModelOption[] = []
  const seen = new Set<ModelOption['value']>()

  for (const group of groups) {
    for (const option of group) {
      if (seen.has(option.value)) continue
      seen.add(option.value)
      merged.push(option)
    }
  }

  return merged
}

async function fetchAdditionalModelOptionsFromModelsAPI(): Promise<
  ModelOption[] | null
> {
  if (isEssentialTrafficOnly()) {
    logForDebugging('[BootstrapModels] Skipped: Nonessential traffic disabled')
    return null
  }

  if (isClaudeAISubscriber()) {
    logForDebugging('[BootstrapModels] Skipped: Claude.ai subscriber')
    return null
  }

  if (getAPIProvider() !== 'firstParty') {
    logForDebugging('[BootstrapModels] Skipped: non-first-party provider')
    return null
  }

  if (isFirstPartyAnthropicBaseUrl()) {
    logForDebugging('[BootstrapModels] Skipped: first-party Anthropic base URL')
    return null
  }

  try {
    const anthropic = await getAnthropicClient({
      maxRetries: 1,
      source: 'bootstrap-models',
    })
    const betas = isClaudeAISubscriber() ? [OAUTH_BETA_HEADER] : undefined
    const additionalModelOptions: ModelOption[] = []

    for await (const model of anthropic.models.list({ betas })) {
      const parsed = modelEntrySchema().safeParse(model)
      if (!parsed.success) continue
      const modelName = parsed.data.display_name || parsed.data.name || parsed.data.id
      additionalModelOptions.push({
        value: parsed.data.id,
        label: modelName,
        description: parsed.data.id,
      })
    }

    if (additionalModelOptions.length === 0) {
      logForDebugging('[BootstrapModels] Models API returned no models')
      return []
    }

    logForDebugging(
      `[BootstrapModels] Models API fetched ${additionalModelOptions.length} models`,
    )
    return additionalModelOptions
  } catch (error) {
    logForDebugging(
      `[BootstrapModels] Fetch failed: ${error instanceof Error ? error.message : 'unknown'}`,
    )
    return null
  }
}

async function fetchBootstrapAPI(): Promise<BootstrapResponse | null> {
  if (isEssentialTrafficOnly()) {
    logForDebugging('[Bootstrap] Skipped: Nonessential traffic disabled')
    return null
  }

  if (getAPIProvider() !== 'firstParty') {
    logForDebugging('[Bootstrap] Skipped: 3P provider')
    return null
  }

  if (!isFirstPartyAnthropicBaseUrl()) {
    logForDebugging('[Bootstrap] Skipped: non-first-party Anthropic base URL')
    return null
  }

  // OAuth preferred (requires user:profile scope — service-key OAuth tokens
  // lack it and would 403). Fall back to API key auth for console users.
  const apiKey = getAnthropicApiKey()
  const hasUsableOAuth =
    getClaudeAIOAuthTokens()?.accessToken && hasProfileScope()
  if (!hasUsableOAuth && !apiKey) {
    logForDebugging('[Bootstrap] Skipped: no usable OAuth or API key')
    return null
  }

  const endpoint = `${getOauthConfig().BASE_API_URL}/api/claude_cli/bootstrap`

  // withOAuth401Retry handles the refresh-and-retry. API key users fail
  // through on 401 (no refresh mechanism — no OAuth token to pass).
  try {
    return await withOAuth401Retry(async () => {
      // Re-read OAuth each call so the retry picks up the refreshed token.
      const token = getClaudeAIOAuthTokens()?.accessToken
      let authHeaders: Record<string, string>
      if (token && hasProfileScope()) {
        authHeaders = {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': OAUTH_BETA_HEADER,
        }
      } else if (apiKey) {
        authHeaders = { 'x-api-key': apiKey }
      } else {
        logForDebugging('[Bootstrap] No auth available on retry, aborting')
        return null
      }

      logForDebugging('[Bootstrap] Fetching')
      const response = await axios.get<unknown>(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getClaudeCodeUserAgent(),
          ...authHeaders,
        },
        timeout: 5000,
      })
      const parsed = bootstrapResponseSchema().safeParse(response.data)
      if (!parsed.success) {
        logForDebugging(
          `[Bootstrap] Response failed validation: ${parsed.error.message}`,
        )
        return null
      }
      logForDebugging('[Bootstrap] Fetch ok')
      return parsed.data
    })
  } catch (error) {
    logForDebugging(
      `[Bootstrap] Fetch failed: ${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : 'unknown'}`,
    )
    throw error
  }
}

/**
 * Fetch bootstrap data from the API and persist to disk cache.
 */
export async function fetchBootstrapData(): Promise<void> {
  try {
    const config = getGlobalConfig()
    const response = await fetchBootstrapAPI()
    const modelsApiOptions = await fetchAdditionalModelOptionsFromModelsAPI()

    if (!response && modelsApiOptions === null) return

    const clientData = response ? (response.client_data ?? null) : config.clientDataCache
    const additionalModelOptions = mergeModelOptions(
      response?.additional_model_options ?? [],
      modelsApiOptions ?? [],
    )

    // Only persist if data actually changed — avoids a config write on every startup.
    if (
      isEqual(config.clientDataCache, clientData) &&
      isEqual(config.additionalModelOptionsCache, additionalModelOptions)
    ) {
      logForDebugging('[Bootstrap] Cache unchanged, skipping write')
      return
    }

    logForDebugging('[Bootstrap] Cache updated, persisting to disk')
    saveGlobalConfig(current => ({
      ...current,
      clientDataCache: clientData,
      additionalModelOptionsCache: additionalModelOptions,
    }))
  } catch (error) {
    logError(error)
  }
}
