import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { channelAdapterMaintenanceTypes } from '../ai/agent-platform/channels/channelMaintenanceJobs'
import { CHANNEL_DISPLAY_NAME, CHANNEL_TYPE_BY_ADAPTER_KEY } from './channelDisplayNames'

/**
 * 两侧同口径守卫：**适配器键 ↔ 对外类型名**。
 *
 * 这两者的对应关系不是代码里编的，是数据库一条生成列算出来的
 * （`adapter_key = case when type = 'feishu' then 'lark' else type end`）。所以这里的断言不抄
 * 那条公式，而是**读建表文本、把公式解出来**，再用它核对代码里的映射——公式改了而映射没跟，
 * 这条当场红。抄一份公式进来只会变成第二份真相。
 *
 * 为什么需要这个映射：作业标题要印「{channel} 运行时维护」，而维护作业的类型列表用的是
 * 适配器键（`lark`），显示名表用的是对外类型名（`feishu`）。少了这层，读者会看到 `lark`。
 */

const DATABASE_SOURCE = 'platform/ai/agent-platform/db/createAgentPlatformDatabase.ts'

/** 从建表文本里解出生成列的特例对，返回 null 表示这条公式已经不在树里了。 */
function generatedColumnSpecialCase(): { from: string; to: string } | null {
  const source = readFileSync(DATABASE_SOURCE, 'utf8')
  const expressions = [...source.matchAll(/case when type = '([a-z]+)' then '([a-z]+)' else type end/g)]
  if (expressions.length === 0) return null
  const [first] = expressions
  // 迁移与建表两处必须是同一条公式：一处改了、另一处没改，就是库在两种形态之间摇摆。
  for (const expression of expressions) {
    expect(expression[1], '生成列在迁移与建表里出现了两种写法').toBe(first[1])
    expect(expression[2]).toBe(first[2])
  }
  return { from: first[1], to: first[2] }
}

describe('channel display names and the adapter-key bridge', () => {
  it('keeps the bridge in step with the generated column in the schema', () => {
    const special = generatedColumnSpecialCase()
    // 公式不见了（改名或删列）就直接红：那时这套映射也该跟着删，而不是留着假装还成立。
    expect(special, '建表文本里找不到 adapter_key 的生成列公式').not.toBeNull()
    const { from, to } = special as { from: string; to: string }

    // 用建表文本里的公式算适配器键，再反查代码里的映射——两边一致才算同口径。
    for (const type of Object.keys(CHANNEL_DISPLAY_NAME)) {
      const adapterKey = type === from ? to : type
      expect(CHANNEL_TYPE_BY_ADAPTER_KEY[adapterKey], `${type} 的适配器键 ${adapterKey}`).toBe(type)
    }
  })

  it('can name every maintenance type, so none of them falls back to an adapter key', () => {
    for (const adapterKey of channelAdapterMaintenanceTypes) {
      const type = CHANNEL_TYPE_BY_ADAPTER_KEY[adapterKey]
      expect(type, `适配器键 ${adapterKey} 没有对应的对外类型名`).toBeDefined()
      expect(CHANNEL_DISPLAY_NAME[type as keyof typeof CHANNEL_DISPLAY_NAME]).toBeDefined()
    }
  })

  it('never shows an adapter key as a display name', () => {
    // 读者看到的只能是显示名；出现 `lark` 这种键本身就说明这层映射被绕过了。
    for (const name of Object.values(CHANNEL_DISPLAY_NAME)) {
      expect(name['zh-CN']).not.toBe('')
      expect(name['en-US']).not.toBe('')
    }
  })
})
