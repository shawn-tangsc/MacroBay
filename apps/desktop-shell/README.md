# Desktop Shell

`apps/desktop-shell` is the generic Electron desktop host.

It owns:

- Window lifecycle
- App shell layout
- Sidebar and tab host
- Preload security bridge
- Generated product-registry loading
- Generic settings entry points

It must not contain product-specific business logic. Product-specific pages and widgets belong under `products/<product-id>/desktop`.

## Product Boundary

`apps/desktop-shell` must not directly import concrete product implementation files such as:

```text
products/<product-id>/desktop/...
products/<product-id>/service/...
products/<product-id>/agents/...
```

The shell should only consume generated product registries under:

```text
products/generated/
```

Those generated files are produced from `products/*/product.manifest.ts`.

## Menu And Settings Discovery

The shell should discover product-visible pages and settings sections from generated shell registries, not from hand-maintained lists.

The shell merges:

- built-in shell menu items
- generated product menu entries
- built-in settings sections
- generated product settings entries

Deleting a product directory must remove its pages and settings sections without shell code changes.

## Renderer Shape

- `src/main.ts`: thin Electron main entry that defers to `platform/desktop`.
- `src/renderer/index.html`: renderer document shell.
- `src/renderer/src/assets`: shell-owned static assets.
- `src/renderer/src/i18n`: platform shell text bundles.
- `src/renderer/src/shell`: app chrome, navigation, settings, agent workspace, and product host slots.
- `src/renderer/src/styles.css`: shell-level global styles.
- `src/renderer/shared/types/platform-api.d.ts`: renderer-visible platform bridge types.

Shell UI is product-neutral. Product pages, settings sections, and widgets stay
under `products/<product-id>/desktop`. Tests live beside the code they cover.

## What Belongs Elsewhere

- Product menu registration belongs in `products/<product-id>/product.manifest.ts`.
- Product settings section registration belongs in `products/<product-id>/product.manifest.ts`.
- Product page modules belong in `products/<product-id>/desktop/pages`.
- Product settings modules belong in `products/<product-id>/desktop/settings`.
