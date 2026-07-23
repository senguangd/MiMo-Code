import type { ProviderDefaultModelStatus } from "@adp-ai/sdk/v2"
import { createMemo, createSignal, type JSX } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useExit } from "@tui/context/exit"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogSecretPrompt } from "@tui/ui/dialog-secret-prompt"
import { useToast } from "@tui/ui/toast"
import { DialogModel } from "./dialog-model"

export function isDefaultModelUsable(status: ProviderDefaultModelStatus) {
  return status.status === "ready" || status.status === "credential_unverified"
}

export function defaultModelStatusMessage(status: ProviderDefaultModelStatus) {
  const model = [status.providerID, status.modelID].filter(Boolean).join("/") || "the configured default model"
  const suffix = status.statusCode ? ` (HTTP ${status.statusCode})` : ""
  const messages: Record<ProviderDefaultModelStatus["status"], string> = {
    ready: `${model} is ready.`,
    provider_not_found: `Provider for ${model} is not configured or enabled.`,
    model_not_found: `Model ${model} is not available from the configured provider.`,
    credential_missing: `${model} requires an API key.`,
    credential_unverified: `${model} does not expose a supported credential validation endpoint.`,
    authentication_failed: `The API key for ${model} was rejected${suffix}.`,
    permission_denied: `The credentials do not have permission to use ${model}${suffix}.`,
    endpoint_unreachable: `The endpoint for ${model} could not be reached.`,
    rate_limited: `The provider is rate limiting validation for ${model}${suffix}.`,
    quota_exceeded: `The account quota for ${model} is exhausted${suffix}.`,
    provider_unavailable: `The provider for ${model} is currently unavailable${suffix}.`,
    unknown: `The availability of ${model} could not be determined${suffix}.`,
  }
  return status.detail ? `${messages[status.status]} ${status.detail}` : messages[status.status]
}

export function DialogDefaultModelRecovery() {
  const sync = useSync()
  const sdk = useSDK()
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()
  const exit = useExit()
  const [busy, setBusy] = createSignal(false)
  const status = () => sync.data.default_model_status

  function replaceMandatory(factory: () => JSX.Element) {
    dialog.replace(factory, undefined, { dismissible: false, replaceMandatory: true })
  }

  function backToRecovery() {
    replaceMandatory(() => <DialogDefaultModelRecovery />)
  }

  async function reload() {
    await sdk.client.instance.dispose()
    await sync.bootstrap({ fatal: false })
    if (isDefaultModelUsable(sync.data.default_model_status)) {
      dialog.clear({ force: true })
      return
    }
    replaceMandatory(() => <DialogDefaultModelRecovery />)
  }

  function apiKey(): void {
    const current = status()
    if (!current.providerID) return
    dialog.replace(
      () => (
        <DialogSecretPrompt
          title={`API key for ${current.providerID}`}
          dismissible={false}
          placeholder="Paste API key"
          onError={toast.error}
          onConfirm={async (key) => {
            const response = await sdk.client.provider.apiKey.set(
              {
                providerID: current.providerID!,
                providerSetApiKeyInput: {
                  key,
                  modelID: current.modelID,
                  persistUnverified: true,
                },
              },
              { throwOnError: true },
            )
            const next = response.data
            if (!next) return
            if (!isDefaultModelUsable(next)) {
              toast.show({ variant: "error", message: defaultModelStatusMessage(next), duration: 5000 })
              return
            }
            toast.show({
              variant: next.status === "ready" ? "success" : "warning",
              message:
                next.status === "ready"
                  ? `API key saved for ${current.providerID}.`
                  : `API key saved for ${current.providerID} without remote verification.`,
              duration: 4000,
            })
            await reload()
          }}
        />
      ),
      undefined,
      { dismissible: false, replaceMandatory: true, onBack: backToRecovery },
    )
  }

  function selectModel(): void {
    let selecting = false
    dialog.replace(
      () => (
        <DialogModel
          dismissible={false}
          onSelect={async (model) => {
            if (selecting) return
            selecting = true
            try {
              await sdk.client.provider.defaultModel.set(
                {
                  providerSetDefaultModelInput: {
                    model: `${model.providerID}/${model.modelID}`,
                  },
                },
                { throwOnError: true },
              )
              local.model.set(model, { recent: true })
              await reload()
            } catch (error) {
              toast.error(error)
              selecting = false
            }
          }}
        />
      ),
      undefined,
      { dismissible: false, replaceMandatory: true, onBack: backToRecovery },
    )
  }

  async function retry() {
    if (busy()) return
    setBusy(true)
    await reload().catch(toast.error)
    setBusy(false)
  }

  const options = createMemo(() => [
    ...(status().remediation.login && status().providerID
      ? [
          {
            title: "Enter API key",
            value: "login" as const,
            description: `Authenticate ${status().providerID}`,
            disabled: busy(),
            onSelect(): void {
              apiKey()
            },
          },
        ]
      : []),
    {
      title: "Select another model",
      value: "model" as const,
      description: "Persist a different global default model",
      disabled: busy(),
      onSelect(): void {
        selectModel()
      },
    },
    {
      title: busy() ? "Checking again..." : "Retry check",
      value: "retry" as const,
      description: "Reload configuration and validate again",
      disabled: busy(),
      onSelect(): void {
        void retry()
      },
    },
    {
      title: "Exit AdpCli",
      value: "exit" as const,
      description: "Leave without changing the configuration",
      disabled: busy(),
      onSelect(): void {
        void exit()
      },
    },
  ])

  return (
    <DialogSelect
      title="Default model needs attention"
      hint={defaultModelStatusMessage(status())}
      options={options()}
      skipFilter={true}
      dismissible={false}
    />
  )
}
