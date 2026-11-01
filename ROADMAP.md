# Roadmap

MacroBay is under active iteration. This is a direction, not a dated commitment; the order and
scope may change as the product evolves.

## Agent platform

- [ ] **General-purpose agent and entry.** One always-available place to ask, backed by a
  platform-level agent that can consult every installed product's read tools.
- [ ] **Product-scoped sub-agents.** Let a parent agent delegate to focused sub-agents owned by a
  product, with separate prompts, tools, and evidence boundaries.
- [ ] **Parent-child agent runs.** Let a session hand work to sub-agent runs, follow their status in
  the parent conversation, and message them while they run. Exploratory: the value is unclear until
  there is real work that must run in parallel with separate context.
- [ ] **Channel notifications.** Route completed analysis, alerts, and approval requests to
  configured channels instead of only the in-app inbox.

## Investment intelligence

- [x] **News sentiment from curated text sources.** Per-item direction, strength and confidence
  with source, time and evidence; routine operational notices filtered out; optional translation.
- [ ] **Extend sentiment beyond news.** Add social and community sources to the existing sentiment
  surface, with the same source and time-boundary rules as other evidence.
- [ ] **Market data module.** Add a first-class market-data surface for instruments, quotes, candles,
  and market state.
- [ ] **Review and replay module.** Reconstruct a decision with the evidence that was available at
  the time, then compare it with what happened later.
- [ ] **Additional provider integrations.** Broaden free and low-cost coverage, including JEV.

## Platform

- [ ] Keep the model and agent runtime replaceable rather than tied to one vendor.
- [ ] Keep product modules removable so the generic desktop runtime remains usable on its own.
- [ ] Expand tests, packaging, and release automation as the surface grows.

## Notes

- Items are added when the direction is clear, not when a date is known.
- A checked item means it shipped; unchecked means planned or exploring.
- Product-specific work stays in its product module; the platform only carries reusable contracts.
