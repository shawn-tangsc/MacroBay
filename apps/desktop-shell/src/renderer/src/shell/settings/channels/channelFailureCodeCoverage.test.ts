import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DELIVERY_NOT_SHOWN_CODES } from './channelLogs'
import { platformText } from '../../../i18n/platformText'
import { CHANNEL_FAILURE_REASON_CODES } from './channelSettingsPresentation'
import { CHANNEL_SUCCESS_CODES } from '@platform/ai/agent-platform/channels/ChannelManagementContracts'

const root = resolve(__dirname, '../../../../../..')
const channelServiceDir = resolve(root, '../../platform/ai/agent-platform/channels')

/**
 * 「码表必须覆盖代码里所有会返回的值」——用户已经因为漏一个码，连着看到三次
 * 「暂时说不出具体原因」。所以这里把**服务层的码字面量**扫出来，和界面的文案表比对：
 *
 * - 失败码：文案表里必须有一句话；
 * - 成功码：界面不该把它当失败说，不进文案表；
 * - 明确只给日志用的码（投递类、本版未接入平台的运行时码）：列在下面的豁免表里，**每条都写原因**。
 *
 * 扫的是 `code:` / `stableErrorCode:` / `runtimeReason:` 三个位置，不是全文本——这三个位置就是
 * 「会一路传到读者眼前」的那几个出口。豁免表加一条，等于公开承认「这个码不给读者看」。
 */
const EXEMPT_LOG_ONLY: Readonly<Record<string, string>> = {
  'dispatch-conversation-unbound':
    '入站分发失败码：手机上那句回答由组合根的文案表给出（channelsAndJobs.ts），不进设置页失败码表',
  'lark-network-unavailable': '本版界面只接 Telegram；飞书未接入时的运行时码，用户看不到',
  'lark-provider-rejected': '同上',
  'lark-rate-limited': '同上',
  'slack-network-unavailable': '同上，Slack 未接入',
  'slack-provider-rejected': '同上',
  'slack-rate-limited': '同上'
}

const CODE_PATTERN = /(?:code|stableErrorCode|runtimeReason)\s*:\s*'([a-z][a-z0-9-]*)'/gu

/** 投递链上的码：它们可能出现在审计里，界面必须给它们一个明确的归属（显示 / 不显示 / 豁免）。 */
const DELIVERY_CODE_PATTERN = /'(channel-delivery-[a-z-]+|delivery-[a-z-]+|unknown-after-send)'/gu

/** 只在日志/内部状态里用、不上这一栏的投递码：每条都写清为什么不给读者看。 */
const DELIVERY_EXEMPT: Readonly<Record<string, string>> = {
  'channel-delivery-unknown': '投递层「结果不明」的内部状态；读者看到的那一档由 unknown-after-send 表达',
  'delivery-empty-output': '渲染出空正文的内部状态，属于实现缺陷，不是读者可理解的原因',
  'delivery-owner-invalid': '投递租约内部状态，读者无法据此做任何事',
  'delivery-retry-not-permitted': '重试是否允许的内部判定，读者看到的是最终结果',
  'delivery-transport-unknown': '传输层未知态；具体原因由 provider/network 码给出'
}

export function deliveryCodesIn(source: string): string[] {
  return [...source.matchAll(DELIVERY_CODE_PATTERN)].map((match) => match[1]!)
}

/** 把一段源码里的码位置上出现的字面量连同行号取出来（导出给「该命中」夹具用）。 */
export function scanCodeLiterals(source: string): { code: string; line: number }[] {
  const found: { code: string; line: number }[] = []
  for (const match of source.matchAll(CODE_PATTERN)) {
    const index = match.index ?? 0
    found.push({ code: match[1]!, line: source.slice(0, index).split('\n').length })
  }
  return found
}

function collect(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) collect(full, out)
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full)
  }
}

describe('every code the channel service can return has words', () => {
  it('covers each literal found in a code position with copy, a success code, or a documented exemption', () => {
    const files: string[] = []
    collect(channelServiceDir, files)
    // 投递类码由日志面板的「发送失败」那一类单独翻译（`channelLogDeliveryText`），也算有话说。
    const deliveryCopy = Object.keys(platformText['zh-CN'].settings.channelLogDeliveryText)
    const known = new Set<string>([
      ...CHANNEL_FAILURE_REASON_CODES,
      ...CHANNEL_SUCCESS_CODES,
      ...deliveryCopy,
      ...Object.keys(EXEMPT_LOG_ONLY)
    ])
    // 扫空目录等于永远是绿的：先把「真的扫到了东西」钉住，再比覆盖。
    expect(files.length).toBeGreaterThan(20)
    const seen = new Set<string>()
    const missing: string[] = []
    for (const file of files) {
      for (const { code, line } of scanCodeLiterals(readFileSync(file, 'utf8'))) {
        seen.add(code)
        if (!known.has(code)) missing.push(`${relative(root, file)}:${line} → ${code}`)
      }
    }
    // 至少扫到几个真实码，证明扫描模式本身没失效（比如格式变了）。
    expect(seen.has('channel-smoke-failed')).toBe(true)
    expect(seen.has('configuration-ready')).toBe(true)
    expect(missing).toEqual([])
  })

  it('has a plain sentence for every failure code in both locales, with no raw code in it', () => {
    for (const code of CHANNEL_FAILURE_REASON_CODES) {
      for (const labels of [platformText['zh-CN'].settings, platformText['en-US'].settings]) {
        const sentence = labels.channelFailureReason[code]
        expect(sentence.length).toBeGreaterThan(0)
        expect(sentence).not.toContain(code)
        expect(sentence).not.toContain('没有上报')
        expect(sentence).not.toContain('not reported')
      }
    }
  })

  it('gives every delivery code an owner: shown with copy, deliberately hidden, or exempt with a reason', () => {
    const files: string[] = []
    collect(channelServiceDir, files)
    const deliveryCopy = new Set(Object.keys(platformText['zh-CN'].settings.channelLogDeliveryText))
    const unclassified: string[] = []
    const seen = new Set<string>()
    for (const file of files) {
      for (const code of deliveryCodesIn(readFileSync(file, 'utf8'))) {
        if (seen.has(code)) continue
        seen.add(code)
        // `unknown-after-send` 有自己的整句（中性「不确定」那档），不在失败码表里。
        const classified =
          deliveryCopy.has(code) ||
          DELIVERY_NOT_SHOWN_CODES.has(code) ||
          Object.hasOwn(DELIVERY_EXEMPT, code) ||
          code === 'unknown-after-send'
        if (!classified) unclassified.push(`${code} (${relative(root, file)})`)
      }
    }
    // 扫不到东西的绿是假绿：先证明真的扫到了投递码。
    expect(seen.size).toBeGreaterThan(3)
    expect(unclassified).toEqual([])
  })

  it('catches an unknown delivery code — the fixture must fail, not pass', () => {
    expect(deliveryCodesIn("audit(id, 'delivery-brand-new-code')")).toEqual(['delivery-brand-new-code'])
  })

  it('catches an unknown code in a code position — the fixture must fail, not pass', () => {
    // 「该命中」夹具：守卫绿着但抓不到新码，等于没有守卫。
    const fixture = "const result = { ok: false, code: 'made-up-code' }\nconst again = { stableErrorCode: 'another-unknown' }"
    expect(scanCodeLiterals(fixture).map((entry) => entry.code)).toEqual(['made-up-code', 'another-unknown'])
    expect(scanCodeLiterals(fixture)[0]!.line).toBe(1)
  })
})
