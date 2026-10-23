/* ─────────────────────────────────────────────────────────────────────────────
 * PLAT-62 追加：邀请有礼（纯展示元数据，不进契约/持久化）。
 *
 * 口径：文档中「当前有效」且「有明确奖励规则」的邀请活动（与“我们是否已有链接”解耦，
 * 链接由用户陆续补）。活动结束/未确认有效的（sophnet、stepfun）不列入。
 * 某条活动下线时把它加进 `PROVIDER_REFERRAL_INACTIVE_IDS` 即可一键摘下。
 * ───────────────────────────────────────────────────────────────────────────── */

export type ProviderReferralProgram = {
  /** 一句话奖励规则要点（推荐组行的 title）。 */
  readonly reward: string
  /**
   * 推荐排序权重：**越小越好**。按「奖励确定性 + 双方是否获益 + 价值」人工排序，
   * 只影响左栏「推荐」组的展示顺序，不改变任何供应商能力。
   */
  readonly rank: number
  /** `false` = 规则仍登记，但不进左栏「推荐」组（产品决定，例如规则/金额不透明）。 */
  readonly recommended?: boolean
  readonly note?: string
}

export const PROVIDER_REFERRAL_PROGRAMS: Readonly<Record<string, ProviderReferralProgram>> = Object.freeze({
  // 双方固定金额/额度，规则最明确。
  mimo: { reward: '双方各 ¥10', rank: 10 },
  hyperbolic: { reward: '被邀充值 ≥$5 后邀请人得 $5、被邀得 $6', rank: 20 },
  qiniu: { reward: '双方各 300 万 tokens', rank: 30 },
  // 固定额度但单方获得，或需要指定商品首购。
  dashscope: { reward: '邀新首购最高 1000 元代金券', rank: 40 },
  tokenrhythm: { reward: '注册并完成实名认证领 18 元 Token 额度', rank: 50 },
  // 双方代金券，但金额随活动浮动。
  lanyun: { reward: '双方得代金券', rank: 60 },
  // 佣金/返现类：能提现，但单价或金额未公开。
  aionly: { reward: '邀请得金币/佣金，可提现', rank: 70, recommended: false },
  // burncloud 暂不列入：只有控制台前端文案（比例按机型浮动、仅限算力租赁消费、仅邀请人获益），
  // 没有可核验的固定规则，不满足「有明确奖励规则」的口径。aff 链接仍保留在 PROVIDER_REFERRAL_LINKS。
  cephalon: { reward: '邀请码绑定额度，金额未公开', rank: 80, recommended: false },
  // 订阅/套餐权益，不是 API 额度。
  doubao: { reward: '限时邀请有礼：Coding / Agent Plan', rank: 90 },
  anthropic: { reward: 'Pro/Max 送好友 7 天 + overage credits（订阅侧）', rank: 100 },
  openai: { reward: 'OpenAI 推荐 credits（订阅侧）', rank: 110 },
  moonshot: { reward: '登月同行抽奖会员额度（消费端）', rank: 120 },
  // 规则描述较泛，优先级靠后。
  zai: {
    reward: '订阅邀请码（ic=）：邀请方与被邀请方按活动规则获得额度/折扣',
    rank: 130,
    recommended: false,
    note: '规则以 z.ai 订阅页为准'
  },
  silicon: { reward: '邀请注册：邀请方与被邀请方按活动规则获得额度奖励', rank: 140, note: '规则以 siliconflow 活动页为准' }
})

/** 我们已有的邀请链接（可空、可陆续补；推荐身份不以它为前提）。 */
export const PROVIDER_REFERRAL_LINKS: Readonly<Record<string, string>> = Object.freeze({
  silicon: 'https://cloud.siliconflow.cn/i/9GmeSjFn',
  zai: 'https://z.ai/subscribe?ic=4UPMI1LUMO',
  mimo: 'https://platform.xiaomimimo.com?ref=YVDC37',
  aionly: 'https://maas.aiionly.com/login?inviteCode=8566406797',
  tokenrhythm: 'https://tokenrhythm.studio/i/rf_tr_C4LK8Z?share_id=ad1db639-8069-4f57-9c08-fa4a114a276d',
  dashscope: 'https://www.aliyun.com/benefit/ai/aistar?clubBiz=subTask..12939034..10274..',
  burncloud: 'https://ai.burncloud.com/register?aff=Uwn0',
  cephalon: 'https://cephalon.cloud/share/register-landing?invite_id=s2y8zQ',
  lanyun: 'https://console.lanyun.net/#/register?promoterCode=9847f33a11',
  qiniu: 'https://s.qiniu.com/EJraaq',
  ph8: 'https://ph8.co/register?inviteCode=2SeeX0yv'
})

/** 下线名单：加进来即从左栏「推荐」组中摘下（当前仅 moonshot）。 */
export const PROVIDER_REFERRAL_INACTIVE_IDS: readonly string[] = Object.freeze([
  // 月之暗面/Kimi：产品 owner 确认开放平台没有邀请有礼（"登月同行"是消费端活动，不适用 API）⇒ 不推荐。
  'moonshot'
])

/**
 * `inactiveIds` 可注入（默认读取 `PROVIDER_REFERRAL_INACTIVE_IDS`），便于测试验证“一键摘下”。
 */
/**
 * 我们**手上有邀请链接**的供应商（`PROVIDER_REFERRAL_LINKS` 里有非空值）。
 *
 * 左栏「推荐」组只收录**同时**有链接和明确奖励规则的家：只有活动没链接是空承诺，
 * 只有链接没规则则无法判断值不值得推荐。
 */
export function providerHasReferralLink(
  providerId: string,
  links: Readonly<Record<string, string>> = PROVIDER_REFERRAL_LINKS
): boolean {
  const link = links[providerId]
  return typeof link === 'string' && link.trim().length > 0
}

export function providerHasReferralProgram(
  providerId: string,
  inactiveIds: readonly string[] = PROVIDER_REFERRAL_INACTIVE_IDS
): boolean {
  return providerId in PROVIDER_REFERRAL_PROGRAMS && !inactiveIds.includes(providerId)
}

/** 推荐排序权重（越小越好）；没有活动/未登记 ⇒ 不参与推荐。 */
export function providerReferralRank(
  providerId: string,
  programs: Readonly<Record<string, ProviderReferralProgram>> = PROVIDER_REFERRAL_PROGRAMS
): number | null {
  return programs[providerId]?.rank ?? null
}

/**
 * 左栏「推荐」组的唯一判定：有链接 + 有明确奖励规则 + 未下线 + 未被产品显式排除
 * （`recommended: false`，例如 AIOnly/Cephalon/Z.ai 的规则或金额不透明）。
 */
export function providerIsRecommended(
  providerId: string,
  inactiveIds: readonly string[] = PROVIDER_REFERRAL_INACTIVE_IDS,
  links: Readonly<Record<string, string>> = PROVIDER_REFERRAL_LINKS,
  programs: Readonly<Record<string, ProviderReferralProgram>> = PROVIDER_REFERRAL_PROGRAMS
): boolean {
  if (!providerHasReferralLink(providerId, links)) return false
  if (!providerHasReferralProgram(providerId, inactiveIds)) return false
  return programs[providerId]?.recommended !== false
}
