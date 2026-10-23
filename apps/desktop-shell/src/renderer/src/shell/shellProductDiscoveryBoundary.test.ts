import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('shell product discovery boundary', () => {
  it('keeps AppShell free from direct product implementation imports', () => {
    const appShell = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'), 'utf8')

    // Only the generated registry may be imported from a product directory. This guard names
    // no specific product, so adding or removing one never weakens it.
    expect(appShell).not.toMatch(/@products\/(?!generated\/)/)
    expect(appShell).not.toMatch(/(?:^|[^@])products\/[a-z0-9-]+\//)
    expect(appShell).toContain('@products/generated/shellRegistry')
    expect(appShell).not.toContain('@products/index')
  })

  it('keeps desktop shell main entry on generated product manifests only', () => {
    const mainEntry = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/main.ts'), 'utf8')

    expect(mainEntry).toContain('@products/generated/productManifests')
    expect(mainEntry).toContain('@products/generated/productServices')
    expect(mainEntry).not.toContain('@products/index')
    expect(mainEntry).not.toMatch(/@products\/(?!generated\/)/)
  })

  it('keeps platform main process free from direct product implementation imports', () => {
    const desktopMain = readFileSync(resolve(process.cwd(), 'platform/desktop/main/app.ts'), 'utf8')

    expect(desktopMain).not.toContain('@products/')
    expect(desktopMain).not.toContain('products/')
  })
})
