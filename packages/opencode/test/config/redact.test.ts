import { describe, expect, test } from "bun:test"
import { ConfigRedact } from "../../src/config"

describe("ConfigRedact", () => {
  test("redacts structured provider, MCP, header, and environment secrets", () => {
    expect(
      ConfigRedact.value({
        provider: { options: { apiKey: "provider-secret", baseURL: "https://example.com" } },
        mcp: { oauth: { clientSecret: "oauth-secret", clientId: "public-id" } },
        headers: {
          Authorization: "Bearer header-secret",
          "X-API-Key": "header-key",
          "X-Custom-Auth": "custom-header-secret",
          "Content-Type": "application/json",
        },
        environment: {
          OPENAI_API_KEY: "env-secret",
          AWS_ACCESS_KEY_ID: "access-key",
          CUSTOM_CREDENTIAL: "custom-env-secret",
          PATH: "/bin",
        },
        transport: { privateKey: "pem-secret", passphrase: "key-passphrase" },
        aws: { secretAccessKey: "aws-secret" },
        args: ["--token", "argument-secret", "--api-key=inline-secret", "--model", "public-model"],
      }),
    ).toEqual({
      provider: { options: { apiKey: "<redacted>", baseURL: "https://example.com" } },
      mcp: { oauth: { clientSecret: "<redacted>", clientId: "public-id" } },
      headers: {
        Authorization: "<redacted>",
        "X-API-Key": "<redacted>",
        "X-Custom-Auth": "<redacted>",
        "Content-Type": "<redacted>",
      },
      environment: {
        OPENAI_API_KEY: "<redacted>",
        AWS_ACCESS_KEY_ID: "<redacted>",
        CUSTOM_CREDENTIAL: "<redacted>",
        PATH: "<redacted>",
      },
      transport: { privateKey: "<redacted>", passphrase: "<redacted>" },
      aws: { secretAccessKey: "<redacted>" },
      args: ["--token", "<redacted>", "--api-key=<redacted>", "--model", "public-model"],
    })
  })

  test("redacts embedded bearer and URL credentials without hiding benign domain keys", () => {
    expect(
      ConfigRedact.value({
        key: "model-key",
        keybind: "ctrl+k",
        max_tokens: 4096,
        command: "curl -H 'Authorization: Bearer abcdefghijklmnop' https://user:password@example.com?api_key=secret",
      }),
    ).toEqual({
      key: "model-key",
      keybind: "ctrl+k",
      max_tokens: 4096,
      command: "curl -H 'Authorization: Bearer ****' https://user:****@example.com?api_key=****",
    })
  })

  test("redacts sensitive flags in command strings", () => {
    expect(
      ConfigRedact.value({
        command: "tool --token plain-secret --api-key='quoted secret' --model public-model",
      }),
    ).toEqual({
      command: "tool --token **** --api-key=**** --model public-model",
    })
  })

  test("terminates safely on circular config objects", () => {
    const input: Record<string, unknown> = {}
    input.self = input
    expect(ConfigRedact.value(input)).toEqual({ self: "<circular>" })
  })

  test("does not mutate the original object", () => {
    const input = { options: { apiKey: "secret" } }
    ConfigRedact.value(input)
    expect(input.options.apiKey).toBe("secret")
  })
})
