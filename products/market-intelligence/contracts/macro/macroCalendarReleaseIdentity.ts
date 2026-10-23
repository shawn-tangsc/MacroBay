/**
 * 官方日历与 provider 日历的**同一条发布**怎么认出来（设计 145 §8 B）。
 *
 * 两条路线对同一次发布的措辞不同：官方按 `titleKey` 说「消费者物价指数（CPI）」，0xRouter 说
 * 「9月未季调消费者物价指数(年率)」。比较措辞认不出，比较结构（同国同时刻）会错杀——US 的 CPI、PPI、
 * 零售销售同在 8:30 ET，同国同时刻是**几条不同的发布**。所以身份是一张**命名映射**：每个已注册指标
 * 列出 provider 会用的标题关键词，命中哪个键就按那个键算同一条发布。
 *
 * 三条约束，方向都是"宁可重复，也不要把两条不同的发布合成一条"：
 *
 * 1. 关键词尽量**带上口径**（年率 / 月率 / 环比年化）。同一个指标的年率与月率是两次不同的发布，
 *    设计 117 已经明确排除「平均时薪年率」匹配官方那条月率；
 * 2. `excluded` 把「核心」与「整体」分开（核心 CPI 命中不了 `cpi`，核心 PCE 命中不了 `pce`），
 *    把失业率与初请失业金分开；
 * 3. 一个标题**命中两个键**、或**一个都不命中** → 都返回 `undefined`（=不合并）。歧义不是合并的机会，
 *    是这张表该被补充的地方；调用方据此留痕（见 `crossAssetEventLines` 的 `identityUnconfirmed`）。
 *
 * 这张表也供事实/触发侧使用（设计 146 A-3）：同一条发布若从两条路线各来一次，必须有同一个身份。
 * 表里没有"provider 事件该叫什么名字"——那是设计 145 §8 D 的事，provider 的长尾事件用它自己的
 * `displayName`。
 */
export const providerReleaseIdentityPolicy = Object.freeze({
  version: 'marketIntelligenceProviderReleaseIdentity.v1',
  /**
   * 归一化时抹掉的东西：空白、全角/半角标点、大小写。它们不是发布身份的一部分——
   * 「9月未季调消费者物价指数(年率)」与「9月未季调消费者物价指数年率」是同一条。
   */
  noise: /[\s\u3000·・:：,，.。;；!！?？'"“”‘’()（）[\]【】<>《》/／\\|+＋%％\-—_]/gu,
  /** 命中两个键时是否合并。固定为 false：歧义要人去补表，不要机器去猜。 */
  ambiguousMatchMerges: false
})

export type RegisteredReleaseIdentity = Readonly<{
  /** 官方路线的 `titleKey`，也是事实侧 `analysisModelVocabulary.eventName` 的键。 */
  titleKey: string
  /** 命中其一即认为这条 provider 标题属于该发布（前半句是中文写法的观测/候选，后半句是英文）。 */
  keywords: readonly string[]
  /** 命中即**否决**该发布：核心/整体、月率/年率、失业率/初请这类必须分开的相邻发布。 */
  excluded: readonly string[]
}>

/**
 * 九个已注册发布的 provider 措辞。
 *
 * 关键词来自三处可查的来源，不凭印象：设计 117 §"官方匹配候选"列的 0xRouter 口径（CPI 年率、
 * 季调后非农就业人口变动、平均每小时工资月率、实际 GDP 环比年化…）、已观测到的 provider 标题
 * （「9月未季调消费者物价指数(年率)」见 `crossAssetMarketEventLines.ts`），以及英文端的规范叫法。
 * 表可以不全：漏掉的后果是图上多一条（可见），错并的后果是图上少一条（看不出来）。
 */
export const registeredReleaseIdentities: readonly RegisteredReleaseIdentity[] = Object.freeze([
  {
    titleKey: 'cpi',
    keywords: ['消费者物价指数年率', '消费者价格指数年率', 'cpi年率', 'consumer price index yoy', 'cpi yoy'],
    excluded: ['核心', 'core']
  },
  {
    titleKey: 'core-cpi',
    keywords: ['核心消费者物价指数年率', '核心消费者价格指数年率', '核心cpi年率', 'core consumer price index yoy', 'core cpi yoy'],
    excluded: []
  },
  {
    titleKey: 'nonfarm-payrolls',
    keywords: ['非农就业人口', '非农就业人数', '非农', 'nonfarm payrolls', 'nonfarm employment change'],
    excluded: ['失业率', 'unemployment']
  },
  {
    titleKey: 'unemployment',
    keywords: ['失业率', 'unemployment rate'],
    excluded: ['初请', '失业金', 'claims', 'jobless']
  },
  {
    titleKey: 'average-hourly-earnings',
    keywords: ['平均每小时工资月率', '平均时薪月率', 'average hourly earnings mom', 'average hourly earnings m/m'],
    excluded: ['年率', 'yoy']
  },
  {
    titleKey: 'pce',
    keywords: ['pce物价指数年率', 'pce价格指数年率', 'pce年率', 'pce price index yoy', 'pce yoy'],
    excluded: ['核心', 'core']
  },
  {
    titleKey: 'core-pce',
    keywords: ['核心pce物价指数年率', '核心pce价格指数年率', '核心pce年率', 'core pce price index yoy', 'core pce yoy'],
    excluded: []
  },
  {
    titleKey: 'gdp',
    keywords: ['实际gdp环比年化', 'gdp环比年化', 'real gdp qoq annualized', 'gdp qoq annualized'],
    excluded: ['名义', '平减', '同比', 'nominal', 'deflator']
  },
  {
    // provider 的央行活动今天不进竖线（`crossAssetMarketEventLinePolicy.eventType` 只收经济指标），
    // 但身份表是事实/触发侧共用的（设计 146），所以 FOMC 也在这里。
    titleKey: 'fomc',
    keywords: ['fomc', '美联储利率决议', '联邦基金利率', 'federal funds rate'],
    excluded: ['讲话', '纪要', 'speech', 'minutes']
  }
])

/** 只做措辞归一：见 `providerReleaseIdentityPolicy.noise`。 */
export function normalizedReleaseText(title: string): string {
  return title.replace(providerReleaseIdentityPolicy.noise, '').toLowerCase()
}

/**
 * 一条 provider 标题对应的已注册发布键，`undefined` 表示**不合并**（没有映射，或命中多个）。
 *
 * 调用方拿到 `undefined` 时按"两条不同的发布"处理并留痕；拿到键时按同一条发布处理。
 */
export function providerReleaseTitleKey(title: string): string | undefined {
  const text = normalizedReleaseText(title)
  if (text.length === 0) return undefined
  const matched = registeredReleaseIdentities.filter(identity =>
    identity.keywords.some(keyword => text.includes(normalizedReleaseText(keyword))) &&
    !identity.excluded.some(token => text.includes(normalizedReleaseText(token))))
  return matched.length === 1 ? matched[0]!.titleKey : undefined
}

/**
 * 这个串是不是一个已注册发布键。
 *
 * 用于判断"这条线上的 `titleKey` 是不是发布身份"：官方行的 `titleKey` 就是它，provider 行只有
 * 经过映射才是；provider 未映射时带的是它自己的事件键（uuid），不能被当身份。
 */
export function isRegisteredReleaseKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && registeredReleaseIdentities.some(identity => identity.titleKey === value)
}
