import { describe, expect, it } from 'vitest'
import { configureIntelligenceSourceInputSchema, intelligenceWriteActionRules } from '../../../../service/intelligence/agent-capabilities/writeCapabilitySchemas'

import { structuredApprovalInput, type AgentApprovalLabelTable } from '@renderer/shell/agents/agentApprovalFields'
import { productApprovalFieldLabels } from '@products/generated/shellRegistry'

import { marketIntelligenceAgentApprovalFieldLabels } from './agentApprovalFields'

/**
 * 审批卡片字段文案的**等价闸**。
 *
 * 背景：这批改动把「壳层写死的字段名」换成了「产品声明 → 壳层渲染」。删掉的是壳层那张
 * `approvalFieldLabels` 表（`1b193f5^` 的 `agentTextZhRuntime.ts` / `agentTextEnRuntime.ts`）。
 * 这张表里 30 条中英对照**就是读者原来看到的样子**，所以它们是这次改动的验收基线：
 * 任何一条窄了、换了、少了一个字段，读者看到的就从「字段名 + 值」退回成一坨 JSON，
 * 而且没人会为此报错——所以必须由用例钉住。
 *
 * 下面两张 `LEGACY_*` 表是从 `git show 1b193f5^:<path>` 原样抄来的，**不要改写**。
 * 它们不是「另一份实现」，而是旧行为的快照：新路径算出来的每一句都必须与它逐字相同。
 *
 * 走的是真路径：`structuredApprovalInput` 正是壳层渲染审批字段时调用的那个函数，
 * 输入是产品 manifest 声明的表（生成物汇总的那张），工具名用模型实际给的形式
 * （`mcp__<product>__<tool>`），因此连「前缀剥离」这一步也在覆盖范围内。
 */

const LEGACY_ZH: Readonly<Record<string, string>> = {
  action: '动作',
  sourceId: '情报源',
  collectionPreset: '采集节奏',
  monitoredSymbols: '监控标的',
  enabled: '启用',
  itemId: '情报条目',
  itemIds: '情报条目',
  clusterIds: '情报簇',
  providerId: '供应商',
  modelId: '模型',
  eventKey: '日历事件',
  scheduledAt: '发布时间',
  scheduledDate: '发布日',
  year: '年份',
  body: 'ICS 内容',
  truncated: '已截断',
  acknowledgeOverwrite: '确认覆盖',
  autoTranslateEnabled: '自动翻译',
  targetLocale: '目标语言',
  translateTitle: '翻译标题',
  translateSummary: '翻译摘要',
  translateEvidenceExcerpt: '翻译证据摘录',
  filters: '过滤条件',
  leaseId: '租约'
}

const LEGACY_EN: Readonly<Record<string, string>> = {
  action: 'Action',
  sourceId: 'Source',
  collectionPreset: 'Collection preset',
  monitoredSymbols: 'Monitored symbols',
  enabled: 'Enabled',
  itemId: 'Item',
  itemIds: 'Items',
  clusterIds: 'Clusters',
  providerId: 'Provider',
  modelId: 'Model',
  eventKey: 'Calendar event',
  scheduledAt: 'Release time',
  scheduledDate: 'Release date',
  year: 'Year',
  body: 'ICS body',
  truncated: 'Truncated',
  acknowledgeOverwrite: 'Confirm overwrite',
  autoTranslateEnabled: 'Auto translate',
  targetLocale: 'Target locale',
  translateTitle: 'Translate title',
  translateSummary: 'Translate summary',
  translateEvidenceExcerpt: 'Translate evidence excerpt',
  filters: 'Filters',
  leaseId: 'Lease'
}

/** 旧表覆盖的五个产品写操作（壳层原来的白名单，`1b193f5^` 的 `agentApprovalFields.ts`）。 */
/** 声明表以「表」的形状参与断言：`as const` 的字面量键在逐工具遍历时不方便索引。 */
const DECLARED: AgentApprovalLabelTable = marketIntelligenceAgentApprovalFieldLabels

const LEGACY_TOOLS = [
  'configure_intelligence_source',
  'operate_intelligence_source',
  'operate_macro_calendar',
  'configure_translation',
  'configure_cross_asset_interface'
] as const

const LANGUAGES = ['zh-CN', 'en-US'] as const

/** 模型实际给出的工具名：带 MCP 传输前缀，壳层会剥掉它再去查表。 */
function modelToolName(tool: string): string {
  return `mcp__market-intelligence__${tool}`
}

describe('the frozen profile fields are absent from the model-facing write surface', () => {
  const FROZEN = ['scopePolicy', 'rawArchiveEnabled', 'retentionMode', 'autoReplayAfterParserUpgrade', 'sourceSpecificConfigJson'] as const

  it('keeps them off the write schema, the action field list, and the approval card', () => {
    // C10：这四项从智能体写入口撤掉（值是既有事实，冻结）。三处任一加回来，这条就红。
    const properties = Object.keys(configureIntelligenceSourceInputSchema.properties)
    for (const field of FROZEN) expect(properties).not.toContain(field)

    const rule = intelligenceWriteActionRules.configure_intelligence_source['save-profile']
    const actionFields = 'fields' in rule ? rule.fields : rule
    for (const field of FROZEN) expect(actionFields).not.toContain(field)

    const labels = marketIntelligenceAgentApprovalFieldLabels.configure_intelligence_source
    for (const field of FROZEN) expect(Object.keys(labels)).not.toContain(field)
  })
})

describe('approval field copy: declared labels match what readers saw before', () => {
  it('declares exactly the five write capabilities the shell used to recognise', () => {
    expect(Object.keys(DECLARED).sort()).toEqual([...LEGACY_TOOLS].sort())
  })

  it('covers every field the old table had, across the five capabilities', () => {
    const declaredFields = new Set(
      Object.values(DECLARED).flatMap((fields) => Object.keys(fields))
    )
    // 并集必须是旧表的 30 个字段全部：少一个意味着有一类参数再也不会被标出来。
    expect([...declaredFields].sort()).toEqual(Object.keys(LEGACY_ZH).sort())
  })

  for (const tool of LEGACY_TOOLS) {
    for (const language of LANGUAGES) {
      it(`${tool} · ${language}: every field renders the old sentence`, () => {
        const declared = DECLARED[tool]
        expect(declared).toBeDefined()
        const legacy = language === 'zh-CN' ? LEGACY_ZH : LEGACY_EN

        for (const field of Object.keys(declared)) {
          // 逐字段走真路径：一个只含该字段的请求，壳层要么给出一行，要么说明它退回了摘要。
          // 显式传产品声明：这样这条用例验的是**声明本身**，不会被生成物的旧快照掩盖。
          const fields = structuredApprovalInput(modelToolName(tool), { [field]: 'x' }, language, DECLARED)
          expect(fields, `${tool}.${field} 没有渲染出字段行`).not.toBeNull()
          expect(fields, `${tool}.${field} 应恰好一行`).toHaveLength(1)
          expect(fields?.[0]?.label, `${tool}.${field} 的 ${language} 文案与旧表不同`).toBe(legacy[field])
        }
      })
    }
  }

  it('reaches the shell through the generated registry, not only through a local call', () => {
    // 生成物是壳层的默认表：产品声明 → manifest → 生成器 → 壳层这条链任何一环漏了，
    // 正常路径都会退回 JSON 摘要，而用例如果只传本地表就发现不了。
    expect(productApprovalFieldLabels).toEqual(DECLARED)
  })

  it('keeps the full field list per capability, not just the union', () => {
    // 并集相等不够：某个能力把字段并到另一个能力里也能让并集通过，但那张卡会多出别人的行。
    const expected: Record<string, readonly string[]> = {
      configure_intelligence_source: [
        'action',
        'sourceId',
        'collectionPreset'
      ],
      operate_intelligence_source: [
        'action',
        'sourceId',
        'enabled',
        'monitoredSymbols',
        'itemId',
        'itemIds',
        'clusterIds',
        'providerId',
        'modelId',
        'filters',
        'leaseId'
      ],
      operate_macro_calendar: [
        'action',
        'eventKey',
        'enabled',
        'scheduledAt',
        'scheduledDate',
        'year',
        'body',
        'truncated',
        'acknowledgeOverwrite'
      ],
      configure_translation: [
        'action',
        'enabled',
        'autoTranslateEnabled',
        'targetLocale',
        'translateTitle',
        'translateSummary',
        'translateEvidenceExcerpt'
      ],
      configure_cross_asset_interface: ['action', 'enabled', 'itemId', 'filters']
    }
    for (const [tool, fields] of Object.entries(expected)) {
      expect(Object.keys(DECLARED[tool]).sort(), tool).toEqual([...fields].sort())
    }
  })
})