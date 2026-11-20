import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { channelAdapterDescriptor } from '../../../ai/agent-platform/channels/channelAdapterDescriptors'
import { channelAdapterKeys, type ChannelAdapterKey } from '../../../ai/agent-platform/channels/ChannelManagementPredicates'

/**
 * 启用自检的**装配守卫**：每个已实现的适配器都必须在组合根的 `createChannelSmokeRouter({...})` 里
 * 有一条自己的自检。
 *
 * 为什么需要它：自检工厂写好了、却没被装配时，代码看起来一切正常，用户点启用却稳定得到
 * 「这个平台还没接上」（2026-11-11 飞书现场就是这么来的——工厂在，组合根里没有它）。
 * 这是「代码说能、实际不能」，靠人工看装配行迟早漏一个。
 */
const ADAPTER_TO_STORAGE_TYPE: Readonly<Record<ChannelAdapterKey, string>> = {
  telegram: 'telegram',
  slack: 'slack',
  lark: 'feishu',
  qq: 'qq',
  discord: 'discord',
  wechat: 'wechat'
}

function routerKeys(): string[] {
  const source = readFileSync(join(process.cwd(), 'platform/desktop/main/composition/repositories.ts'), 'utf8')
  const start = source.indexOf('smoke: createChannelSmokeRouter({')
  expect(start, '组合根里必须调用 createChannelSmokeRouter').toBeGreaterThan(-1)
  // 取到这一层调用的结尾：从对象的 `{` 起按**花括号**配平，避免把后面的代码当成路由表。
  const open = source.indexOf('{', start)
  let depth = 0
  let end = open
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) { end = index; break }
    }
  }
  const block = source.slice(open, end + 1)
  // 顶层键：缩进四空、以 `名字:` 开头的那几行（适配器工厂内部的参数更深一层，不会命中）。
  return [...block.matchAll(/^ {4}([a-z]+):/gmu)].map((match) => match[1]!)
}

describe('every implemented adapter has its own enable smoke wired', () => {
  it('wires exactly the implemented adapters, and no implemented one is missing', () => {
    const expected = channelAdapterKeys
      .filter((key) => channelAdapterDescriptor(key).implemented)
      .map((key) => ADAPTER_TO_STORAGE_TYPE[key])
      .sort()
    expect(routerKeys().sort()).toEqual(expected)
  })

  it('never routes an adapter to the "not supported" answer by omission', async () => {
    // 反过来读一遍：只要某个已实现适配器不在路由表里，用户点启用就会得到 adapter-not-supported。
    const keys = routerKeys()
    for (const key of channelAdapterKeys.filter((candidate) => channelAdapterDescriptor(candidate).implemented)) {
      expect(keys, `${key} 的自检没有装配`).toContain(ADAPTER_TO_STORAGE_TYPE[key])
    }
  })
})
