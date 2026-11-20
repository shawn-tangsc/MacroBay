import { cryptoEtfSourcePolicy } from './cryptoEtfSourcePolicy'
import { provider, src } from './sourceDefinitionBuilders'
import type { ProviderDefinition } from './providerRegistry'

/**
 * The CryptoETF ETF-flow provider, kept out of `providerRegistry.ts` so that data table stays a
 * readable size (the registry is a table; one provider growing it past the gate is the wrong trade).
 *
 * The switch: this source is the ETF reading now — it owns the dashboard cell, the briefing row and
 * a required slot in the crypto agent's activation group, replacing the old aggregate id.
 */
export const cryptoEtfProvider: ProviderDefinition = provider({
    providerId: cryptoEtfSourcePolicy.providerId,
    displayName: cryptoEtfSourcePolicy.displayName,
    category: 'crypto',
    credential: 'api-key',
    /* The switch keeps the key on this source: after the old aggregate source stops collecting
       there is no adapter left to derive an anchor from, and a derived anchor of nothing hides the
       key box entirely. */
    credentialSourceId: cryptoEtfSourcePolicy.sourceId,
    /* 四态行跟着这个 provider 走；它不再是一个「只验证密钥」的标记，所以不会锁开关。 */
    credentialStateLine: true,
    sources: [
      src({
        sourceId: cryptoEtfSourcePolicy.sourceId,
        summaryKey: `settings.intelligenceSources.sourceSummary.${cryptoEtfSourcePolicy.sourceId}`,
        displayName: 'CryptoETF ETF flows',
        /* The switch: it is the ETF reading now, so it owns the dashboard cell, the briefing row and
           a required slot in the crypto agent's activation group (it replaced the old aggregate id
           there). It keeps the product-owned collection flag: the collector is this product's own
           refresh, scheduled by the generic runtime at the fixed interval. */
        purposes: ['dashboard', 'briefing'],
        /* 声明「我能供 ETF 净流」。谁真的在供由解析器现算：开着 + 作业真注册 + 就绪。 */
        provides: ['etf-net-flow'],
        capabilities: { runNow: 'job', testConnection: true },
        readiness: 'live',
        adapterRef: cryptoEtfSourcePolicy.sourceId
      })
    ]
  })
