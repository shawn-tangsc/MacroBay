[English](./traceability.md) | [中文](./traceability.zh-CN.md)

# Traceability

Traceability is the product's main constraint: a displayed number should lead back to the record
that produced it and the time boundary at which it was valid.

## The evidence chain

```text
source registration
      ↓
raw record (as observed)
      ↓
normalized intelligence item
      ↓
impact or context on a market/asset
      ↓
published analysis
```

Each step keeps enough identity to move backward:

- the source that produced the record;
- the observation timestamp and the queried `asOf`;
- the normalized item identifier;
- the analysis or summary that used the item.

## Time boundaries

`asOf` is the **knowledge cutoff of the query**, not the observation time of a record. A historical
query carries an explicit `asOf`; anything published or observed after that instant must not appear
in the result, even if it is newer and more complete.

```text
asOf = 2026-10-22 10:00

CPI preliminary value published 10-20  → allowed
CPI official revision published 10-23  → excluded
```

The product distinguishes three timestamps:

| Timestamp | Meaning |
| --- | --- |
| `observedAt` | when the record was observed |
| `publishedAt` | when the source published or revised it |
| `asOf` | how far the query is allowed to know |

This matters for:

- reading a chart at a past moment;
- reconstructing what an analyst could have known;
- comparing an earlier conclusion with a later revision;
- macro releases that publish an official value after a preliminary one.

When the boundary is missing, the product should not silently use "now".

## Evidence excerpts

An analysis can include the exact excerpt or value that supports a claim. The reader should be able
to check:

- what the source said;
- when it was observed;
- whether the number was normalized or calculated;
- whether a later revision changed it.

## Gaps and uncertainty

Missing evidence is a first-class result. A source that is disabled, unhealthy, or unregistered
produces a visible gap. The product should not replace it with a generic feed or an invented value.

The same rule applies to model output: if the context needed to answer is absent, the answer should
say so.

## Provenance queries

The product exposes provenance through its own queries and agent tools. A provenance answer should
return the source, the observation boundary, and the record identity, not only a prose explanation.

## Next

- [Analysis workflow](./analysis-workflow.md)
- [Analyst agent](./analyst-agent.md)
- [Architecture](../platform/architecture.md)
