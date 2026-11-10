import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 日报设置抽屉里的三个区块标题（生成 / AI 编辑 / 平台那两样）和配置抽屉里的区块名，是同一屏上
 * 同一种东西：13 / 650。差一档（600）肉眼就能看出不齐——这一条把两边钉在一起，谁单独改一档就红。
 *
 * 只钉「字号 + 字重」两个值，不钉颜色和间距：那两项两处本来就不同（日报设置是内容段落，抽屉是
 * 设置行），把它们也绑在一起就成了假约束。
 */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `${selector} missing`).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

describe('drawer block titles', () => {
  it('use the same 13 / 650 step in the brief settings drawer and the config drawer', () => {
    const here = __dirname
    const brief = readFileSync(join(here, 'dailyBriefingSettingsDrawer.css'), 'utf8')
    const config = readFileSync(join(here, '../../settings/config-drawer/configDrawer.css'), 'utf8')

    for (const [name, css] of [
      ['brief settings heading', rule(brief, '.mi-briefing-settings__heading')],
      ['config drawer group title', rule(config, '.config-drawer__group-title')]
    ] as const) {
      expect(css, name).toContain('font-size: 13px')
      expect(css, name).toContain('font-weight: 650')
    }
  })
})
