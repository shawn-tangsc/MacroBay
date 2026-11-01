/**
 * How many facts one analysis context may carry, and how that budget is split between domains.
 *
 * These are running numbers, not shape: changing one changes what a context contains, never what a
 * caller compiles against. They lived in `contracts/marketAnalysisContracts.ts` until a reader could
 * no longer tell a contract from a tuned parameter, and were moved here so the tuning is guarded by
 * this module's tests rather than sitting under a directory reviewers assume is frozen.
 *
 * The two size limits a context is measured against stay in the contract, because they bound what a
 * legal context *is*: `maximumCollectionItems` caps the facts any read may collect, and
 * `maximumModelOutputBytes` caps the serialised form.
 */
export const MARKET_ANALYSIS_CONTEXT_FACT_BUDGET = Object.freeze({
  /**
   * Share of the fact budget the macro domain may take. Providers kept filling the context with
   * routine macro rows (112 of 161 facts at one point) and truncated capital, sentiment,
   * funding and cross-asset away entirely, so conclusions said they lacked the numbers they
   * needed to explain anything.
   */
  maximumMacroFacts: 90,
  /**
   * Floor under the macro ceiling: every domain keeps at least this many of its newest facts.
   *
   * The ceiling stopped one provider filling the context, but the budget is still global and the
   * reading order puts funding and sentiment last, so adding a domain (cross-asset) removed theirs
   * entirely: the 16:21 snapshot kept macro 91 / capital 60 / cross-asset 10 and **no funding and
   * no sentiment facts at all**. Six covers the smallest domain's full series (funding holds five
   * points) plus one, and costs nothing from the volume domains beyond the budget they already had.
   */
  minimumFactsPerDomain: Object.freeze({
    /**
     * Funding now carries two series (the rate and the open interest behind it). A single
     * six-fact floor would let the newest of the two evict the other, and the pair is exactly
     * what this domain exists to read together; twelve keeps both.
     */
    default: 6,
    funding: 12
  } as Readonly<Record<string, number>>)
} as const)
