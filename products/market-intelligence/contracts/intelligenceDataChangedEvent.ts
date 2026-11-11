/**
 * 采集写了库 → 界面跟着重读（产品事件通道上的一条单向广播）。
 *
 * 载荷只说「哪些面板、哪些源」，**不带值、不带新值、不带 runId、不带计数**：读方收到后重读
 * 自己的读口，不去猜变了什么。面板词汇只有一份（`PanelId`），将来要细化到模块/读口时改发射端
 * 那一张映射表，这条事件的形状不动。
 *
 * 这条路与设置域的 `settings-revision` 是两件事：那条说「配置变了」，这条说「库里有新写入」。
 * 一个源的采集写库不会改配置，配置保存也不会写数据，混用会把域用坏。
 */
import type { PanelId } from '../service/intelligence/application/providerRegistry'

export const INTELLIGENCE_DATA_CHANGED_EVENT = 'intelligence.dataChanged'

export type IntelligenceDataChangedPayload = Readonly<{
  /** 这次写入影响到的面板（并集去重，由发射端按来源注册表换算）。 */
  panels: readonly PanelId[]
  /** 被写入的那几个 `sourceId`：今晚读方不用它，留着是把细化留在发射端，事件不必再改。 */
  sources: readonly string[]
}>

const KNOWN_PANELS: readonly PanelId[] = ['dashboard', 'economic-calendar']

/**
 * 形状不对就整条丢弃：读方不许因为一条畸形载荷「什么都重读」。
 *
 * 不认识的**面板**按忽略处理（不是整条丢）：发射端将来多一个面板，不该让看板这边连自己那一半
 * 都不读了。真正的形状错误（不是对象、`panels` / `sources` 不是数组、元素不是字符串）才算坏。
 */
export function parseIntelligenceDataChanged(raw: unknown): IntelligenceDataChangedPayload | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const candidate = raw as Readonly<{ panels?: unknown; sources?: unknown }>
  if (!Array.isArray(candidate.panels) || !Array.isArray(candidate.sources)) return undefined

  const panels: PanelId[] = []
  for (const panel of candidate.panels as readonly unknown[]) {
    if (typeof panel !== 'string') return undefined
    if (!KNOWN_PANELS.includes(panel as PanelId)) continue
    if (!panels.includes(panel as PanelId)) panels.push(panel as PanelId)
  }

  const sources: string[] = []
  for (const source of candidate.sources as readonly unknown[]) {
    if (typeof source !== 'string') return undefined
    sources.push(source)
  }

  return Object.freeze({ panels: Object.freeze(panels), sources: Object.freeze(sources) })
}
