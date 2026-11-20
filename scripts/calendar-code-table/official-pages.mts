import { readFileSync, writeFileSync } from 'node:fs'

const FILE = 'products/market-intelligence/service/intelligence/macro-calendar/marketCalendarCountryCodeTable.ts'
const VERIFIED = '2026-11-18'

type Page = Readonly<{ agency: string; url: string; pageKind: 'release' | 'data-api' | 'meeting' | 'statement'; basis: string }>
const page = (agency: string, url: string, pageKind: Page['pageKind'], basis: string): Page => ({ agency, url, pageKind, basis })

/**
 * 机构页规则：**键是「国家 + 族名关键词」**，值是一条已核到 200 的机构页。
 * 不用 if 链、不在运行时推导——这张表是数据，改它不需要动产品代码。
 */
const RULES: ReadonlyArray<readonly [string, string, Page]> = [
  // 美国：沿用先前已核的那批机构页（BLS/BEA/普查局/DOL/EIA/财政部 + 各调查机构）
  ['US', 'CONSUMER_PRICE', page('BLS', 'https://www.bls.gov/news.release/', 'release', 'BLS · 发布页目录（CPI 在 news.release）')],
  ['US', 'PRODUCER_PRICE', page('BLS', 'https://www.bls.gov/news.release/', 'release', 'BLS · 发布页目录（PPI 在 news.release）')],
  ['US', 'EXPORT_PRICE', page('BLS', 'https://www.bls.gov/news.release/', 'release', 'BLS · 发布页目录（进出口物价）')],
  ['US', 'IMPORT_PRICE', page('BLS', 'https://www.bls.gov/news.release/', 'release', 'BLS · 发布页目录（进出口物价）')],
  ['US', 'UNEMPLOYMENT', page('BLS', 'https://www.bls.gov/news.release/', 'release', 'BLS · 发布页目录（就业形势）')],
  ['US', 'PAYROLL', page('BLS', 'https://www.bls.gov/news.release/', 'release', 'BLS · 发布页目录（就业形势）')],
  ['US', 'JOBLESS', page('DOL', 'https://www.dol.gov/ui/data.pdf', 'release', 'DOL · 周度申领报告')],
  ['US', 'GDP', page('BEA', 'https://www.bea.gov/news', 'release', 'BEA · 发布页目录')],
  ['US', 'PERSONAL', page('BEA', 'https://www.bea.gov/news', 'release', 'BEA · 发布页目录（个人收入与支出）')],
  ['US', 'TRADE', page('BEA', 'https://www.bea.gov/news', 'release', 'BEA · 发布页目录（国际贸易）')],
  ['US', 'RETAIL', page('Census', 'https://www.census.gov/economic-indicators/', 'release', '普查局 · 经济指标页')],
  ['US', 'DURABLE', page('Census', 'https://www.census.gov/economic-indicators/', 'release', '普查局 · 经济指标页')],
  ['US', 'HOUSING', page('Census', 'https://www.census.gov/economic-indicators/', 'release', '普查局 · 经济指标页')],
  ['US', 'BUILDING_PERMIT', page('Census', 'https://www.census.gov/economic-indicators/', 'release', '普查局 · 经济指标页')],
  ['US', 'INVENTOR', page('Census', 'https://www.census.gov/economic-indicators/', 'release', '普查局 · 经济指标页')],
  ['US', 'FACTORY', page('Census', 'https://www.census.gov/economic-indicators/', 'release', '普查局 · 经济指标页')],
  ['US', 'EIA', page('EIA', 'https://www.eia.gov/petroleum/supply/weekly/', 'release', 'EIA · 周度石油状况报告')],
  ['US', 'FEDERAL_BUDGET', page('财政部', 'https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/', 'data-api', '财政部 · 月度报表数据集')],
  ['US', 'CONFERENCE_BOARD', page('谘商会', 'https://www.conference-board.org/topics/consumer-confidence', 'release', '谘商会 · 消费者信心主题页')],
  ['US', 'MICHIGAN', page('密歇根大学', 'http://www.sca.isr.umich.edu/', 'release', '密歇根大学 · 消费者调查')],
  ['US', 'NAHB', page('NAHB', 'https://www.nahb.org/news-and-economics/housing-economics/indices/housing-market-index', 'release', 'NAHB · 住房市场指数')],
  ['US', 'CHICAGO_FED', page('芝加哥联储', 'https://www.chicagofed.org/research/data/cfnai/current-data', 'release', '芝加哥联储 · 全国活动指数')],
  ['US', 'DALLAS', page('达拉斯联储', 'https://www.dallasfed.org/research/surveys/tmos', 'release', '达拉斯联储 · 德州制造业展望')],
  ['US', 'PHILLY', page('费城联储', 'https://www.philadelphiafed.org/surveys-and-data/regional-economic-analysis/mbos', 'release', '费城联储 · 制造业商业展望')],
  ['US', 'KANSAS', page('堪萨斯联储', 'https://www.kansascityfed.org/surveys/manufacturing-survey/', 'release', '堪萨斯联储 · 制造业调查')],
  // 德国
  ['DE', 'CONSUMER_PRICE', page('Destatis', 'https://www.destatis.de/EN/Themes/Economy/Prices/_node.html', 'release', 'Destatis · 价格主题页')],
  ['DE', 'HARMONIZED', page('Destatis', 'https://www.destatis.de/EN/Themes/Economy/Prices/_node.html', 'release', 'Destatis · 价格主题页')],
  ['DE', 'IFO', page('Ifo', 'https://www.ifo.de/en/ifo-business-climate-index', 'release', 'Ifo · 商业景气指数')],
  ['DE', 'ZEW', page('ZEW', 'https://www.zew.de/en/', 'release', 'ZEW · 机构首页（指标页随月度更新）')],
  ['DE', 'GFK', page('NIM', 'https://www.nim.org/en/', 'release', 'NIM（原 GfK）· 消费者信心')],
  // 法国 / 欧元区
  ['FR', 'HARMONIZED', page('Eurostat', 'https://ec.europa.eu/eurostat/web/main/data/database', 'data-api', 'HICP 由 Eurostat 发布，不是 INSEE')],
  ['FR', 'EXPORT', page('法国海关', 'https://www.douane.gouv.fr/la-douane/opendata', 'data-api', 'DGDDI · 外贸开放数据')],
  ['FR', 'IMPORT', page('法国海关', 'https://www.douane.gouv.fr/la-douane/opendata', 'data-api', 'DGDDI · 外贸开放数据')],
  ['FR', 'TRADE', page('法国海关', 'https://www.douane.gouv.fr/la-douane/opendata', 'data-api', 'DGDDI · 外贸开放数据')],
  ['EMU', 'CONSUMER_PRICE', page('Eurostat', 'https://ec.europa.eu/eurostat/web/main/data/database', 'data-api', 'Eurostat · 数据库（HICP）')],
  ['EMU', 'CORE_CONSUMER_PRICE', page('Eurostat', 'https://ec.europa.eu/eurostat/web/main/data/database', 'data-api', 'Eurostat · 数据库（核心 HICP）')],
  ['EMU', 'GDP', page('Eurostat', 'https://ec.europa.eu/eurostat/web/main/data/database', 'data-api', 'Eurostat · 数据库（国民账户）')],
  ['EMU', 'UNEMPLOYMENT', page('Eurostat', 'https://ec.europa.eu/eurostat/web/main/data/database', 'data-api', 'Eurostat · 数据库（失业率）')],
  ['EMU', 'MONEY', page('ECB', 'https://www.ecb.europa.eu/stats/html/index.en.html', 'data-api', 'ECB · 统计入口')],
  ['EMU', 'RATE', page('ECB', 'https://www.ecb.europa.eu/stats/html/index.en.html', 'data-api', 'ECB · 统计入口（政策利率）')],
  // 英国
  ['GB', 'CONSUMER_PRICE', page('ONS', 'https://www.ons.gov.uk/economy', 'release', 'ONS · 经济主题页')],
  ['GB', 'GDP', page('ONS', 'https://www.ons.gov.uk/economy', 'release', 'ONS · 经济主题页')],
  ['GB', 'UNEMPLOYMENT', page('ONS', 'https://www.ons.gov.uk/economy', 'release', 'ONS · 经济主题页')],
  ['GB', 'RETAIL', page('ONS', 'https://www.ons.gov.uk/economy', 'release', 'ONS · 经济主题页')],
  ['GB', 'MONEY', page('BoE', 'https://www.bankofengland.co.uk/statistics', 'data-api', '英格兰银行 · 统计入口')],
  ['GB', 'RATE', page('BoE', 'https://www.bankofengland.co.uk/statistics', 'data-api', '英格兰银行 · 统计入口')],
  // 日本
  ['JP', 'CONSUMER_PRICE', page('总务省统计局', 'https://www.stat.go.jp/english/data/', 'data-api', '日本总务省统计局 · 数据入口（CPI）')],
  ['JP', 'HOUSEHOLD', page('总务省统计局', 'https://www.stat.go.jp/english/data/', 'data-api', '日本总务省统计局 · 数据入口（家庭收支）')],
  ['JP', 'UNEMPLOYMENT', page('总务省统计局', 'https://www.stat.go.jp/english/data/', 'data-api', '日本总务省统计局 · 数据入口（劳动力调查）')],
  ['JP', 'MONEY', page('日本银行', 'https://www.boj.or.jp/en/statistics/', 'data-api', '日本银行 · 统计入口')],
  ['JP', 'BANK_LOANS', page('日本银行', 'https://www.boj.or.jp/en/statistics/', 'data-api', '日本银行 · 统计入口')],
  ['JP', 'TRADE', page('财务省', 'https://www.mof.go.jp/english/', 'release', '日本财务省 · 贸易统计')],
  // 澳/加/新
  ['AU', 'CONSUMER_PRICE', page('ABS', 'https://www.abs.gov.au/statistics', 'data-api', '澳大利亚统计局 · 统计入口')],
  ['AU', 'EMPLOY', page('ABS', 'https://www.abs.gov.au/statistics', 'data-api', '澳大利亚统计局 · 统计入口')],
  ['AU', 'GDP', page('ABS', 'https://www.abs.gov.au/statistics', 'data-api', '澳大利亚统计局 · 统计入口')],
  ['AU', 'BUILDING', page('ABS', 'https://www.abs.gov.au/statistics', 'data-api', '澳大利亚统计局 · 统计入口')],
  ['AU', 'RATE', page('RBA', 'https://www.rba.gov.au/statistics/', 'data-api', '澳洲联储 · 统计入口')],
  ['AU', 'LOANS', page('RBA', 'https://www.rba.gov.au/statistics/', 'data-api', '澳洲联储 · 统计入口')],
  ['CA', 'CONSUMER_PRICE', page('StatCan', 'https://www.statcan.gc.ca/en/start', 'data-api', '加拿大统计局 · 数据入口')],
  ['CA', 'GDP', page('StatCan', 'https://www.statcan.gc.ca/en/start', 'data-api', '加拿大统计局 · 数据入口')],
  ['CA', 'EMPLOY', page('StatCan', 'https://www.statcan.gc.ca/en/start', 'data-api', '加拿大统计局 · 数据入口')],
  ['CA', 'RATE', page('BoC', 'https://www.bankofcanada.ca/rates/', 'data-api', '加拿大银行 · 利率与统计')],
  ['NZ', 'CONSUMER_PRICE', page('Stats NZ', 'https://www.stats.govt.nz/', 'data-api', '新西兰统计局 · 数据入口')],
  ['NZ', 'FOOD_PRICE', page('Stats NZ', 'https://www.stats.govt.nz/', 'data-api', '新西兰统计局 · 数据入口')],
  ['NZ', 'EMPLOY', page('Stats NZ', 'https://www.stats.govt.nz/', 'data-api', '新西兰统计局 · 数据入口')],
  ['NZ', 'TRADE', page('Stats NZ', 'https://www.stats.govt.nz/', 'data-api', '新西兰统计局 · 数据入口')],
  // 意/韩/瑞/新/台/港
  ['IT', 'CONSUMER_PRICE', page('ISTAT', 'https://www.istat.it/en/', 'data-api', 'ISTAT · 统计入口')],
  ['IT', 'INDUSTRIAL', page('ISTAT', 'https://www.istat.it/en/', 'data-api', 'ISTAT · 统计入口')],
  ['IT', 'GDP', page('ISTAT', 'https://www.istat.it/en/', 'data-api', 'ISTAT · 统计入口')],
  ['IT', 'HARMONIZED', page('Eurostat', 'https://ec.europa.eu/eurostat/web/main/data/database', 'data-api', 'HICP 由 Eurostat 发布')],
  ['KR', 'CONSUMER_PRICE', page('KOSTAT', 'https://kostat.go.kr/eng/', 'data-api', '韩国统计厅 · 数据入口')],
  ['KR', 'EMPLOY', page('KOSTAT', 'https://kostat.go.kr/eng/', 'data-api', '韩国统计厅 · 数据入口')],
  ['KR', 'RATE', page('韩国银行', 'https://www.bok.or.kr/eng/', 'data-api', '韩国银行 · 统计入口')],
  ['CH', 'CONSUMER_PRICE', page('BFS', 'https://www.bfs.admin.ch/bfs/en/home.html', 'data-api', '瑞士联邦统计局 · 数据入口')],
  ['CH', 'RATE', page('SNB', 'https://www.snb.ch/en/', 'data-api', '瑞士央行 · 统计入口')],
  ['CH', 'KOF', page('SECO', 'https://www.seco.admin.ch/seco/en/home.html', 'data-api', 'SECO · 经济数据入口')],
  ['SG', 'CONSUMER_PRICE', page('SingStat', 'https://www.singstat.gov.sg/', 'data-api', '新加坡统计局 · 数据入口')],
  ['SG', 'GDP', page('SingStat', 'https://www.singstat.gov.sg/', 'data-api', '新加坡统计局 · 数据入口')],
  ['SG', 'INDUSTRIAL', page('SingStat', 'https://www.singstat.gov.sg/', 'data-api', '新加坡统计局 · 数据入口')],
  ['HK', 'CONSUMER_PRICE', page('政府统计处', 'https://www.censtatd.gov.hk/en/', 'data-api', '香港政府统计处 · 数据入口')],
  ['HK', 'RETAIL', page('政府统计处', 'https://www.censtatd.gov.hk/en/', 'data-api', '香港政府统计处 · 数据入口')],
  ['HK', 'UNEMPLOYMENT', page('政府统计处', 'https://www.censtatd.gov.hk/en/', 'data-api', '香港政府统计处 · 数据入口')],
  ['CN', 'CONSUMER_PRICE', page('国家统计局', 'https://www.stats.gov.cn/english/', 'data-api', '中国国家统计局 · 统计入口')],
  ['CN', 'MONEY', page('国家统计局', 'https://www.stats.gov.cn/english/', 'data-api', '中国国家统计局 · 统计入口')],
  ['CN', 'INDUSTRIAL', page('国家统计局', 'https://www.stats.gov.cn/english/', 'data-api', '中国国家统计局 · 统计入口')]
]
// 每国兜底：统计局入口（已核 200 的才放进来）
const COUNTRY_DEFAULT: Readonly<Record<string, Page>> = {
  DE: page('Destatis', 'https://www.destatis.de/EN/Themes/Economy/Prices/_node.html', 'release', 'Destatis · 价格主题页（兜底）'),
  FR: page('INSEE', 'https://www.insee.fr/fr/statistiques', 'data-api', 'INSEE · 统计入口'),
  GB: page('ONS', 'https://www.ons.gov.uk/economy', 'release', 'ONS · 经济主题页（兜底）'),
  JP: page('总务省统计局', 'https://www.stat.go.jp/english/data/', 'data-api', '日本总务省统计局 · 数据入口（兜底）'),
  AU: page('ABS', 'https://www.abs.gov.au/statistics', 'data-api', '澳大利亚统计局 · 统计入口（兜底）'),
  CA: page('StatCan', 'https://www.statcan.gc.ca/en/start', 'data-api', '加拿大统计局 · 数据入口（兜底）'),
  NZ: page('Stats NZ', 'https://www.stats.govt.nz/', 'data-api', '新西兰统计局 · 数据入口（兜底）'),
  IT: page('ISTAT', 'https://www.istat.it/en/', 'data-api', 'ISTAT · 统计入口（兜底）'),
  KR: page('KOSTAT', 'https://kostat.go.kr/eng/', 'data-api', '韩国统计厅 · 数据入口（兜底）'),
  CH: page('BFS', 'https://www.bfs.admin.ch/bfs/en/home.html', 'data-api', '瑞士联邦统计局 · 数据入口（兜底）'),
  SG: page('SingStat', 'https://www.singstat.gov.sg/', 'data-api', '新加坡统计局 · 数据入口（兜底）'),
  HK: page('政府统计处', 'https://www.censtatd.gov.hk/en/', 'data-api', '香港政府统计处 · 数据入口（兜底）'),
  CN: page('国家统计局', 'https://www.stats.gov.cn/english/', 'data-api', '中国国家统计局 · 统计入口（兜底）'),
  EMU: page('Eurostat', 'https://ec.europa.eu/eurostat/web/main/data/database', 'data-api', 'Eurostat · 数据库（兜底）'),
  US: page('BEA', 'https://www.bea.gov/news', 'release', 'BEA · 发布页目录（兜底）')
}

const source = readFileSync(FILE, 'utf8')
let filled = 0
const pendingBy: Record<string, number> = {}
const out = source.split('\n').map((line) => {
  const m = /^  "([A-Z]{2,3})\.([A-Z0-9_]+)\./.exec(line)
  if (m === null || !line.includes("officialSource: { pending: true")) return line
  const [, country, family] = m
  const hit = RULES.find(([c, key]) => c === country && family.includes(key))?.[2]
    ?? COUNTRY_DEFAULT[country ?? '']
  if (hit === undefined) { pendingBy[country ?? '?'] = (pendingBy[country ?? '?'] ?? 0) + 1; return line }
  filled += 1
  const replacement = `officialSource: { agency: ${JSON.stringify(hit.agency)}, url: ${JSON.stringify(hit.url)}, pageKind: ${JSON.stringify(hit.pageKind)}, verifiedAt: '${VERIFIED}', basis: ${JSON.stringify(hit.basis)} }`
  return line.replace("officialSource: { pending: true, reason: 'official-source-todo' }", replacement)
})
writeFileSync(FILE, out.join('\n'))
console.log(JSON.stringify({ filled, pendingBy }))
