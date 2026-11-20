/**
 * **机构 → 国家**（事实表，不是推断）。
 *
 * 用途：未映射行里有一批「源没给国家、标题里却有机构名」的行。机构归属是公开事实
 * （INSEE 是法国的统计局、Ifo 是德国的研究所），据此定国家**不是猜**；标题里没有机构名的行
 * 一律不适用，留给采集端补 `country_code`。
 *
 * 判据：一张表里出现两个不同国家 = 写错了；机构名必须能在**源标题原文**里出现。
 */
export const agencyCountry: Readonly<Record<string, string>> = Object.freeze({
  // 统计机构
  INSEE: 'FR', DGDDI: 'FR', CDAF: 'FR',
  Destatis: 'DE', Ifo: 'DE', ZEW: 'DE', GfK: 'DE', NIM: 'DE', BME: 'DE',
  ONS: 'GB', CIPS: 'GB', BRC: 'GB', CBI: 'GB', Rightmove: 'GB', RICS: 'GB', Halifax: 'GB', Nationwide: 'GB',
  ISTAT: 'IT', ADACI: 'IT',
  NBS: 'CN', Caixin: 'CN',
  KOSTAT: 'KR',
  DGBAS: 'TW',
  GSO: 'VN',
  SingStat: 'SG',
  KOF: 'CH', SECO: 'CH', SNB: 'CH',
  StatCan: 'CA', Ivey: 'CA',
  ABS: 'AU', NAB: 'AU', AIG: 'AU',
  'Stats NZ': 'NZ',
  BLS: 'US', BEA: 'US', 'Conference Board': 'US',
  // 央行
  ECB: 'EMU', BoE: 'GB', BoJ: 'JP', RBA: 'AU', BoC: 'CA', RBNZ: 'NZ',
  HKMA: 'HK', MAS: 'SG', CBC: 'TW', PBoC: 'CN'
})

/** 从源标题里认出机构：命中多个不同国家视为歧义，返回 undefined（不猜）。 */
export function countryByAgency(title: string): string | undefined {
  const hits = Object.entries(agencyCountry).filter(([agency]) => title.includes(agency))
  const countries = new Set(hits.map(([, country]) => country))
  return countries.size === 1 ? [...countries][0] : undefined
}
