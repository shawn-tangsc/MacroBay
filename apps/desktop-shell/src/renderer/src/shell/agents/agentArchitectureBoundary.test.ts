import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const agentsDir = resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/agents')

describe('agent renderer architecture boundary', () => {
  it('keeps the generic Agent page independent from product modules', () => {
    const agentPage = readFileSync(resolve(agentsDir, 'AgentPage.tsx'), 'utf8')

    expect(agentPage).not.toContain('@products/')
  })

  it('keeps generic Agent UI copy free of trading product wording', () => {
    const genericUi = collectSourceFiles(agentsDir)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    expect(genericUi).not.toMatch(/交易|复盘|行情|Binance|MACD|订单流|BTC|ETH/)
  })

  it('keeps the Agent workspace layout close to a session workspace', () => {
    const sidePanel = readFileSync(resolve(agentsDir, 'AgentSidePanel.tsx'), 'utf8')
    const chatPane = readFileSync(resolve(agentsDir, 'AgentChat.tsx'), 'utf8')
    const chatNavbar = readFileSync(resolve(agentsDir, 'components/AgentChatNavbar/index.tsx'), 'utf8')

    expect(sidePanel).not.toContain('state.agents.map')
    expect(chatPane).not.toContain('agent-system-strip')
    expect(chatNavbar).not.toContain('onCreateAgent')
    expect(chatNavbar).not.toContain('t.navbar.createAgent')
    expect(chatNavbar).not.toContain('setSessionAgentViaApi')
    expect(chatNavbar).not.toContain('bindSessionAgent')
    expect(chatNavbar).not.toContain('agent-chat-selector')
    expect(sidePanel).toContain('onCreateAgent')
    expect(sidePanel).toContain('t.navbar.createAgent')
  })

  it('offers no manual session ordering while recency decides the list', () => {
    // 顺序的唯一来源是「最近活跃」（R169）。手工拖拽排序松手后会弹回原位——它动过、也真的存了，
    // 但屏幕上没有变化，比没有这个能力更糟。数据与写库接口保留：哪天要让用户自定义顺序，
    // 那是「排序来源」重新立项，而不是把入口悄悄接回来。
    const sessions = readFileSync(resolve(agentsDir, 'components/Sessions.tsx'), 'utf8')
    const sessionItem = readFileSync(resolve(agentsDir, 'components/SessionItem.tsx'), 'utf8')

    expect(sessions).not.toContain('onDragStart')
    expect(sessions).not.toContain('reorderSessionsViaApi')
    expect(sessionItem).not.toContain('draggable')
    expect(sessionItem).not.toContain('onDragStart')
    // 能力本身还在：数据层照旧能写顺序，只是界面不再发起。
    const store = readFileSync(resolve(process.cwd(), 'platform/ai/agent-platform/store/agentStore.ts'), 'utf8')
    expect(store).toContain('export function reorderAgentSessions')
  })

  it('routes renderer mutations through the Agent action facade', () => {
    const source = collectSourceFiles(agentsDir)
      .filter((file) => !file.endsWith('agentStateActions.ts'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    const forbiddenStoreMutations = [
      'createAgentSession',
      'deleteAgentSession',
      'deleteAgentSessions',
      'reorderAgentSessions',
      'selectAgentSession',
      'updateAgentSessionAgent',
      'updateAgentSessionWorkspace',
      'upsertAgentWorkspace',
      'toggleSessionPin',
      'clearAgentSessionMessages',
      'deleteAgentSessionMessage'
    ]

    for (const mutationName of forbiddenStoreMutations) {
      expect(source).not.toMatch(new RegExp(`\\b${mutationName}\\b`))
    }
  })

  it('keeps Agent renderer files small enough to evolve safely', () => {
    const oversizedFiles = collectSourceFiles(agentsDir)
      .map((file) => ({
        file,
        lines: readFileSync(file, 'utf8').split('\n').length
      }))
      .filter((item) => item.lines > 360)

    expect(oversizedFiles).toEqual([])
  })
})

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    if (!entry.isFile()) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return []
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}
