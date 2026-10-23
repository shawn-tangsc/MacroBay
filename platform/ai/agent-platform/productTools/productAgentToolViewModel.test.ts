import { describe, expect, it } from 'vitest'

import type { ProductAgentToolApprovalMode } from '../../../product-manifest'
import type { ProductAgentToolPackagePermissionMode } from './productAgentToolSchemas'
import { mapProductToolApproval } from './productAgentToolViewModel'

const approvalModes: readonly ProductAgentToolApprovalMode[] = ['never', 'on-sensitive', 'always']
const permissionModes: readonly ProductAgentToolPackagePermissionMode[] = ['disabled', 'prompt', 'allow-read-only']

describe('mapProductToolApproval', () => {
  it('never auto-approves anything while the package is disabled or prompting', () => {
    for (const permissionMode of ['disabled', 'prompt'] as const) {
      for (const requiresApproval of approvalModes) {
        for (const readOnly of [true, false]) {
          expect(mapProductToolApproval(requiresApproval, permissionMode, readOnly)).toBe('prompt')
        }
      }
    }
  })

  it('auto-approves read-only tools under allow-read-only unless the product demands confirmation', () => {
    expect(mapProductToolApproval('never', 'allow-read-only', true)).toBe('auto')
    expect(mapProductToolApproval('on-sensitive', 'allow-read-only', true)).toBe('auto')
    expect(mapProductToolApproval('always', 'allow-read-only', true)).toBe('prompt')
  })

  it('never auto-approves a mutating tool, whatever the product declares', () => {
    for (const requiresApproval of approvalModes) {
      expect(mapProductToolApproval(requiresApproval, 'allow-read-only', false)).toBe('prompt')
    }
  })

  it('keeps the permission mode list stable so the UI copy stays honest', () => {
    expect(permissionModes).toEqual(['disabled', 'prompt', 'allow-read-only'])
  })
})
