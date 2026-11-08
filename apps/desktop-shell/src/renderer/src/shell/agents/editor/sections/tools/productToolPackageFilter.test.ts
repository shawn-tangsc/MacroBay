import { describe, expect, it } from 'vitest'

import type { ProductAgentToolPackageEditorView } from '@platform/ai/agent-platform/productTools/productAgentToolViewModel'
import type { LocalizedText } from '@platform/product-manifest'

import { filterProductToolPackages } from './productToolPackageFilter'

const names: Record<string, LocalizedText> = {
  'sample-product': { 'zh-CN': '示例产品', 'en-US': 'Sample product' }
}

const pkg: ProductAgentToolPackageEditorView = {
  productId: 'sample-product',
  status: 'available',
  permissionMode: 'disabled',
  staleBinding: false,
  diagnostics: [],
  tools: [
    { toolName: 'get_monthly_records', title: { 'zh-CN': '月度记录查询', 'en-US': 'Monthly records' }, description: '', readOnly: true, requiresTemporalBoundary: true, schemaVersion: 1, requiresApproval: 'never' },
    { toolName: 'configure_source', title: { 'zh-CN': '修改来源配置', 'en-US': 'Configure source' }, description: '', readOnly: false, requiresTemporalBoundary: false, schemaVersion: 1, requiresApproval: 'always' }
  ]
}

describe('filterProductToolPackages', () => {
  it('keeps every package and sorts tools by name when the search is empty', () => {
    const [row] = filterProductToolPackages([pkg], names, '  ')
    expect(row?.tools.map((tool) => tool.toolName)).toEqual(['configure_source', 'get_monthly_records'])
    expect(row?.filtered).toBe(false)
  })

  it('matches a Chinese product name and keeps all of its tools', () => {
    const [row] = filterProductToolPackages([pkg], names, '示例')
    expect(row?.tools).toHaveLength(2)
    expect(row?.filtered).toBe(false)
  })

  it('narrows to the matching tool when only a tool title matches', () => {
    const [row] = filterProductToolPackages([pkg], names, '月度')
    expect(row?.tools.map((tool) => tool.toolName)).toEqual(['get_monthly_records'])
    expect(row?.filtered).toBe(true)
  })

  it('matches the raw tool name and the English title', () => {
    expect(filterProductToolPackages([pkg], names, 'configure_source')[0]?.tools).toHaveLength(1)
    expect(filterProductToolPackages([pkg], names, 'configure source')[0]?.tools).toHaveLength(1)
  })

  it('drops a package when neither the product nor any tool matches', () => {
    expect(filterProductToolPackages([pkg], names, 'nonexistent-term')).toEqual([])
  })
})
