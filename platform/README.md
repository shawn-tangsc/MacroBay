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
| `files` | Attachment handling: reading a text file preview with a size cap and a binary guard. |
| `observability` | Structured application log: one writer, in-writer rotation, redaction before write. |
| `time` | Time zone reading for server-side decisions: minutes-of-day in the configured zone. |
| `ai` | Model providers, chat runtime, agent platform, assistant platform, web search. |

Every area above has code behind it. `files` and `observability` were declared placeholders earlier and
are now implemented; if a directory ever holds only a placeholder again, this table must say so rather
than list it as an area.

Adding a top-level area means updating this file in the same commit that creates the directory. A new
directory that is not listed here makes the table wrong the moment it lands.

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
- `files/attachments`: the text file preview reader and its size cap.
- `observability/logging`: the single application log writer (rotation and redaction live inside it).
- `time`: time zone arithmetic used by server-side decisions, not display formatting (`ui/time` owns display).
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
