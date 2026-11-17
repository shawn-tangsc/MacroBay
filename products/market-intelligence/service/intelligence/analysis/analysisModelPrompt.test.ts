import { describe, expect, it } from 'vitest'

import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisMessages } from './analysisModelPrompt'

const asOf = '2026-10-07T09:06:14.792Z'

function snapshot(overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'h1',
    profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
    sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
    ...overrides
  } as EvidenceSnapshot
}

const systemPrompt = (input: EvidenceSnapshot = snapshot()) =>
  buildAnalysisMessages(input).find(message => message.role === 'system')!.content

describe('analysis model prompt trigger contract (R37)', () => {
  const triggerFact = {
    factId: 'triggered-news:item-1', domain: 'sentiment' as const, subject: 'BTC',
    metric: 'news-sentiment', value: 'bearish · strength 3/5 · confidence 80%｜title｜quote',
    unit: null, sourceId: 'coindesk-rss', sourceLabel: 'CoinDesk RSS', observedAt: asOf, asOf,
    freshness: 'fresh' as const, confidence: 0.8, comparability: 'not-comparable' as const, evidenceRefId: 'news:item-1'
  }
  const trigger = { source: 'intelligence-item' as const, itemId: 'item-1', factId: triggerFact.factId, evidenceRefId: 'news:item-1' }

  it('names the triggering news as the run cause and requires the four answers', () => {
    const system = systemPrompt(snapshot({ facts: [triggerFact], trigger }))
    expect(system).toContain('本次运行由**一条新闻**触发')
    // 触发项由载荷里的 trigger 段指名，而不是一个模型永远收不到的 `triggered-news:<itemId>`。
    expect(system).toContain('用户消息 trigger 段指向的就是它')
    expect(system).not.toContain('factId 为 `triggered-news:<itemId>`')
    expect(system).toContain('不要照抄标题')
    expect(system).toContain('用**当前数据**印证或否证它')
    expect(system).toContain('conclusion.newsImpact')
    expect(system).toContain('no-transmission')
    expect(system).toContain('cannot-determine')
  })

  it('hands the model a resolvable trigger with the news text in full', () => {
    // 线上那次：facts 里是 f90 句柄，规则却叫它找 `triggered-news:<itemId>`；而且事实值被 72 字
    // 截断，标题断在中间、源摘录整段没了。触发段要给出句柄和完整内容。
    const long = `${'x'.repeat(80)} HEADLINE-END｜QUOTE-END`
    const messages = buildAnalysisMessages(snapshot({
      facts: [{ ...triggerFact, value: long }], trigger,
      evidenceRefs: [{ evidenceRefId: 'news:item-1' }] as never
    }))
    const user = JSON.parse(messages.find(message => message.role === 'user')!.content) as Record<string, unknown>
    expect(user.trigger).toMatchObject({
      factRef: expect.stringMatching(/^f\d+$/),
      evidenceRef: expect.stringMatching(/^e\d+$/),
      subject: 'BTC',
      fact: long
    })
  })

  it('does not tell a news-triggered run that the change record is what triggered it', () => {
    // 两个互相矛盾的「本次运行由…触发」是模型跑偏的直接原因：它照着 change 那条写成了稳定币综述。
    const change = {
      sequence: 2, previousSnapshotHash: 'h0',
      facts: [{ factId: 'mi-fact-stablecoin', subject: 'BTC', domain: 'capital', metric: 'stablecoin-supply' }],
      missingDomainsAdded: [], missingDomainsRemoved: [], caveatsAdded: [], caveatsRemoved: [],
      evidenceRefsAdded: [], evidenceRefsRemoved: []
    }
    const withTrigger = systemPrompt(snapshot({ facts: [triggerFact], trigger, change } as never))
    expect(withTrigger).not.toContain('本次运行由输入 change 段里的变化触发')
    expect(withTrigger).toContain('**不是**本次运行的原因')
    const withoutTrigger = systemPrompt(snapshot({ change } as never))
    expect(withoutTrigger).toContain('本次运行由输入 change 段里的变化触发')
  })

  it('states the two checks the trigger-focus rule rejects on', () => {
    const system = systemPrompt(snapshot({ facts: [triggerFact], trigger }))
    expect(system).toContain('必须出现在论证区')
    expect(system).toContain('顶层 evidenceRefs 清单不算回答')
    expect(system).toContain('写出 `trigger.subject` 这个标的名称本身')
  })

  it('states the three prohibitions for a news reading', () => {
    const system = systemPrompt(snapshot({ facts: [triggerFact], trigger }))
    expect(system).toContain('不许只复述新闻')
    expect(system).toContain('不许硬贴利好利空')
    expect(system).toContain('不许把新闻里的金额直接当成市场影响')
  })

  it('keeps source attribution natural and rare, instead of prefixing every block', () => {
    // 用户看到的毛病：「该页面显示」在一篇里出现三次，摘要/变化/因果链各一次——像模板。
    const system = systemPrompt(snapshot({ facts: [triggerFact], trigger }))
    expect(system).toContain('来源归属要自然，别把它当每段的固定前缀')
    expect(system).toContain('「该消息称」「报道称」「据该报道」')
    expect(system).toContain('只有当来源确实是页面抓取、没有署名时，才写「该页面显示」')
    expect(system).toContain('来源归属**最多出现一次**')
    // 不得升格成既成事实的口径，这条仍然在。
    expect(system).toContain('**不得**写成「某方宣布」「官方表示」')
  })

  it('makes the summary agree with the trigger fact instead of contradicting it', () => {
    // 线上硬错：新闻说「ETF 流出连续期结束」，摘要写「ETF 持续净流出」，同一份的因果链又说「以单日
    // +790 万美元结束」——读者看第一行就得到相反的事实。这是事实一致性，不是句式。
    const system = systemPrompt(snapshot({ facts: [triggerFact], trigger }))
    expect(system).toContain('摘要里关于这条新闻的陈述，必须与 trigger.fact 的原文一致')
    expect(system).toContain('新闻说某段流出**结束**了，摘要就不能写它还**在持续**')
    expect(system).toContain('摘要与 causalChain 之间同样不许互相矛盾')
    expect(system).toContain('拿不准的部分**就不写**')
  })

  it('forbids prose about how the input is shaped, in every run', () => {
    // 线上原句「本次数据没有新变化，变化段为空；信息增量来自……」——读者看到的是输入长什么样。
    const system = systemPrompt()
    expect(system).toContain('正文不许交代「输入长什么样」')
    expect(system).toContain('「变化段为空」')
    expect(system).toContain('「信息增量来自…」')
    // 没有可比变化时仍要说一句读者能懂的话，只是不许描述段落结构。
    expect(system).toContain('市场读数没有新的变动，方向判断沿用上一次')
  })

  it('assigns each of the three blocks one job, and forbids repeating the same fact', () => {
    // 用户原话：「你自己看看里面的像不像一个真人对新闻的解读」——三块在同一件事上复述。
    const system = systemPrompt(snapshot({ facts: [triggerFact], trigger }))
    expect(system).toContain('三块各管一件事，不许互相复述')
    expect(system).toContain('`conclusion.summary` 一次说清「这条新闻 + 当前数据 → 方向/影响」')
    expect(system).toContain('`conclusion.change` 只写**数据本身**变在哪')
    expect(system).toContain('新闻作为起因**只提一次**')
    expect(system).toContain('同一条事实在一条解读里只出现一次')
  })

  it('stays out of runs that a news item did not trigger', () => {
    const system = systemPrompt(snapshot({ facts: [triggerFact] }))
    expect(system).not.toContain('本次运行由**一条新闻**触发')
    expect(system).not.toContain('conclusion.newsImpact')
    expect(system).not.toContain('来源归属要自然')
    expect(system).not.toContain('摘要里关于这条新闻的陈述')
  })
})

describe('analysis model prompt conclusion contract', () => {
  it('requires the conclusion to carry an explicit causal chain, not only a verdict and data', () => {
    const system = systemPrompt()
    // The reported defect: conclusions listed data and hedged instead of explaining
    // why the data would move the assets.
    expect(system).toContain('因果链')
    expect(system).toContain('起因事件 → 中间变量')
    expect(system).toContain('因此本判断成立的条件')
  })

  it('forbids presenting a conditional hypothesis as the only explanation', () => {
    const system = systemPrompt()
    expect(system).toContain('不得只写「若…可能…」')
    expect(system).toContain('必须用现有证据说明当前最可能的机制与作用方向')
    expect(system).toContain('不得把条件式假设当作唯一解释')
  })

  it('bounds the uncertainty claim instead of letting a missing field replace the reasoning', () => {
    const system = systemPrompt()
    expect(system).toContain('数据缺口只用于限定判断置信度')
    expect(system).toContain('不得用缺失字段代替机制说明')
  })

  it('pins the language-neutral direction keys instead of any text marker', () => {
    const system = systemPrompt()
    expect(system).toContain('conclusion.direction 只能取这五个 key')
    for (const key of ['bullish', 'bearish', 'range', 'undecided', 'mixed']) expect(system).toContain(key)
    expect(system).toContain('conclusion.change')
    expect(system).not.toContain('方向：<术语>')
  })

  it('forbids internal identifiers in the text a reader sees', () => {
    const system = systemPrompt()
    // The reported defect: the conclusion quoted `change-1d-usd`, `cross-asset` and `consensus`.
    expect(system).toContain('禁止出现内部标识符')
    expect(system).toContain('change-1d-usd')
    expect(system).toContain('市场预期值')
    expect(system).not.toContain('consensus 缺口')
  })

  it('hands the model names and magnitudes instead of identifiers and raw integers', () => {
    const messages = buildAnalysisMessages(snapshot({
      facts: [{
        factId: 'mi-fact-capital-stablecoins-change-1d-usd-index', domain: 'capital', subject: 'stablecoins',
        metric: 'change-1d-usd', value: -406_814_368.04333496, unit: 'USD', sourceId: '0xrouter', sourceLabel: '0xrouter',
        observedAt: asOf, asOf, freshness: 'fresh', confidence: 1, comparability: 'comparable', evidenceRefId: 'ev-1'
      }],
      missingDomains: ['cross-asset'],
      caveats: ['macro-calendar-consensus-unavailable']
    }))
    const user = JSON.parse(messages.at(-1)!.content) as {
      facts: readonly Record<string, unknown>[]
      missingDomains: readonly string[]
      caveats: readonly string[]
      marketReactionFactRefs: readonly string[]
    }

    expect(user.facts[0]).toMatchObject({ domain: '资金面', subject: '稳定币', metric: '1 日变化', value: '-4.07 亿美元', comparability: '可比' })
    expect(user.missingDomains).toEqual(['跨资产'])
    expect(user.caveats).toEqual(['缺少市场预期值'])
    // The two machine references the model must echo are short handles, and the eligible-reaction
    // list is handles too: quoting the stored encodings is what rejected whole analyses.
    const descriptive = user.facts.map(fact => {
      const { factRef: _ref, evidenceRef: _evidence, ...rest } = fact
      return rest
    })
    const { marketReactionFactRefs: reactionRefs, ...narration } = user
    expect(reactionRefs).toEqual(['f1'])
    expect(JSON.stringify({ ...narration, facts: descriptive }))
      .not.toMatch(/change-1d-usd|cross-asset|stablecoins|macro-calendar-consensus-unavailable|406814368/)
    // Neither the stored encoding nor the internal item id reaches the model any more.
    expect(messages.at(-1)!.content).not.toContain('mi-fact-capital-stablecoins-change-1d-usd-index')
  })

  it('hands over the fact ids a market reaction may cite, and not the ones the validator refuses', () => {
    const base = {
      factId: 'mi-fact-eligible', domain: 'cross-asset' as const, subject: 'BTC', metric: 'price-return',
      value: 1, unit: 'percent', sourceId: '0xrouter', sourceLabel: '0xrouter', observedAt: asOf, asOf,
      confidence: 1, evidenceRefId: 'ev-1'
    }
    const messages = buildAnalysisMessages(snapshot({
      facts: [
        { ...base, comparability: 'comparable', freshness: 'fresh' },
        { ...base, factId: 'mi-fact-stale', comparability: 'comparable', freshness: 'stale' },
        { ...base, factId: 'mi-fact-excerpt', metric: 'event-excerpt', comparability: 'not-comparable', freshness: 'stale' }
      ]
    }))
    const user = JSON.parse(messages.at(-1)!.content) as { marketReactionFactRefs: readonly string[] }

    // A reaction built on either of the other two is refused as `ineligible-market-reaction`,
    // so the prompt names the eligible set instead of leaving it to be inferred.
    expect(user.marketReactionFactRefs).toEqual(['f1'])
    expect(systemPrompt()).toContain('marketReaction 的 factIds 只能取自输入里的 marketReactionFactRefs')
    expect(systemPrompt()).toContain('不得追加第二项')
    expect(systemPrompt()).toContain('只能填这些句柄原文')
  })
})

it('asks for the verdict before the change record, as separate fields', () => {
  const system = systemPrompt() as unknown as string
  // The old template embedded the verdict, the change and the causal chain in one paragraph, which
  // is how an entry ended up published with a direction and a change list but no verdict.
  expect(system).toContain('conclusion.summary 必须先写结论')
  expect(system).toContain('只给方向、没有结论句的输出会被直接拒绝发布')
  expect(system).toContain('"conditions"')
  expect(system).toContain('"dataGaps"')
})

describe('analysis prose language', () => {
  const systemFor = (language: 'zh-CN' | 'en-US') =>
    buildAnalysisMessages(snapshot(), [], undefined, language).find(message => message.role === 'system')!.content

  it('names the reader language while keeping one language-neutral contract', () => {
    const english = systemFor('en-US')
    expect(english).toContain('输出语言：英语（en-US）')
    // The contract is the same in every language: no per-language token vocabulary to maintain.
    for (const key of ['bullish', 'bearish', 'range', 'undecided', 'mixed']) expect(english).toContain(key)
    expect(english).not.toContain('Direction: <term>')
    expect(english).not.toContain('Causal chain')

    expect(systemFor('zh-CN')).toContain('输出语言：中文（zh-CN）')
  })

  it('adds a language without touching the contract', () => {
    // A future locale only names itself; the field structure and keys stay identical.
    const french = buildAnalysisMessages(snapshot(), [], undefined, 'fr-FR' as never)
      .find(message => message.role === 'system')!.content
    expect(french).toContain('（fr-FR）')
    expect(french).toContain('"direction"')
    expect(french).toContain('bullish')
  })

  it('formats input magnitudes in the prose language so the model cannot copy the wrong units', () => {
    const flow = {
      factId: 'mi-fact-capital-stablecoins-change-30d-usd', domain: 'capital' as const, subject: 'stablecoins',
      metric: 'change-30d-usd', value: -4_483_000_000, unit: 'USD', sourceId: '0xrouter', sourceLabel: '0xrouter',
      observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-1'
    }

    const english = buildAnalysisMessages(snapshot({ facts: [flow] }), [], undefined, 'en-US')
    const englishUser = JSON.parse(english.at(-1)!.content) as { facts: readonly Record<string, unknown>[] }
    expect(englishUser.facts[0]!.value).toBe('-$4.48B')
    expect(english.at(-1)!.content).not.toContain('亿美元')
    // The instruction names the unit spelling too, so an existing English rendering cannot copy 亿.
    expect(english.find(message => message.role === 'system')!.content).toContain('不得出现「亿」')

    const chinese = buildAnalysisMessages(snapshot({ facts: [flow] }), [], undefined, 'zh-CN')
    expect((JSON.parse(chinese.at(-1)!.content) as { facts: readonly Record<string, unknown>[] }).facts[0]!.value).toBe('-44.83 亿美元')
  })
  it('weighs the key sentiment only when the snapshot actually carries it', () => {
    const news = {
      factId: 'mi-fact-news-1', domain: 'sentiment' as const, subject: 'market', metric: 'news-sentiment',
      value: '看空（强度 4/5，置信 80%）｜交易所故障', unit: null, sourceId: 'coindesk-rss', sourceLabel: 'coindesk-rss',
      observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 0.8, comparability: 'not-comparable' as const, evidenceRefId: 'ev-1'
    }
    const withNews = systemPrompt(snapshot({ facts: [news] }))
    expect(withNews).toContain('新闻舆情')
    expect(withNews).toContain('不能当作行情证据')
    expect(withNews).toContain('marketReaction 仍然只能引用 marketReactionFactRefs')

    // The rule names a section that is not there in every other run; adding it unconditionally
    // would invite the model to reason about an empty block.
    expect(systemPrompt()).not.toContain('新闻舆情')
  })
})

describe('policy path prompt rules', () => {
  const policyFact = {
    factId: 'mi-fact-macro-policy-implied-probability-hike-25-2026-11-04', domain: 'macro' as const, subject: 'hike-25',
    metric: 'policy-implied-probability', value: 71, unit: 'percent', sourceId: 'policy-path-market', sourceLabel: 'policy-path-market',
    observedAt: '2026-10-30T15:00:00.000Z', asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const,
    evidenceRefId: 'ev-policy', sourceUrl: 'https://polymarket.com/'
  }

  it('states the market-pricing and SEP-meeting rules only when the facts are present', () => {
    const system = systemPrompt(snapshot({ facts: [policyFact] }))
    expect(system).toContain('政策与市场定价')
    expect(system).toContain('预测市场盘口')
    expect(system).toContain('截至时刻')
    expect(system).toContain('YYYY-MM-DD 那场')
    expect(system).toContain('24 小时变化尚未可得')

    const without = systemPrompt()
    expect(without).not.toContain('政策与市场定价')
  })

  it('tells the first answer to write a rounded level, unsigned, with its own instant', () => {
    // `04` §3.4.1：正文用**约数**（约 77%），两位小数进留痕区——所以提示词不再要求「逐字同值」，
    // 而是要求取整写法 + 概率不带正负号 + 带符号只允许三种。
    // 前三句都曾只活在修复提示里，模型要等被拒一次才知道——第一次的钱白花了。
    const system = systemPrompt(snapshot({ facts: [policyFact] }))
    expect(system).toContain('约数')
    expect(system).toContain('不要和变化量混在一句里')
    expect(system).toContain('24 小时变化尚未可得')
    expect(system).toContain('不得换档或编造')
    expect(system).toContain('各自写出那条概率自己的截至时刻')
    // The target range is not a probability and must not be handed a market-pricing citation.
    expect(system).toContain('政策目标区间、SEP 中位数这类读数不是概率')
    // Avoiding the probability entirely is now a rejection; the first answer has to know that.
    expect(system).toContain('至少要写出一条概率')
  })

  it('hides the source URL from the model while naming the fact', () => {
    const messages = buildAnalysisMessages(snapshot({ facts: [policyFact] }))
    const user = JSON.parse(messages.at(-1)!.content) as { facts: readonly Record<string, unknown>[] }
    expect(user.facts[0]).toMatchObject({ metric: '下次会议市场定价概率', value: '71%', observedAt: '2026-10-30T15:00:00.000Z' })
    expect(JSON.stringify(user)).not.toContain('polymarket.com')
  })

  it('asks for a named gap when an enabled policy source has no reading', () => {
    const system = systemPrompt(snapshot({ caveats: ['policy-path-unavailable'] }))
    expect(system).toContain('政策路径数据不可用')
    expect(system).toContain('conclusion.dataGaps')
    expect(system).toContain('不得用「政策不确定」「政策中性」')
  })
})
