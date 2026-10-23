# Platform

`platform` contains reusable AI desktop product infrastructure.

It must not depend on any product module. No file here should import from `products/*` or mention product-specific business concepts.

## Areas

- `desktop`: Electron host infrastructure.
- `ui`: generic design system and reusable UI primitives.
- `routing`: product route and navigation registration.
- `settings`: generic settings framework.
- `storage`: database, migrations, repositories, and persistence primitives.
- `jobs`: background job framework.
- `secrets`: keychain, encrypted storage, and redaction.
- `files`: attachments, imports, exports, and file utilities.
- `observability`: logging, tracing, errors, and cost tracking.
- `ai`: providers, chat, MCP, agent platform, memory, and context.

## Directory Notes

- `desktop/main`: Electron main-process bootstrap.
- `desktop/preload`: secure preload bridge.
- `desktop/ipc`: typed IPC channels and handlers.
- `desktop/window`: window creation and lifecycle.
- `desktop/menu`: native menu construction.
- `desktop/tray`: tray integration.
- `desktop/services`: desktop-owned local service lifecycle.
- `ui/components`: product-neutral UI primitives.
- `ui/theme`: shared theme setup.
- `ui/tokens`: design tokens.
- `ui/icons`: icon wrappers and mappings.
- `routing/routes`: route registration contracts.
- `routing/navigation`: sidebar, tab, and command navigation contracts.
- `settings/schema`: settings schemas.
- `settings/store`: settings persistence adapters.
- `storage/database`: database connection and transaction primitives.
- `storage/migrations`: platform migrations.
- `storage/repositories`: platform repositories.
- `jobs/runtime`: job runner and scheduler.
- `jobs/registry`: job handler registration.
- `secrets/keychain`: keychain or encrypted secret storage.
- `secrets/redaction`: log and prompt redaction helpers.
- `files/imports`: generic import helpers.
- `files/exports`: generic export helpers.
- `files/attachments`: local attachment handling.
- `observability/logging`: logging primitives.
- `observability/tracing`: trace/span primitives.
- `observability/metrics`: metric and cost records.
- `ai/providers`: model provider adapters.
- `ai/chat`: reusable chat runtime.
- `ai/mcp`: MCP runtime.
- `ai/memory`: generic memory interfaces.
- `ai/context`: generic context interfaces.
- `ai/agent-platform`: agent runtime, registries, tools, skills, workflows, policies, memory, evaluation, and observability.

## Dependency Rule

```text
platform -> packages only
products -> platform + packages
apps/desktop-shell -> platform + product manifests
```
