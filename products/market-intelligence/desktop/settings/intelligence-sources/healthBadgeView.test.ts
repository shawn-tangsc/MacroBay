import { describe, expect, it } from 'vitest'

import { healthStateBadge } from './sourceHealthTone'

/**
 * 五态 → 药丸上的**词与色**（判据在 `sourceProjection.sourceHealthState`，这里只映射）。
 *
 * 这条是 `healthBadgeView` 那一条用例的接替者（原函数随 C16 删除）：过去视图层拿
 * `runtimeStatus` + 失败数自己判一遍，现在同一份事实只由服务端算、这里只把词与色对上。
 *
 * 守的是「词与色的对应」：不许出现「字数说坏了、颜色是灰的」。`off` 不给词——它盖住
 * 「没启用 / 取不到 / 没有读数」三种处境，写成「已关闭」会把「没有读数」说成读者的动作；
 * 「取不到」那一种行内另有「不可用」一句。
 */
describe('health state words and tones', () => {
  it('keeps the four worded states on their own word and tone', () => {
    expect(healthStateBadge('healthy')).toEqual({
      labelKey: 'settings.intelligenceSources.health.statuses.healthy',
      tone: 'ok'
    })
    expect(healthStateBadge('repeated-failures')).toEqual({
      labelKey: 'settings.intelligenceSources.health.statuses.multiple-failures',
      tone: 'bad'
    })
    expect(healthStateBadge('stale')).toEqual({
      labelKey: 'settings.intelligenceSources.health.statuses.data-stale',
      tone: 'warn'
    })
    expect(healthStateBadge('failed')).toEqual({
      labelKey: 'settings.intelligenceSources.health.statuses.failed',
      tone: 'bad'
    })
  })

  it('draws nothing for “off”, which covers three different situations', () => {
    expect(healthStateBadge('off')).toBeUndefined()
  })
})
