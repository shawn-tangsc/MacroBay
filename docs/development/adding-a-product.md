[English](./adding-a-product.md) | [中文](./adding-a-product.zh-CN.md)

# Adding a product

A product is a removable module registered through a manifest. The platform must not need to know
its domain.

## 1. Create the module

```text
products/<product-id>/
  product.manifest.ts
  service/
    bootstrap.ts
  desktop/
    pages/
```

A minimal product can start with only a manifest and a page.

## 2. Declare the manifest

The manifest describes what the shell should load:

- product id and display name;
- menu entries and pages;
- settings panels;
- service bootstrap;
- agent seeds or product tools.

Keep contribution ids stable. Renaming a page or settings panel changes deep links and persisted
preferences.

## 3. Add a service bootstrap

If the product owns background work, register it through the product service seam. Use the
platform job runtime for scheduled work; do not add a local interval or second queue.

The bootstrap receives platform dependencies (provider state, language, jobs, storage) rather than
constructing its own copies.

## 4. Add a page

Product pages live under the product's `desktop` folder. They should use platform UI conventions,
theme tokens, and i18n text owned by the product.

The shell loads the page through the generated registry, not through a direct import.

## 5. Generate and run

```bash
pnpm generate:products
pnpm dev
```

Check that the menu entry, page, and settings contribution appear only when the product is present.

## 6. Test removal

1. Delete `products/<product-id>`.
2. Regenerate the registry.
3. Start the app.

The shell must still start. If it fails, a platform or shell file still imports the product.

## 7. Add tests

At minimum:

- manifest and generated-registry projection;
- service bootstrap with fake dependencies;
- page-level rendering for the main route;
- a removal/boundary guard if the product contributes a critical seam.

## Next

- [Platform and products](../platform/platform-and-products.md)
- [Testing](./testing.md)
- [Architecture](../platform/architecture.md)
