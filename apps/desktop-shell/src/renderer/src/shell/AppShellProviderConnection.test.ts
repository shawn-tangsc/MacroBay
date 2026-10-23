import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

const shellRoot = 'apps/desktop-shell/src/renderer/src/shell'

/**
 * PLAT-61：API Key 区的行内「检测」按钮已删除，连接检查只走「连接检查抽屉」。
 * **草稿可测性**仍必须约束抽屉入口（可探测未启用的草稿），并保留 AppShell 里的接线判定，
 * 因此这里盯住两处源码：密钥区不再有行内测试入口、抽屉入口仍带前置校验。
 */
describe('AppShell provider connection testing', () => {
  it('drops the inline test button and keeps draft testability on the check drawer', () => {
    const shell = readSource(`${shellRoot}/AppShell.tsx`)
    const page = readSource(`${shellRoot}/model-service/ModelServiceProviderPage.tsx`)
    const keySection = readSource(`${shellRoot}/model-service/ModelServiceKeySection.tsx`)
    const brandBlock = readSource(`${shellRoot}/model-service/ModelServiceBrandBlock.tsx`)

    // 行内测试按钮已不存在：页面与密钥区都不再接线 `data-key-test` / `onTestConnection`。
    for (const source of [page, keySection]) {
      expect(source).not.toContain('data-key-test')
      expect(source).not.toContain('onTestConnection')
    }

    // 唯一入口收在品牌块，并经页面接到既有 `openConnectionCheck`。
    expect(brandBlock).toContain('data-provider-connection-check')
    expect(brandBlock).toContain('onClick={onOpenConnectionCheck}')
    expect(page).toContain('onOpenConnectionCheck={actions.openConnectionCheck}')

    // 连接检查抽屉仍由 `openConnectionCheck` 驱动，且草稿不可测时只写状态、不开抽屉。
    const connectionCheck = shell.slice(shell.indexOf('function openConnectionCheck()'))
    expect(connectionCheck).toMatch(/if \(!providerConnectionTestable\)[\s\S]*setConnectionStatus\(t\.models\.connectionNeedsConfig\)/)
    expect(connectionCheck).toContain('setIsConnectionCheckOpen(true)')
  })
})
