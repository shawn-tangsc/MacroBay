import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { getSessionMessages } from '@platform/ai/agent-platform/store/agentStore'
import { createDefaultAgentPersistentState } from '@platform/ai/agent-platform/store/agentPersistentStore'
import {
  appendWorkspaceTestFixtureManifests,
  WORKSPACE_TEST_FIXTURES_ENV,
  WORKSPACE_TEST_FIXTURES_GLOBAL_KEY,
  WORKSPACE_TEST_FIXTURES_KIND,
  WORKSPACE_TEST_FIXTURE_PRODUCT_ID,
  WORKSPACE_TEST_STREAM_AGENT_ID,
  WORKSPACE_TEST_STREAM_SESSION_ID,
  createWorkspaceTestFixtureAgentSeed,
  createWorkspaceTestStreamDriver,
  installWorkspaceTestFixtureHandle,
  resolveWorkspaceTestFixtures
} from './workspaceTestFixtures'

/**
 * Owner: platform/desktop/main（PLAT-33 focused）。
 *
 * 本文件固定「一等 test-only seam」的两条硬性质：
 *  1) **未设置 env ⇒ 与现状逐字等价**：返回值是显式的 disabled 对象，且**绝不触碰文件系统**
 *     （注入的 readFile 若被调用即抛错 ⇒ 用例红）；命中 env 但 fixture 非法 ⇒ **构造期抛错（fail closed）**，
 *     绝不半开注入；
 *  2) **命中 env ⇒ 只注入受控 fixture**：清单投影成平台既有的 `ProductManifest` 形状（页面 module 与
 *     `toProductWorkspacePage` 的推导逐字一致、面板 `pageIds` 带产品前缀、`serviceRoutes` 为空 ⇒
 *     不新增任何产品 IPC 方法），流源桩以「既有 `AgentRuntimeDriver` 注册点」的形式提供受控 chunk 与终态。
 */

const validDeclaration = {
  kind: WORKSPACE_TEST_FIXTURES_KIND,
  productId: 'dsh-fixture',
  productName: 'PLAT-33 workspace test fixtures (test-only)',
  pages: [
    {
      id: 'board-host',
      title: { 'zh-CN': '面板宿主页（测试用）', 'en-US': 'Panel host page (test-only)' },
      icon: 'scroll-text',
      order: 9001,
      supportsDetached: true,
      allowMultipleInstances: false
    },
    {
      id: 'stream-host',
      title: { 'zh-CN': '流宿主页（测试用）', 'en-US': 'Stream host page (test-only)' },
      icon: 'database',
      order: 9002,
      supportsDetached: true,
      allowMultipleInstances: false
    }
  ],
  panels: [
    {
      id: 'board',
      pageId: 'board-host',
      title: { 'zh-CN': '受控面板（测试用）', 'en-US': 'Controlled panel (test-only)' },
      icon: 'file-text',
      supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'],
      defaultMode: 'docked-right',
      minSize: { width: 320, height: 240 },
      preferredSize: { width: 480, height: 360 }
    }
  ],
  streamStub: { chunkCount: 4, chunkIntervalMs: 250, finalText: 'dsh-fixture-stream-final' }
} as const

function resolveFrom(content: string, env: Record<string, string | undefined> = { [WORKSPACE_TEST_FIXTURES_ENV]: '/tmp/plat33-fixtures.json' }) {
  const readFile = vi.fn(() => content)
  return {
    readFile,
    resolved: resolveWorkspaceTestFixtures(env, { readFile, now: () => new Date('2026-10-06T00:00:00.000Z') })
  }
}

describe('PLAT-33 seam：未设置 env ⇒ 生产零影响（逐字等价 + 不触碰文件系统）', () => {
  it('env 缺失 / 空串 / 仅空白 ⇒ disabled 且 readFile 一次都没被调用', () => {
    for (const environment of [{}, { [WORKSPACE_TEST_FIXTURES_ENV]: '' }, { [WORKSPACE_TEST_FIXTURES_ENV]: '   ' }]) {
      const readFile = vi.fn(() => { throw new Error('must-not-read') })
      const resolved = resolveWorkspaceTestFixtures(environment, { readFile, now: () => new Date(0) })
      expect(resolved).toEqual({
        enabled: false,
        path: null,
        productManifests: [],
        streamStub: null,
        agentSeed: null
      })
      expect(readFile).not.toHaveBeenCalled()
    }
  })

  it('disabled 结果冻结（调用方无法就地改写 ⇒ 不可能半开）', () => {
    const resolved = resolveWorkspaceTestFixtures({}, {})
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.productManifests)).toBe(true)
  })

  it('appendWorkspaceTestFixtureManifests：零长度 ⇒ 返回**同一个数组身份**（逐字等价）；命中 ⇒ 追加在尾部', () => {
    const base = [{ id: 'a' }] as never
    expect(appendWorkspaceTestFixtureManifests(base, [])).toBe(base)
    const extra = { id: 'b' } as never
    expect(appendWorkspaceTestFixtureManifests(base, [extra])).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(base).toEqual([{ id: 'a' }])
  })
})

describe('PLAT-33 seam：env 命中但 fixture 非法 ⇒ fail closed（构造期抛错，绝不半开注入）', () => {
  const cases: Array<{ name: string; env?: Record<string, string | undefined>; content?: string; throws: (content: string) => string }> = [
    { name: '相对路径', env: { [WORKSPACE_TEST_FIXTURES_ENV]: 'relative/fixtures.json' }, throws: () => 'absolute' },
    { name: '文件读取失败', env: { [WORKSPACE_TEST_FIXTURES_ENV]: '/tmp/x.json' }, throws: () => 'unreadable' },
    { name: 'JSON 不可解析', content: '{ not json', throws: () => 'not-json' },
    { name: 'kind 不匹配', content: JSON.stringify({ ...validDeclaration, kind: 'other' }), throws: () => 'kind' },
    { name: '缺少 pages', content: JSON.stringify({ ...validDeclaration, pages: [] }), throws: () => 'pages' },
    { name: '面板页引用不存在', content: JSON.stringify({ ...validDeclaration, panels: [{ ...validDeclaration.panels[0], pageId: 'nope' }] }), throws: () => 'pageId' },
    { name: 'supportedModes 为空', content: JSON.stringify({ ...validDeclaration, panels: [{ ...validDeclaration.panels[0], supportedModes: [] }] }), throws: () => 'supportedModes' },
    { name: 'defaultMode 非法', content: JSON.stringify({ ...validDeclaration, panels: [{ ...validDeclaration.panels[0], defaultMode: 'detached' }] }), throws: () => 'defaultMode' },
    { name: 'chunkCount 越界', content: JSON.stringify({ ...validDeclaration, streamStub: { chunkCount: 0, chunkIntervalMs: 10, finalText: 'x' } }), throws: () => 'chunkCount' }
  ]

  it.each(cases)('$name ⇒ 抛错且错误信息指向具体判据', ({ env, content, throws }) => {
    const readFile = vi.fn(() => {
      if (content === undefined) throw new Error('ENOENT')
      return content
    })
    expect(() => resolveWorkspaceTestFixtures(env ?? { [WORKSPACE_TEST_FIXTURES_ENV]: '/tmp/x.json' }, { readFile, now: () => new Date(0) }))
      .toThrowError(new RegExp(throws(content ?? ''), 'u'))
  })
})

describe('PLAT-33 seam：env 命中 ⇒ 受控 fixture 投影（页面 module / 面板前缀 / 零产品 IPC）', () => {
  it('投影出平台既有 ProductManifest 形状，且不携带任何产品 IPC 方法', () => {
    const { resolved } = resolveFrom(JSON.stringify(validDeclaration))
    expect(resolved.enabled).toBe(true)
    expect(resolved.productManifests).toHaveLength(1)
    const manifest = resolved.productManifests[0]!
    expect(manifest.id).toBe(WORKSPACE_TEST_FIXTURE_PRODUCT_ID)
    expect(manifest.serviceRoutes).toEqual([])
    expect(manifest.shellContributions?.menuPages.map((page) => page.id)).toEqual(['board-host', 'stream-host'])

    // 页面：module 必须逐字等于 `${productId}.${pageId}`（`toProductWorkspacePage` 的同一推导），否则注册表 allowlist 会拒。
    const page = manifest.shellContributions!.menuPages[0]!
    expect(page.module).toBe(`${WORKSPACE_TEST_FIXTURE_PRODUCT_ID}.board-host`)
    expect(page.workspace).toEqual({ supportsDetached: true, allowMultipleInstances: false })

    // 面板：pageIds 带产品前缀（`toProductPanelRegistration` 的同一推导）；detached 必须被显式声明。
    const panel = manifest.shellContributions!.panels![0]!
    expect(panel.id).toBe('board')
    expect(panel.pageIds).toEqual(['board-host'])
    expect(panel.supportedModes).toContain('detached')
    expect(panel.defaultMode).toBe('docked-right')
  })

  it('agent/session 种子：受控 agent 绑定受控 session（否则驱动桩拿不到归属）', () => {
    const { resolved } = resolveFrom(JSON.stringify(validDeclaration))
    const seed = resolved.agentSeed!
    expect(seed.agents?.map((agent) => agent.id)).toEqual([WORKSPACE_TEST_STREAM_AGENT_ID])
    expect(seed.sessions?.map((session) => session.id)).toEqual([WORKSPACE_TEST_STREAM_SESSION_ID])
    expect(seed.sessions?.[0]?.agentId).toBe(WORKSPACE_TEST_STREAM_AGENT_ID)
    expect(createWorkspaceTestFixtureAgentSeed('2026-10-06T00:00:00.000Z')).toEqual(seed)
  })
})

describe('PLAT-33 seam：受控流源桩（既有 AgentRuntimeDriver 注册点）', () => {
  function harness() {
    const chunks: string[] = []
    let state: AgentStoreState = {
      ...createDefaultAgentPersistentState(),
      ...createWorkspaceTestFixtureAgentSeed('2026-10-06T00:00:00.000Z')
    } as AgentStoreState
    const saved: string[] = []
    const stub = createWorkspaceTestStreamDriver({
      getState: async () => state,
      saveState: async (next, sessionId) => { state = next; saved.push(sessionId) },
      emitChunk: (chunk) => {
        if (chunk.type === 'assistant-text-update') chunks.push(chunk.textDelta)
      },
      chunkCount: 3,
      chunkIntervalMs: 0,
      finalText: 'final-text',
      delay: async () => undefined
    })
    return { stub, chunks, saved, stateOf: () => state }
  }

  it('emit 受控 chunk（逐块、累计文本）+ 终态 assistant 消息；send 计数可读', async () => {
    const { stub, chunks, stateOf } = harness()
    const result = await stub.driver.sendMessage({
      agentId: WORKSPACE_TEST_STREAM_AGENT_ID,
      sessionId: WORKSPACE_TEST_STREAM_SESSION_ID,
      text: 'hello-stub',
      runId: 'run-1'
    } as never)
    expect(chunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3'])
    expect(stub.stats.sendCount()).toBe(1)
    expect(stub.stats.emittedChunkCount()).toBe(3)
    const messages = getSessionMessages(stateOf(), WORKSPACE_TEST_STREAM_SESSION_ID)
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(1)
    const assistant = messages.filter((message) => message.role === 'assistant').at(-1)!
    expect(assistant.status).toBe('success')
    expect(JSON.stringify(assistant.data)).toContain('final-text')
    expect(result.assistantMessage.id).toBe(assistant.id)
  })

  it('未命中 env 时不得安装任何测试钩子；命中时钩子显式标注 test-only 并暴露计数', () => {
    const target: Record<string, unknown> = {}
    const disabled = resolveWorkspaceTestFixtures({}, {})
    installWorkspaceTestFixtureHandle({ target, fixtures: disabled, streamStub: null })
    expect(target[WORKSPACE_TEST_FIXTURES_GLOBAL_KEY]).toBeUndefined()

    const { resolved } = resolveFrom(JSON.stringify(validDeclaration))
    const { stub } = harness()
    installWorkspaceTestFixtureHandle({ target, fixtures: resolved, streamStub: stub.stats })
    const installed = target[WORKSPACE_TEST_FIXTURES_GLOBAL_KEY] as Record<string, unknown>
    expect(installed.testOnly).toBe(true)
    expect(installed.path).toBe('/tmp/plat33-fixtures.json')
    expect(typeof (installed.streamStub as { sendCount: unknown }).sendCount).toBe('function')
  })
})

/**
 * PLAT-38（安全硬化）：`DSH_WORKSPACE_TEST_FIXTURES` 是**一等 test-only 后门**（可注入产品清单、agent 种子、
 * 流驱动桩）⇒ 打包态（`app.isPackaged === true`，由组合根 `app.ts` 逐字传入）必须**整体忽略**该 env：
 * 不读文件、不投影清单、不装钩子；开发态（显式 `false` 或历史调用形态「未传」）行为与 PLAT-33 逐字相同。
 */
describe('PLAT-38 安全硬化：打包态忽略 test-only env（不读文件、不注入）', () => {
  it('打包态 + env 命中合法 fixture ⇒ enabled:false 且 readFile 一次都没被调用', () => {
    const readFile = vi.fn(() => JSON.stringify(validDeclaration))
    const resolved = resolveWorkspaceTestFixtures(
      { [WORKSPACE_TEST_FIXTURES_ENV]: '/tmp/plat33-fixtures.json' },
      { readFile, now: () => new Date(0), isPackaged: true }
    )
    expect(resolved).toEqual({
      enabled: false,
      path: null,
      productManifests: [],
      streamStub: null,
      agentSeed: null
    })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('打包态 + env 命中但 fixture 非法（相对路径）⇒ 也不读文件、不抛错（整个 env 被忽略）', () => {
    const readFile = vi.fn(() => { throw new Error('must-not-read') })
    let resolved: ReturnType<typeof resolveWorkspaceTestFixtures> | null = null
    expect(() => {
      resolved = resolveWorkspaceTestFixtures(
        { [WORKSPACE_TEST_FIXTURES_ENV]: 'relative/fixtures.json' },
        { readFile, now: () => new Date(0), isPackaged: true }
      )
    }).not.toThrowError()
    expect(resolved).not.toBeNull()
    expect(resolved!.enabled).toBe(false)
    expect(resolved!.path).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('打包态 ⇒ 清单零追加（同一数组身份）且不装 globalThis 测试钩子', () => {
    const readFile = vi.fn(() => JSON.stringify(validDeclaration))
    const resolved = resolveWorkspaceTestFixtures(
      { [WORKSPACE_TEST_FIXTURES_ENV]: '/tmp/plat33-fixtures.json' },
      { readFile, now: () => new Date(0), isPackaged: true }
    )
    const base = [{ id: 'a' }] as never
    expect(appendWorkspaceTestFixtureManifests(base, resolved.productManifests)).toBe(base)
    const target: Record<string, unknown> = {}
    installWorkspaceTestFixtureHandle({ target, fixtures: resolved, streamStub: null })
    expect(target[WORKSPACE_TEST_FIXTURES_GLOBAL_KEY]).toBeUndefined()
  })

  it('开发态（isPackaged:false）⇒ 行为不变：读文件一次且 enabled:true（回归守卫，改动前即绿）', () => {
    const readFile = vi.fn(() => JSON.stringify(validDeclaration))
    const resolved = resolveWorkspaceTestFixtures(
      { [WORKSPACE_TEST_FIXTURES_ENV]: '/tmp/plat33-fixtures.json' },
      { readFile, now: () => new Date(0), isPackaged: false }
    )
    expect(resolved.enabled).toBe(true)
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(resolved.productManifests).toHaveLength(1)
    expect(resolved.agentSeed).not.toBeNull()
  })
})

/**
 * PLAT-33 RED（真机证据：`openPanel` 返回 `registration-missing` ⇒ 受控面板贡献**没进注册表**）。
 * 判据：fixture 清单必须能被**平台的真实注册表**逐条接受（面板注册表 + 页面注册表 + 模块 allowlist），
 * 否则「有面板可驱动」只是声明而非事实。
 */
describe('PLAT-33：受控 fixture 清单必须真的能进平台注册表（真机曾 registration-missing）', () => {
  it('面板贡献经 toProductPanelRegistration + createPanelRegistry 注册成功（allowlist 取自清单自身）', async () => {
    const { createPanelRegistry, toProductPanelRegistration } = await import('@platform/workspace/registry/panelRegistry')
    const { resolved } = resolveFrom(JSON.stringify(validDeclaration))
    const manifest = resolved.productManifests[0]!
    const pageIds = (manifest.shellContributions?.menuPages ?? []).map((page) => `${manifest.id}.${page.id}`)
    const registrations = (manifest.shellContributions?.panels ?? []).map((panel) => toProductPanelRegistration(manifest.id, panel))
    const registry = createPanelRegistry({ pageIds, moduleIds: registrations.map((entry) => entry.module) })
    for (const registration of registrations) registry.register(registration)
    registry.seal()
    expect(registry.list().map((entry) => entry.id)).toEqual(['dsh-fixture.board'])
  })

  it('页面贡献经 createComposedPageRegistry 注册成功（页面 module 与 allowlist 推导一致）', async () => {
    const { createComposedPageRegistry } = await import('@platform/desktop/main/workspace/workspacePageRegistryComposition')
    const { resolved } = resolveFrom(JSON.stringify(validDeclaration))
    const manifest = resolved.productManifests[0]!
    const pageIds = (manifest.shellContributions?.menuPages ?? []).map((page) => `${manifest.id}.${page.id}`)
    const registry = createComposedPageRegistry(resolved.productManifests, pageIds)
    expect(registry.list().map((entry) => entry.id)).toEqual(expect.arrayContaining(['dsh-fixture.board-host', 'dsh-fixture.stream-host']))
  })
})

/**
 * PLAT-44（源码/结构 guard）：`resolveWorkspaceTestFixtures` 的 `isPackaged` 是**可选**参数（缺省＝开发态）。
 * 于是「未来新增一个生产调用点但忘了传 `{ isPackaged: app.isPackaged }`」在类型系统里**完全合法**，
 * PLAT-38 的硬门会被静默绕过（打包态重新打开 test-only 后门）——只有**源码结构 guard**能拦住它。
 *
 * 判据（先剥注释再判定，注释里的同名字符串不算数）：
 *  1) `platform/desktop/main/app.ts` 中 `resolveWorkspaceTestFixtures(` 的调用**恰 1 处**；
 *  2) 该调用的实参含 `process.env`，且**逐字**含 `{ isPackaged: app.isPackaged }`。
 */
/** 剥掉行注释与块注释（引号感知：字符串/模板串里的 `//`、`/*` 不当注释）。 */
function stripComments(source: string): string {
  let out = ''
  let index = 0
  let quote: string | null = null
  while (index < source.length) {
    const char = source[index]!
    const next = source[index + 1]
    if (quote !== null) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    out += char
    index += 1
  }
  return out
}

/** 取出 `callee(...)` 全部调用的**实参原文**（括号配平 + 引号感知）。 */
function callArguments(source: string, callee: string): string[] {
  const calls: string[] = []
  const needle = `${callee}(`
  let from = 0
  for (;;) {
    const at = source.indexOf(needle, from)
    if (at < 0) return calls
    let index = at + needle.length
    let depth = 1
    let quote: string | null = null
    const start = index
    while (index < source.length && depth > 0) {
      const char = source[index]!
      if (quote !== null) {
        if (char === '\\') index += 2
        else {
          if (char === quote) quote = null
          index += 1
        }
        continue
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char
        index += 1
        continue
      }
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      index += 1
    }
    calls.push(source.slice(start, index - 1))
    from = index
  }
}

const appSourceWithoutComments = stripComments(readFileSync(fileURLToPath(new URL('./app.ts', import.meta.url)), 'utf8'))

/** guard 的**唯一判据**：返回空数组 ⇒ 注入点合法；任何一条成立 ⇒ 红（消息即缺陷说明）。 */
function injectionPointProblems(source: string): string[] {
  const calls = callArguments(source, 'resolveWorkspaceTestFixtures')
  const problems: string[] = []
  if (calls.length !== 1) problems.push(`注入点必须恰 1 处 resolveWorkspaceTestFixtures( 调用，实际 ${calls.length} 处`)
  for (const [index, call] of calls.entries()) {
    if (!call.trim().startsWith('process.env')) {
      problems.push(`第 ${index + 1} 处注入点的首个实参必须是 process.env（当前为 "${call.trim().slice(0, 60)}"）`)
    }
    if (!call.includes('{ isPackaged: app.isPackaged }')) {
      problems.push(`第 ${index + 1} 处注入点必须逐字传 { isPackaged: app.isPackaged }（否则打包态硬门静默失效）`)
    }
  }
  return problems
}

describe('PLAT-44 源码 guard：注入点必须逐字带宿主事实 { isPackaged: app.isPackaged }', () => {
  it('app.ts 通过：恰 1 处调用，实参为 process.env + { isPackaged: app.isPackaged }', () => {
    expect(injectionPointProblems(appSourceWithoutComments)).toEqual([])
  })

  it('可证伪（metamorphic）：把宿主事实从源码里去掉 / 再多一处调用 ⇒ 同一判据必红', () => {
    expect(injectionPointProblems(appSourceWithoutComments.replace(', { isPackaged: app.isPackaged }', ''))).toEqual([
      expect.stringContaining('第 1 处注入点必须逐字传 { isPackaged: app.isPackaged }')
    ])
    const singleArgument = injectionPointProblems(`${appSourceWithoutComments}\nresolveWorkspaceTestFixtures(process.env)\n`)
    expect(singleArgument).toContainEqual(expect.stringContaining('注入点必须恰 1 处'))
    expect(singleArgument).toContainEqual(expect.stringContaining('第 2 处注入点必须逐字传 { isPackaged: app.isPackaged }'))
    const duplicated = injectionPointProblems(`${appSourceWithoutComments}\nresolveWorkspaceTestFixtures(process.env, { isPackaged: app.isPackaged })\n`)
    expect(duplicated).toEqual([expect.stringContaining('注入点必须恰 1 处')])
  })

  it('剥注释后判定：注释里的历史单参形态**不能**让 guard 变绿、也不能把它变红', () => {
    const commented = stripComments(
      '// resolveWorkspaceTestFixtures(process.env)\nconst a = 1 /* { isPackaged: app.isPackaged } */\nresolveWorkspaceTestFixtures(process.env, { isPackaged: app.isPackaged })'
    )
    expect(commented).not.toContain('// resolveWorkspaceTestFixtures')
    expect(injectionPointProblems(commented)).toEqual([])
  })
})
