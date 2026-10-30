import { describe, expect, it } from 'vitest'

import type { ProductAgentToolPackageEditorView } from '@platform/ai/agent-platform/productTools/productAgentToolViewModel'
import type { LocalizedText } from '@platform/product-manifest'

import { filterProductToolPackages } from './productToolPackageFilter'

const names: Record<string, LocalizedText> = {
  'market-intelligence': { 'zh-CN': '情报模块', 'en-US': 'Market Intelligence' }
}

const pkg: ProductAgentToolPackageEditorView = {
  productId: 'market-intelligence',
  status: 'available',
  permissionMode: 'disabled',
  staleBinding: false,
  diagnostics: [],
  tools: [
    { toolName: 'get_macro_calendar', title: { 'zh-CN': '宏观日历月查询', 'en-US': 'Macro calendar month' }, description: '', readOnly: true, requiresTemporalBoundary: true, schemaVersion: 1, requiresApproval: 'never' },
    { toolName: 'configure_source', title: { 'zh-CN': '修改情报源配置', 'en-US': 'Configure source' }, description: '', readOnly: false, requiresTemporalBoundary: false, schemaVersion: 1, requiresApproval: 'always' }
  ]
}

describe('filterProductToolPackages', () => {
  it('keeps every package and sorts tools by name when the search is empty', () => {
    const [row] = filterProductToolPackages([pkg], names, '  ')
    expect(row?.tools.map((tool) => tool.toolName)).toEqual(['configure_source', 'get_macro_calendar'])
    expect(row?.filtered).toBe(false)
  })

  it('matches a Chinese product name and keeps all of its tools', () => {
    const [row] = filterProductToolPackages([pkg], names, '情报')
    expect(row?.tools).toHaveLength(2)
    expect(row?.filtered).toBe(false)
  })

  it('narrows to the matching tool when only a tool title matches', () => {
    const [row] = filterProductToolPackages([pkg], names, '日历')
    expect(row?.tools.map((tool) => tool.toolName)).toEqual(['get_macro_calendar'])
    expect(row?.filtered).toBe(true)
  })

  it('matches the raw tool name and the English title', () => {
    expect(filterProductToolPackages([pkg], names, 'configure_source')[0]?.tools).toHaveLength(1)
    expect(filterProductToolPackages([pkg], names, 'configure source')[0]?.tools).toHaveLength(1)
  })

  it('drops a package when neither the product nor any tool matches', () => {
    expect(filterProductToolPackages([pkg], names, 'sentiment')).toEqual([])
  })
})
