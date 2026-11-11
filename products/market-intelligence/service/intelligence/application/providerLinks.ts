import type { ProviderDefinition } from './providerRegistry'

/**
 * 供应商的对外链接与来源说明：**纯数据表，没有逻辑**。
 *
 * 从 `providerRegistry.ts` 抽出来的唯一原因是体积门禁：注册表本体只回答「有哪些源、怎么分组」，
 * 这张表只回答「这个供应商的官网 / 注册入口 / 来源说明是哪一条」。
 * `signupUrl` 是运营的邀请或注册入口，在系统浏览器里打开；键与注册表里的 `providerId` 一一对应，
 * 缺一条就是设置页少一个入口（一致性由 `sourceRegistryConsistency.test.ts` 审）。
 *
 * 形状用 `Pick<ProviderDefinition, …>` 派生，不另写一份——多一个字段就要两处对不上。
 * `import type` 在运行时被擦除，因此它不构成与 `providerRegistry.ts` 的循环依赖。
 */
export type ProviderLinks = Readonly<
  Record<string, Pick<ProviderDefinition, 'website' | 'signupUrl' | 'invite' | 'notice'>>
>

export const providerLinks: ProviderLinks = {
  fed: { website: 'https://www.federalreserve.gov/' },
  bea: { website: 'https://www.bea.gov/' },
  bls: { website: 'https://www.bls.gov/' },
  fred: { website: 'https://fred.stlouisfed.org/', signupUrl: 'https://fred.stlouisfed.org/docs/api/api_key.html' },
  treasury: { website: 'https://home.treasury.gov/' },
  sec: { website: 'https://www.sec.gov/' },
  cftc: { website: 'https://www.cftc.gov/' },
  binance: { website: 'https://www.binance.com/' },
  okx: { website: 'https://www.okx.com/' },
  coingecko: { website: 'https://www.coingecko.com/' },
  defillama: { website: 'https://defillama.com/' },
  alternative: { website: 'https://alternative.me/crypto/fear-and-greed-index/' },
  coindesk: { website: 'https://www.coindesk.com/' },
  ethereum: { website: 'https://ethereum.org/' },
  coinmarketcal: { website: 'https://coinmarketcal.com/', signupUrl: 'https://coinmarketcal.com/en/api' },
  cryptopanic: { website: 'https://cryptopanic.com/', signupUrl: 'https://cryptopanic.com/developers/api/' },
  '0xrouter': { website: 'https://0xrouter.app/', signupUrl: 'https://0xrouter.app/index.html?invite=tangscsh', invite: true, notice: 'private-data-source' },
  realmarketapi: { website: 'https://realmarketapi.com/', signupUrl: 'https://realmarketapi.com/?via=Macrobay', invite: true },
  'policy-path': { website: 'https://polymarket.com/zh?tag=fed' },
  twelvedata: { website: 'https://twelvedata.com/', signupUrl: 'https://twelvedata.com/pricing' },
  coinbase: { website: 'https://www.coinbase.com/' },
  kraken: { website: 'https://www.kraken.com/' },
  solana: { website: 'https://solana.com/' },
  github: { website: 'https://github.com/' }
}