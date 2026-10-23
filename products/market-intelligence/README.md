# Market Intelligence

The bundled MacroBay product: a traceable market-intelligence workbench.

It owns the intelligence domain end to end — sources, ingestion, normalization, assessment,
sentiment, macro calendar, the dashboard, and the analyst agent. The platform knows nothing about
it; the product registers itself through [`product.manifest.ts`](./product.manifest.ts).

## What it owns

| Path | Responsibility |
| --- | --- |
| `service/intelligence` | Source registry, adapters, pipeline, storage, queries, provenance |
| `service/intelligence/macro-calendar` | BLS, BEA, Federal Reserve, and Treasury release feeds |
| `desktop/pages/intelligence` | Dashboard, calendar, timeline, agent workspace |
| `desktop/settings/intelligence-sources` | Source configuration and health |
| `desktop/shared/i18n` | Product copy in `zh-CN` and `en-US` |
| `agents` | Product agent seeds, skills, and workflow definitions |
| `tools` | Agent tools exposed through the manifest |
| `contracts` | IPC and agent-tool contracts |

## Source registry

Adding, removing, or renaming a source requires updating the registry in one change:

- `service/intelligence/application/sourceCatalog.ts`
- `service/intelligence/macro-calendar/calendarFeedRegistry.ts`
- `service/intelligence/application/intelligenceSourceVisibility.ts`
- `desktop/pages/intelligence/dashboardSourceConfigurationModel.ts`
- both locales in `desktop/shared/i18n/productText.ts`

A source that is not in the registry must not appear in settings, the dashboard, or the calendar.

## Public docs

- [Product overview](../../docs/product/overview.md)
- [Analysis workflow](../../docs/product/analysis-workflow.md)
- [Traceability](../../docs/product/traceability.md)
- [Analyst agent](../../docs/product/analyst-agent.md)
