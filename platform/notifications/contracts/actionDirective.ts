/**
 * 「指向本条通知的动作指令」的唯一判定（契约 v2.50 / v2.57）。
 *
 * 为什么必须只有这一份：手机上是纯文本，没有可点的地方，所以正文里写「点开看全文」就是空承诺；
 * 而两处各写一张词表，第一次判不一致就没人知道该信哪条——今晚已经因此返工过。
 * 现在的三处消费点都调这里：推送守卫（`notificationPushActionGuard.test.ts`）、
 * 成品句子的拦截（`notificationRuntimeDelivery.ts`）、以及产品侧要用的判定接口。
 *
 * **判据是「指不指着本条通知」**，不是「出现了一个动词」：
 * - 挡：`点开`／`点一下`／`点这里`／`点击`／`点它`、`查看详情`／`打开详情`／`看全文`／
 *   `查看全文`／`打开全文`、`open it|this|that`／`tap it|this|that|here`／`click …`／`view details`；
 * - 不挡：裸 `打开`／`查看`（「去设置里打开代理」这种去向指引读者真能做到）、
 *   句首 `Open settings…`（同上），以及领域名词 `open interest`／`open orders`。
 *
 * 返回**命中的那一段原文**而不是布尔：诊断要能写清「因为哪句才没发」，否则只知被扣、不知扣了什么。
 */
const ACTION_DIRECTIVE_PATTERNS: readonly RegExp[] = [
  /点开/u,
  /点一下/u,
  /点这里/u,
  /点击/u,
  /点它/u,
  /查看详情/u,
  /打开详情/u,
  /看全文/u,
  /查看全文/u,
  /打开全文/u,
  /\bopen\s+(it|this|that)\b/iu,
  /\btap\s+(it|this|that|here)\b/iu,
  /\bclick\s+(it|this|that|here|to)\b/iu,
  /\bview\s+details\b/iu
]

export function findActionDirective(text: string): string | null {
  for (const pattern of ACTION_DIRECTIVE_PATTERNS) {
    const match = pattern.exec(text)
    if (match !== null) return match[0]
  }
  return null
}
