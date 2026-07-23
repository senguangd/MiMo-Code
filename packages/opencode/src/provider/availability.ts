import { Effect, Schema } from "effect"
import z from "zod"
import { Auth } from "@/auth"
import { Config } from "@/config"
import { isRecord } from "@/util/record"
import { Log } from "@/util"
import { withStatics } from "@/util/schema"
import { zod } from "@/util/effect-zod"
import { ModelID, ProviderID } from "./schema"
import * as Provider from "./provider"
import * as ModelsDev from "./models"

const StatusName = Schema.Literals([
  "ready",
  "provider_not_found",
  "model_not_found",
  "credential_missing",
  "credential_unverified",
  "authentication_failed",
  "permission_denied",
  "endpoint_unreachable",
  "rate_limited",
  "quota_exceeded",
  "provider_unavailable",
  "unknown",
])

export const Status = Schema.Struct({
  status: StatusName,
  configured: Schema.Boolean,
  providerID: Schema.optional(Schema.String),
  modelID: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.String),
  remediation: Schema.Struct({
    login: Schema.Boolean,
    selectModel: Schema.Boolean,
    retry: Schema.Boolean,
  }),
})
  .annotate({ identifier: "ProviderDefaultModelStatus" })
  .pipe(withStatics((schema) => ({ zod: zod(schema) })))

export type Status = Schema.Schema.Type<typeof Status>

export const SetApiKeyInput = z
  .object({
    key: z.string().trim().min(1),
    modelID: z.string().min(1).optional(),
    baseURL: z.string().url().optional(),
    persistUnverified: z.boolean().optional(),
  })
  .meta({ ref: "ProviderSetApiKeyInput" })

export type SetApiKeyInput = z.infer<typeof SetApiKeyInput>

export const SetDefaultModelInput = z
  .object({
    model: z.string().min(3),
  })
  .meta({ ref: "ProviderSetDefaultModelInput" })

export type SetDefaultModelInput = z.infer<typeof SetDefaultModelInput>

type StatusName = Schema.Schema.Type<typeof StatusName>

const log = Log.create({ service: "provider-availability" })

function result(
  status: StatusName,
  input: {
    configured: boolean
    providerID?: string
    modelID?: string
    statusCode?: number
    detail?: string
  },
): Status {
  return {
    status,
    ...input,
    remediation: {
      login: status === "credential_missing" || status === "authentication_failed",
      selectModel: status !== "ready" && status !== "credential_unverified",
      retry:
        status === "endpoint_unreachable" ||
        status === "rate_limited" ||
        status === "provider_unavailable" ||
        status === "unknown",
    },
  }
}

function stringOption(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function openAICompatible(npm: string) {
  return npm.includes("openai-compatible") || npm === "@ai-sdk/openai"
}

function requestHeaders(provider: Provider.Info, model: Provider.Model, key?: string) {
  const configured = isRecord(provider.options.headers) ? provider.options.headers : {}
  const headers = Object.fromEntries(
    Object.entries({ ...configured, ...model.headers }).flatMap(([name, value]) =>
      typeof value === "string" ? [[name, value]] : [],
    ),
  )
  const apiKeyHeader = Object.keys(headers).find((name) => name.toLowerCase() === "api-key")
  if (key && apiKeyHeader) headers[apiKeyHeader] = key
  else if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

function modelsURL(baseURL: string) {
  const url = new URL(baseURL)
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`
  url.search = ""
  url.hash = ""
  return url
}

async function probe(input: {
  provider: Provider.Info
  model: Provider.Model
  key?: string
  configured: boolean
  timeoutMs: number
}): Promise<Status> {
  const providerID = input.provider.id
  const modelID = input.model.id
  const baseURL = stringOption(input.provider.options.baseURL) ?? stringOption(input.model.api.url)
  if (!input.key && input.provider.env.length > 0) {
    return result("credential_missing", { configured: input.configured, providerID, modelID })
  }
  if (!openAICompatible(input.model.api.npm) || !baseURL) {
    return result("credential_unverified", {
      configured: input.configured,
      providerID,
      modelID,
      detail: "The provider does not expose a supported credential validation endpoint.",
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  try {
    const response = await fetch(modelsURL(baseURL), {
      method: "GET",
      headers: requestHeaders(input.provider, input.model, input.key),
      redirect: "error",
      signal: controller.signal,
    })
    if (response.ok) {
      const payload = await response.json().catch(() => undefined)
      if (isRecord(payload) && Array.isArray(payload.data)) {
        const ids = payload.data.flatMap((item) => (isRecord(item) && typeof item.id === "string" ? [item.id] : []))
        if (ids.length > 0 && !ids.includes(input.model.api.id)) {
          return result("model_not_found", {
            configured: input.configured,
            providerID,
            modelID,
            statusCode: response.status,
            detail: "The configured model is not present in the provider model list.",
          })
        }
      }
      return result("ready", { configured: input.configured, providerID, modelID, statusCode: response.status })
    }
    if (response.status === 401) {
      return result(input.key ? "authentication_failed" : "credential_missing", {
        configured: input.configured,
        providerID,
        modelID,
        statusCode: response.status,
      })
    }
    if (response.status === 403) {
      return result("permission_denied", {
        configured: input.configured,
        providerID,
        modelID,
        statusCode: response.status,
      })
    }
    if (response.status === 402) {
      return result("quota_exceeded", {
        configured: input.configured,
        providerID,
        modelID,
        statusCode: response.status,
      })
    }
    if (response.status === 404 || response.status === 405) {
      return result("credential_unverified", {
        configured: input.configured,
        providerID,
        modelID,
        statusCode: response.status,
        detail: "The provider does not support the model-list validation endpoint.",
      })
    }
    if (response.status === 429) {
      return result("rate_limited", {
        configured: input.configured,
        providerID,
        modelID,
        statusCode: response.status,
      })
    }
    if (response.status >= 500) {
      return result("provider_unavailable", {
        configured: input.configured,
        providerID,
        modelID,
        statusCode: response.status,
      })
    }
    return result("unknown", {
      configured: input.configured,
      providerID,
      modelID,
      statusCode: response.status,
    })
  } catch (error) {
    return result("endpoint_unreachable", {
      configured: input.configured,
      providerID,
      modelID,
      detail:
        error instanceof Error && error.name === "AbortError"
          ? "Credential validation timed out."
          : "Credential validation failed to connect.",
    })
  } finally {
    clearTimeout(timer)
  }
}

export const inspectModel = Effect.fn("ProviderAvailability.inspectModel")(function* (input: {
  providerID: string
  modelID: string
  apiKey?: string
  configured?: boolean
  timeoutMs?: number
  baseURL?: string
}) {
  const service = yield* Provider.Service
  const providers = yield* service.list()
  const providerID = ProviderID.make(input.providerID)
  const modelID = ModelID.make(input.modelID)
  const configured = input.configured ?? true
  let provider = providers[providerID]
  if (!provider) {
    const config = yield* Config.Service
    const current = yield* config.get()
    if (current.disabled_providers?.includes(providerID)) {
      return result("provider_not_found", { configured, providerID, modelID })
    }
    if (current.enabled_providers && !current.enabled_providers.includes(providerID)) {
      return result("provider_not_found", { configured, providerID, modelID })
    }
    const catalog = yield* Effect.promise(() => ModelsDev.get())
    const fallback = catalog[providerID]
    if (!fallback) return result("provider_not_found", { configured, providerID, modelID })
    provider = Provider.fromModelsDevProvider(fallback)
  }
  const model = provider.models[modelID]
  if (!model) return result("model_not_found", { configured, providerID, modelID })
  const key = stringOption(input.apiKey) ?? stringOption(provider.options.apiKey) ?? stringOption(provider.key)
  const candidate = input.baseURL
    ? { ...provider, options: { ...provider.options, baseURL: input.baseURL } }
    : provider
  return yield* Effect.promise(() =>
    probe({
      provider: candidate,
      model,
      key,
      configured,
      timeoutMs: input.timeoutMs ?? 3_000,
    }),
  )
})

export const inspectDefaultModel = Effect.fn("ProviderAvailability.inspectDefaultModel")(function* (input?: {
  apiKey?: string
  timeoutMs?: number
}) {
  const config = yield* Config.Service
  const current = yield* config.get()
  if (!current.model) return result("ready", { configured: false })
  const model = Provider.parseModel(current.model)
  if (!model.providerID || !model.modelID) {
    return result("model_not_found", {
      configured: true,
      providerID: model.providerID,
      modelID: model.modelID,
      detail: "The configured model must use provider/model format.",
    })
  }
  return yield* inspectModel({
    providerID: model.providerID,
    modelID: model.modelID,
    apiKey: input?.apiKey,
    timeoutMs: input?.timeoutMs,
  })
})

export const setDefaultModel = Effect.fn("ProviderAvailability.setDefaultModel")(function* (model: string) {
  const parsed = Provider.parseModel(model)
  const provider = yield* Provider.Service
  yield* provider.getModel(parsed.providerID, parsed.modelID)
  const config = yield* Config.Service
  yield* config.updateGlobal({ model } as Config.Info)
  return result("ready", {
    configured: true,
    providerID: parsed.providerID,
    modelID: parsed.modelID,
  })
})

export const setApiKey = Effect.fn("ProviderAvailability.setApiKey")(function* (input: {
  providerID: string
  key: string
  modelID?: string
  baseURL?: string
  persistUnverified?: boolean
}) {
  const key = input.key.trim()
  const validation = input.modelID
    ? yield* inspectModel({
        providerID: input.providerID,
        modelID: input.modelID,
        apiKey: key,
        baseURL: input.baseURL,
      })
    : result("credential_unverified", {
        configured: false,
        providerID: input.providerID,
        detail: "The API key was saved without a model-specific validation request.",
      })
  if (validation.status !== "ready" && !(validation.status === "credential_unverified" && input.persistUnverified)) {
    return validation
  }

  const config = yield* Config.Service
  yield* config.updateGlobal({
    provider: {
      [input.providerID]: {
        options: {
          apiKey: key,
          ...(input.baseURL ? { baseURL: input.baseURL } : {}),
        },
      },
    },
  } as Config.Info)

  const auth = yield* Auth.Service
  const legacy = yield* auth.get(input.providerID)
  if (legacy?.type === "api" && !legacy.metadata) {
    yield* auth.remove(input.providerID).pipe(
      Effect.catch((error) =>
        Effect.sync(() =>
          log.warn("failed to remove legacy API credential after config persistence", {
            providerID: input.providerID,
            error: String(error),
          }),
        ),
      ),
    )
  }
  return validation
})
