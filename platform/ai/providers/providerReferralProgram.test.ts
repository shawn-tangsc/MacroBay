import { describe, expect, it } from 'vitest'

import {
  createSystemProviderPresets,
  PROVIDER_REFERRAL_INACTIVE_IDS,
  PROVIDER_REFERRAL_LINKS,
  PROVIDER_REFERRAL_PROGRAMS,
  providerHasReferralProgram,
  providerIsRecommended,
  providerReferralRank,
  systemProviderIds
} from './providerPresets'

/**
 * PLAT-62 追加：邀请有礼规则（纯展示元数据，不进契约/持久化）。
 * 口径：文档中「当前有效」且「有明确奖励规则」的活动；与“我们是否已有链接”解耦。
 * 已结束/未确认的（sophnet、stepfun）不列入；burncloud 只有控制台文案（比例随机型浮动、
 * 仅限算力租赁消费、仅邀请人获益），不满足该口径，不进推荐但保留 aff 链接。
 */
const expectedRewards: Record<string, string> = {
  mimo: '双方各 ¥10',
  hyperbolic: '被邀充值 ≥$5 后邀请人得 $5、被邀得 $6',
  qiniu: '双方各 300 万 tokens',
  dashscope: '邀新首购最高 1000 元代金券',
  lanyun: '双方得代金券',
  aionly: '邀请得金币/佣金，可提现',
  cephalon: '邀请码绑定额度，金额未公开',
  doubao: '限时邀请有礼：Coding / Agent Plan',
  anthropic: 'Pro/Max 送好友 7 天 + overage credits（订阅侧）',
  openai: 'OpenAI 推荐 credits（订阅侧）',
  moonshot: '登月同行抽奖会员额度（消费端）',
  zai: '订阅邀请码（ic=）：邀请方与被邀请方按活动规则获得额度/折扣',
  tokenrhythm: '注册并完成实名认证领 18 元 Token 额度',
  silicon: '邀请注册：邀请方与被邀请方按活动规则获得额度奖励'
}

const excludedIds = ['sophnet', 'stepfun', 'aihubmix', 'burncloud', '302ai', 'moonshot']

describe('PLAT-62 provider referral programs', () => {
  it('lists the 15 currently-valid programs with a reward summary each', () => {
    expect(Object.keys(PROVIDER_REFERRAL_PROGRAMS).sort()).toEqual(Object.keys(expectedRewards).sort())
    for (const [providerId, reward] of Object.entries(expectedRewards)) {
      expect(PROVIDER_REFERRAL_PROGRAMS[providerId]?.reward, providerId).toBe(reward)
      // 302.AI 规则存在但已被 owner 下线（需先充值 100 才参与）。
      expect(providerHasReferralProgram(providerId), providerId).toBe(providerId !== 'moonshot')
    }
    expect(PROVIDER_REFERRAL_INACTIVE_IDS).toEqual(['moonshot'])
  })

  it('excludes ended/unconfirmed programs and providers without a reward rule', () => {
    for (const providerId of [...excludedIds, 'acme-custom', '']) {
      expect(providerHasReferralProgram(providerId), providerId).toBe(false)
    }
  })

  it('keeps burncloud promotable through its affiliate link without claiming a reward rule', () => {
    expect(providerHasReferralProgram('burncloud')).toBe(false)
    expect(PROVIDER_REFERRAL_LINKS.burncloud).toBe('https://ai.burncloud.com/register?aff=Uwn0')
    const burncloud = createSystemProviderPresets().find((provider) => provider.id === 'burncloud')
    expect(burncloud?.websites?.official).toBe('https://ai.burncloud.com/')
    expect(burncloud?.websites?.apiKey).toContain('aff=Uwn0')
  })

  it('records zai as a subscription referral with its note', () => {
    expect(providerHasReferralProgram('zai')).toBe(true)
    expect(PROVIDER_REFERRAL_PROGRAMS.zai?.reward).toContain('订阅邀请码')
    expect(PROVIDER_REFERRAL_PROGRAMS.zai?.note).toBe('规则以 z.ai 订阅页为准')
  })

  it('keeps referral links decoupled: silicon has a link but no listed program', () => {
    expect(Object.keys(PROVIDER_REFERRAL_LINKS).sort()).toEqual(['aionly', 'burncloud', 'cephalon', 'dashscope', 'lanyun', 'mimo', 'ph8', 'qiniu', 'silicon', 'tokenrhythm', 'zai'])
    expect(PROVIDER_REFERRAL_LINKS.silicon).toBe('https://cloud.siliconflow.cn/i/9GmeSjFn')
    expect(providerHasReferralProgram('silicon')).toBe(true)
  })

  it('drops an id once it is injected into the inactive list', () => {
    expect(providerHasReferralProgram('qiniu', ['qiniu'])).toBe(false)
    expect(providerHasReferralProgram('mimo', ['qiniu'])).toBe(true)
    expect(providerHasReferralProgram('qiniu')).toBe(true)
  })

  it('gives every program a unique ordering weight', () => {
    const ranks = Object.values(PROVIDER_REFERRAL_PROGRAMS).map((program) => program.rank)
    expect(new Set(ranks).size).toBe(ranks.length)
    for (const rank of ranks) expect(Number.isFinite(rank)).toBe(true)
    expect(providerReferralRank('mimo')).toBeLessThan(providerReferralRank('silicon')!)
  })

  it('recommends only providers that have both a link and an explicit program', () => {
    expect(providerIsRecommended('mimo')).toBe(true)
    // openai 有规则但没有我们的邀请链接；burncloud 有链接但没有明确规则。
    expect(providerIsRecommended('openai')).toBe(false)
    expect(providerIsRecommended('burncloud')).toBe(false)
    expect(providerIsRecommended('mimo', ['mimo'])).toBe(false)
    // 规则/金额不透明 ⇒ 产品显式不推荐，但活动仍登记（链接也保留）。
    for (const providerId of ['aionly', 'cephalon', 'zai']) {
      expect(providerIsRecommended(providerId), providerId).toBe(false)
      expect(providerHasReferralProgram(providerId), providerId).toBe(true)
    }
  })

  it('only references ids that exist in the preset catalog', () => {
    for (const providerId of Object.keys(PROVIDER_REFERRAL_PROGRAMS)) {
      expect(systemProviderIds, providerId).toContain(providerId)
    }
  })

  it('keeps the aihubmix affiliate link only on the key entry', () => {
    const aihubmix = createSystemProviderPresets().find((provider) => provider.id === 'aihubmix')
    expect(aihubmix?.websites?.apiKey).toBe('https://aihubmix.com/?aff=Rs0c')
    expect(aihubmix?.websites?.official).toBe('https://aihubmix.com')
  })
})
