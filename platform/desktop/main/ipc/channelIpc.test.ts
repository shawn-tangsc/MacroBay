import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ChannelIpcPorts } from './channelIpc'

const { registerChannelIpc } = await import('./channelIpc')

/** 25 个渠道管理通道：顺序即注册顺序。 */
const MANAGEMENT_CHANNELS = [
  'platform:channels-catalog',
  'platform:channels-list',
  'platform:channels-list-delivery-targets',
  'platform:channels-get',
  'platform:channels-create',
  'platform:channels-update',
  'platform:channels-disable',
  'platform:channels-request-enable',
  'platform:channels-restart',
  'platform:channels-delete',
  'platform:channels-credential-begin',
  'platform:channels-credential-submit',
  'platform:channels-credential-rotate',
  'platform:channels-policy-begin',
  'platform:channels-policy-create',
  'platform:channels-list-audits',
  'platform:channels-runtime-status',
  'platform:channels-list-delivery-attempts',
  'platform:channels-list-delivery-audits',
  // 设置页「日志 → 运行异常」的只读一页（keyset 游标，服务端夹 limit ≤ 200）。
  'platform:channels-list-runtime-audits',
  // 设置页「发一条测试消息」真走一次投递（只发，不改配置）。
  'platform:channels-send-test-message',
  'platform:channels-list-policies',
  'platform:channels-delete-policy',
  'platform:channels-list-conversations',
  'platform:channels-set-target'
]

/** 3 个入站通道：接在管理面之后。 */
const INBOUND_CHANNELS = [
  'platform:channels-list-candidates',
  'platform:channels-allow-candidate',
  'platform:channels-ignore-candidate',
  'platform:channels-open-conversation'
]

const EXPECTED_CHANNELS = [...MANAGEMENT_CHANNELS, ...INBOUND_CHANNELS]

function record(): { channels: string[]; ipcMain: { handle: (channel: string, listener: unknown) => void } } {
  const channels: string[] = []
  return {
    channels,
    ipcMain: {
      handle: (channel: string) => {
        if (channels.includes(channel)) throw new Error(`duplicate channel: ${channel}`)
        channels.push(channel)
      }
    }
  }
}

/** 每个方法返回自己的哨兵常量：用 toBe 严格相等，只有真正调用了对应方法才可能通过。 */
function sentinelService(prefix: string, methods: readonly string[]) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const service: Record<string, unknown> = {}
  for (const method of methods) {
    const sentinel = `${prefix}:${method}`
    service[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return sentinel
    }
  }
  return { service, calls }
}

const MANAGEMENT_METHODS = [
  'catalog',
  'listWithCredentialPreviews',
  'listDeliveryTargets',
  'getWithCredentialPreviews',
  'create',
  'update',
  'disable',
  'requestEnable',
  'restart',
  'delete',
  'beginCredential',
  'provision',
  'rotate',
  'beginPolicy',
  'createPolicy',
  'listAudits',
  'runtimeStatus',
  'listDeliveryAttempts',
  'listDeliveryAudits',
  'listRuntimeAudits',
  'sendTestMessage',
  'listPolicies',
  'deletePolicy',
  'listConversations',
  'setTarget'
] as const

const INBOUND_METHODS = ['listCandidates', 'allowCandidate', 'ignoreCandidate', 'openConversation'] as const

const JWK = { kty: 'EC', crv: 'P-256', x: 'x-value', y: 'y-value' }
const HANDOFF = { sessionId: 'session-1', rendererPublicJwk: JWK, iv: new Uint8Array([1]), ciphertext: new Uint8Array([2]) }

function setup() {
  const management = sentinelService('management', MANAGEMENT_METHODS)
  const inbound = sentinelService('inbound', INBOUND_METHODS)
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const ports: ChannelIpcPorts = {
    channelManagementService: management.service as never,
    channelInboundService: inbound.service as never
  }
  registerChannelIpc(
    { handle: (channel: string, listener: (...args: unknown[]) => unknown) => listeners.set(channel, listener) } as never,
    ports
  )
  return { listeners, management, inbound }
}

const event = { sender: { id: 42 } } as never

describe('channel ipc surface', () => {
  it('registers 25 management channels then 4 inbound channels, in that order', () => {
    const { channels, ipcMain } = record()
    const management = sentinelService('management', MANAGEMENT_METHODS)
    const inbound = sentinelService('inbound', INBOUND_METHODS)
    registerChannelIpc(ipcMain as never, {
      channelManagementService: management.service as never,
      channelInboundService: inbound.service as never
    })

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('calls one management method per management channel, and nothing else', async () => {
    const { listeners, management } = setup()
    const inputs: Record<string, unknown> = {
      'platform:channels-get': 'channel-1',
      'platform:channels-create': { name: 'c' },
      'platform:channels-update': { id: 'channel-1' },
      'platform:channels-disable': { channelId: 'channel-1' },
      'platform:channels-request-enable': { channelId: 'channel-1' },
      'platform:channels-restart': { channelId: 'channel-1' },
      'platform:channels-delete': { channelId: 'channel-1' },
      'platform:channels-credential-begin': { channelId: 'channel-1' },
      'platform:channels-credential-submit': { channelId: 'channel-1', actorId: 'actor', handoff: HANDOFF },
      'platform:channels-credential-rotate': { channelId: 'channel-1', actorId: 'actor', handoff: HANDOFF },
      'platform:channels-policy-begin': { channelId: 'channel-1' },
      'platform:channels-policy-create': { channelId: 'channel-1', actorId: 'actor', handoff: HANDOFF },
      'platform:channels-list-audits': { channelId: 'channel-1', limit: 5, offset: 0 },
      'platform:channels-runtime-status': { channelId: 'channel-1' },
      'platform:channels-list-delivery-attempts': { channelId: 'channel-1' },
      'platform:channels-list-delivery-audits': { channelId: 'channel-1' },
      'platform:channels-list-runtime-audits': { channelId: 'channel-1', limit: 20, cursor: null },
      'platform:channels-send-test-message': { channelId: 'channel-1', text: '测试消息' },
      'platform:channels-list-policies': { channelId: 'channel-1', limit: 5 },
      'platform:channels-delete-policy': { channelId: 'channel-1', policyId: 'policy-1', actorId: 'actor' },
      'platform:channels-list-conversations': { channelId: 'channel-1', limit: 5 },
      'platform:channels-set-target': { channelId: 'channel-1', conversationId: 'conv-1', enabled: true, actorId: 'actor' }
    }

    for (const channel of MANAGEMENT_CHANNELS) {
      const result = await listeners.get(channel)!(event, inputs[channel])
      expect(result).toBe(`management:${managementOf(channel)}`)
    }
    expect(management.calls.map((call) => call.method)).toEqual([...MANAGEMENT_METHODS])
  })

  it('routes every channel id through channelIdOf, and lets only create/update pass a DTO through', () => {
    // 成规模的守卫（Chief 2026-11-06）：这次的错不是「一条接口写错」，而是**每条接口都各写一遍**，
    // 所以一处断了三天没人发现。这里按源码判：凡是把 id 交给服务的调用，都必须来自 `channelIdOf`。
    // 先剥注释再扫：注释里写着「以前 handler 读 `value.id`」这件事本身是对的，
    // 但扫描器不许被注释里的示例糊住（今晚这条教训已经踩过一次）。
    const source = stripComments(readFileSync(resolve(__dirname, 'channelIpc.ts'), 'utf8').replace(/\r\n/g, '\n'))
    // 旧名字在任何地方都不许出现（出现一次，就又是一处「静默 undefined」）。
    expect(source).not.toMatch(/\bvalue\.id\b|\binput\.id\b/)

    const calls = [...source.matchAll(/channel(?:Management|Inbound)Service\.[a-zA-Z]+\(/g)]
    expect(calls.length).toBeGreaterThan(20)
    const passthrough: string[] = []
    for (const match of calls) {
      const method = /channel(?:Management|Inbound)Service\.([a-zA-Z]+)\(/.exec(match[0])![1]!
      const args = callArguments(source, (match.index ?? 0) + match[0].length - 1)
      if (args.trim().startsWith('asChannelInput(input)')) { passthrough.push(method); continue }
      // 交给服务的 id 不得是 `value.id` 这类裸字段，必须是 `channelIdOf(...)` 的结果。
      if (/\bid:\s/.test(args)) expect(args, method).toMatch(/id:\s*channelIdOf\(/)
      // 入站侧把通道 id 当位置参数传：同样必须是 channelIdOf 的结果。
      if (match[0].startsWith('channelInboundService.')) expect(args, method).toContain('channelIdOf(')
    }
    // 唯二允许把载荷原样交给服务的：`create` / `update`（载荷就是通道 DTO，`id` 是 DTO 字段）。
    expect(passthrough.sort()).toEqual(['create', 'update'])
  })

  it('reads exactly one name for the channel id, and rejects the old one instead of passing undefined', async () => {
    // 2026-11-06 那串 `channel-input-invalid`：调用方传 `channelId`、handler 读 `value.id`，
    // `value.id` 恒为 undefined 并且被调用方 catch 掉，入口永远不出现。这里把名字钉死：
    // 旧名字必须当场红，不许再静默变成 undefined。
    const { listeners } = setup()
    expect(() => listeners.get('platform:channels-list-conversations')!(event, { id: 'channel-1', limit: 5 }))
      .toThrow('channel-input-invalid')
    // 正确的名字照常走通（handler 是同步的，返回哨兵字符串）。
    expect(listeners.get('platform:channels-list-conversations')!(event, { channelId: 'channel-1', limit: 5 }))
      .toBe('management:listConversations')
  })

  it('calls one inbound method per inbound channel, with the documented argument shaping', async () => {
    const { listeners, inbound } = setup()

    await listeners.get('platform:channels-list-candidates')!(event, { channelId: 'channel-1', limit: 7 })
    await listeners.get('platform:channels-allow-candidate')!(event, {
      channelId: 'channel-1',
      candidateId: 'cand-1',
      enableTarget: true
    })
    // 通道 id 只有一个名字 `channelId`：以前这里读取 `id ?? channelId` 的回退，正是它让「两个名字」
    // 长期并存（2026-11-06 那串 `channel-input-invalid` 的同类土壤），已经删掉。
    await listeners.get('platform:channels-ignore-candidate')!(event, { channelId: 'channel-1', candidateId: 'cand-2' })
    // 「打开这条频道的会话」：只转发频道 id + 对话 id，会话 id 由服务自己查、自己用。
    await listeners.get('platform:channels-open-conversation')!(event, { channelId: 'channel-1', conversationId: 'conv-1' })

    expect(inbound.calls).toEqual([
      { method: 'listCandidates', args: ['channel-1', 7] },
      { method: 'allowCandidate', args: [{ channelId: 'channel-1', candidateId: 'cand-1', enableTarget: true }] },
      { method: 'ignoreCandidate', args: ['channel-1', 'cand-2'] },
      { method: 'openConversation', args: [{ channelId: 'channel-1', conversationId: 'conv-1' }] }
    ])
  })

  it('shapes the five input-forwarding handlers without narrowing the payload', async () => {
    const { listeners, management } = setup()

    await listeners.get('platform:channels-create')!(event, { name: 'fresh' })
    expect(management.calls.at(-1)).toEqual({ method: 'create', args: [{ name: 'fresh' }] })

    await listeners.get('platform:channels-credential-begin')!(event, { channelId: 'channel-1' })
    expect(management.calls.at(-1)).toEqual({ method: 'beginCredential', args: [{ id: 'channel-1', senderId: 42 }] })

    await listeners.get('platform:channels-policy-begin')!(event, { channelId: 'channel-1' })
    expect(management.calls.at(-1)).toEqual({ method: 'beginPolicy', args: [{ id: 'channel-1', senderId: 42 }] })

    await listeners.get('platform:channels-runtime-status')!(event, { channelId: 'channel-1', extra: 'ignored' })
    expect(management.calls.at(-1)).toEqual({ method: 'runtimeStatus', args: [{ id: 'channel-1' }] })

    // 不是普通对象的一律拒收（cast 之前的那道形状检查）。
    expect(() => listeners.get('platform:channels-create')!(event, 'not-an-object')).toThrow('channel-input-invalid')
  })
})

function managementOf(channel: string): string {
  const map: Record<string, string> = {
    'platform:channels-catalog': 'catalog',
    'platform:channels-list': 'listWithCredentialPreviews',
    'platform:channels-list-delivery-targets': 'listDeliveryTargets',
    'platform:channels-get': 'getWithCredentialPreviews',
    'platform:channels-create': 'create',
    'platform:channels-update': 'update',
    'platform:channels-disable': 'disable',
    'platform:channels-request-enable': 'requestEnable',
    'platform:channels-restart': 'restart',
    'platform:channels-delete': 'delete',
    'platform:channels-credential-begin': 'beginCredential',
    'platform:channels-credential-submit': 'provision',
    'platform:channels-credential-rotate': 'rotate',
    'platform:channels-policy-begin': 'beginPolicy',
    'platform:channels-policy-create': 'createPolicy',
    'platform:channels-list-audits': 'listAudits',
    'platform:channels-runtime-status': 'runtimeStatus',
    'platform:channels-list-delivery-attempts': 'listDeliveryAttempts',
    'platform:channels-list-delivery-audits': 'listDeliveryAudits',
    'platform:channels-list-runtime-audits': 'listRuntimeAudits',
    'platform:channels-send-test-message': 'sendTestMessage',
    'platform:channels-list-policies': 'listPolicies',
    'platform:channels-delete-policy': 'deletePolicy',
    'platform:channels-list-conversations': 'listConversations',
    'platform:channels-set-target': 'setTarget'
  }
  return map[channel]!
}

/** 去掉块注释与整行注释：源码守卫只看真的会执行的代码。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 从 `(` 处取出这一层括号里的实参文本：源码扫的是「这一条调用到底喂了什么」，不是整行。 */
function callArguments(source: string, openingParenIndex: number): string {
  let depth = 0
  for (let index = openingParenIndex; index < source.length; index += 1) {
    const character = source[index]
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0) return source.slice(openingParenIndex + 1, index)
    }
  }
  return ''
}
