# Platform

`platform` contains reusable AI desktop product infrastructure.

It must not depend on any product module. No file here should import from `products/*` or mention
product-specific business concepts. Products register themselves through the generated tables under
`products/generated` (manifests, agent seeds, services, shell registry).

## Areas

| Area | Contents |
| --- | --- |
| `desktop` | Electron host: main-process bootstrap, preload bridge, typed IPC, windows, native menu, tray. |
| `ui` | Product-neutral design system and reusable UI primitives. |
| `settings` | Generic settings schema and persistence adapters. |
| `storage` | Database access, cache governance, and file-backed persistence primitives. |
| `jobs` | Background job framework: runtime, handler registry, transport, archive, contracts. |
| `secrets` | Secret vault, encrypted blob storage, and channel credential storage. |
| `message-bus` | Cross-module message bus: contracts, runtime, store, IPC bridge, module-boundary guard. |
| `network` | Proxy-aware outbound HTTP and WebSocket adapters. |
| `notifications` | Notification contracts, runtime, store, desktop surface, IPC. |
| `product-registry` | Product discovery, manifest types, registry code generation, reserved routes, shell icon ids. |
| `workspace` | Workspace contracts and policies, panel/page registry, runtime, persistence. |
| `ai` | Model providers, chat runtime, agent platform, assistant platform, web search. |

`files` and `observability` are declared areas with no implementation yet: their only content is a
placeholder for `files/attachments` and `observability/logging`. Until code lands there, nothing in
`platform` provides attachment handling or logging, and no document should describe it as provided.

## Directory Notes

- `desktop/main`: Electron main-process bootstrap and per-capability IPC handler modules.
- `desktop/preload`: secure preload bridge.
- `desktop/ipc`: typed IPC channels, product IPC registry, task IPC envelope.
- `desktop/window`: window creation and lifecycle.
- `desktop/menu`: native menu construction.
- `desktop/tray`: tray integration.
- `ui/components`: product-neutral UI primitives (`loading` is the shared waiting standard).
- `ui/theme`: shared theme setup.
- `ui/icons`, `ui/images`, `ui/markdown`, `ui/time`, `ui/window`, `ui/shell`: shared renderer building blocks.
- `ui/agent-chat`: reusable chat surface.
- `settings/schema`: settings schemas.
- `settings/store`: settings persistence adapters.
- `storage/cache-governance`: cache ownership rules and boundary guard.
- `jobs/runtime`: job runner and scheduler.
- `jobs/registry`: job handler registration.
- `jobs/contracts`: job and run contracts.
- `jobs/transport`: job transport.
- `jobs/archive`: run archive and retention.
- `secrets/channels`: channel credential storage.
- `message-bus/boundary`: the cross-module boundary guard.
- `network`: `platformFetch` and `platformWebSocket` — the only allowed outbound transports.
- `workspace/registry`: workspace panel and page registration.
- `workspace/runtime`, `workspace/persistence`: workspace runtime and its storage.
- `ai/providers`: model provider adapters and provider store.
- `ai/chat`: reusable chat runtime.
- `ai/model-defaults`: default model selection.
- `ai/invocation`: model invocation contracts.
- `ai/assistant-platform`: assistant library and runtime.
- `ai/agent-platform`: agent runtime, repositories, channels, tools, skills, MCP, schemas, seeds.
- `ai/web-search`: web search providers and routing.

## Routing And Navigation

There is no `platform/routing` layer, and there should not be a second one. Route, navigation, and
workspace-page registration are owned by:

- `product-registry/reservedRoutes.ts`: route ids reserved by the platform.
- `product-registry/generate.ts` and `validate.ts`: discovery and generation of the per-product registry.
- `product-registry/shellIconIds.ts`: the icon ids the shell accepts.
- `workspace/registry`: how a product registers workspace panels and pages.
- `apps/desktop-shell/src/renderer/src/shell/navigation/builtInNavEntries.ts`: built-in sidebar entries.
- `apps/desktop-shell/src/renderer/src/shell/navigation/mergeShellNavigation.ts`: merging built-in and
  product-contributed navigation.

## Dependency Rule

```text
platform -> packages only
products -> platform + packages
apps/desktop-shell -> platform + product manifests
```
