[English](./model-service.md) | [中文](./model-service.zh-CN.md)

# Model service

The model service connects MacroBay to the model provider that powers assistants and agents. It is
configured locally; there is no MacroBay-hosted model proxy.

![Model service](../assets/screenshots/settings-en.png)

## Concepts

| Concept | Meaning |
| --- | --- |
| Provider | A vendor or gateway with endpoints and a model list |
| API key | The credential used by the main process to call the provider |
| Endpoint | The protocol-specific base URL inside the provider configuration |
| Model | A chat-capable model exposed by the provider |
| Default model | The model used when an assistant or agent does not bind one explicitly |

Provider protocol, base URL, and endpoint details are preset data. The first-version UI exposes the
API key, enable switch, model list, connection test, and default model selection.

## Add a provider

1. Open **Settings → Model Service**.
2. Choose a provider from the catalog or add a custom provider.
3. Enter the API key.
4. Enable the provider.
5. Add or enable at least one chat model.
6. Choose the default model for agents and assistants.

The key is sent to the main process and stored through the platform secret store. After saving, the
renderer receives `hasApiKey` and a masked preview, not the raw value.

## Protocol compatibility

A provider can expose several protocols. Ordinary chat and the agent runtime do not have the same
requirements:

- **Ordinary chat** can use a chat-completions or responses route.
- **The agent runtime** expects a Claude Code-compatible Messages route.

The agent model picker only lists models that satisfy the runtime constraints. If a model is
missing, check:

- the provider is enabled;
- the API key is present;
- the model is enabled in the provider's model list;
- the provider declares a Messages endpoint;
- the model is not retired.

A rate limit, timeout, or transient network error is not a protocol failure. The model stays
selectable and compatibility is shown as unverified rather than hidden.

## Connection test

The test button checks ordinary connectivity and protocol support. A successful test does not
guarantee that every model is suitable for the agent runtime; use the agent model picker as the
final compatibility check.

## Change the default model

The default model is stored with the application settings. New assistants and unconfigured agents
use it. An agent that already has an explicit model keeps that model.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `provider-not-ready` | Provider enabled, endpoint configured, API key saved |
| `provider-missing` | The model's provider still exists |
| `missing-api-key` | Re-save the key; the secret store may not be readable |
| `model-not-enabled` | Add the model to the provider model list |
| `model-incompatible` | Provider declares a Messages endpoint and the model supports it |
| HTTP 401 / 403 | Key, account status, or provider permissions |
| HTTP 429 | Rate limit; retry later or use another model |

## Privacy

- Raw keys never reach the renderer after saving.
- Keys are not written to logs or copied to the clipboard by the app.
- Provider requests leave the machine through the platform network adapter, so the configured proxy
  applies.

## Next

- [First run](./first-run.md)
- [Status and limitations](../reference/status-and-limitations.md)
