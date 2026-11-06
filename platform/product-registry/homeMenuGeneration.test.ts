/**
 * Owner: platform/product-registry。
 * 判据来源：`docs-private/10-development/home-menu-contract.md` 第 1 步「生成器透传」。
 *
 * 为什么单开一条用例：`home` 从产品清单到渲染层要穿过**两次逐字段拷贝**——一次是这里的构建投影
 * （`menuPages.map` 里手写每个键），一次是生成文件的字符串模板。这两处漏一个字段都**不报错**，
 * 只是那个值凭空消失，而后面的解析器会安静地拿不到 home、退回 order 第一项：症状是「首页跑到了别页」，
 * 没人会想到是生成器。
 *
 * 同时钉住「未声明 ⇒ 键不存在」：落成 `home: false` 会让「没有页声明首页」和「另一页声明了首页」在
 * 读取处看不出区别（契约 §3）。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProductManifest } from '../product-manifest'
import { buildGeneratedProductRegistry, generateProductRegistry, type DiscoveredProduct } from './generate'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function fixture(options: { home: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'home-menu-generation-'))
  roots.push(root)
  const productDir = join(root, 'products', 'sample-addon')
  mkdirSync(join(productDir, 'desktop', 'pages', 'overview'), { recursive: true })
  writeFileSync(join(productDir, 'desktop', 'pages', 'overview', 'index.ts'), 'export default function View() {}\n')

  const page = {
    id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 10,
    module: './desktop/pages/overview',
    ...(options.home ? { home: true as const } : {})
  }
  const manifest: ProductManifest = {
    id: 'sample-addon', name: { 'zh-CN': 'Sample addon', 'en-US': 'Sample addon' }, version: '1.0.0',
    shellContributions: { menuPages: [page], settingsSections: [] },
    routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
    agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
  }
  const product: DiscoveredProduct = {
    productId: manifest.id, productDir, manifestPath: join(productDir, 'product.manifest.ts'),
    exportName: 'sampleAddonProductManifest', manifest
  }
  return { root, product, manifest }
}

async function generateShellSource(input: { root: string; product: DiscoveredProduct; manifest: ProductManifest }) {
  writeFileSync(input.product.manifestPath, `export const sampleAddonProductManifest = ${JSON.stringify(input.manifest)}\n`)
  const outputDir = join(input.root, 'products/generated')
  await generateProductRegistry({ workspaceRoot: input.root, outputDir })
  return readFileSync(join(outputDir, 'shellRegistry.ts'), 'utf8')
}

describe('默认首页从产品清单透传到生成物（第 1 步：生成器透传）', () => {
  it('构建投影保留 home: true，并写进生成文件', async () => {
    const { root, product, manifest } = fixture({ home: true })

    const registry = buildGeneratedProductRegistry([product])
    expect(registry.menuEntries[0]?.home).toBe(true)

    const source = await generateShellSource({ root, product, manifest })
    expect(source).toContain('home: true,')
  })

  it('未声明时这个键不存在（不是 home: false），生成文件里也不出现它', async () => {
    const { root, product, manifest } = fixture({ home: false })

    const registry = buildGeneratedProductRegistry([product])
    expect(registry.menuEntries[0]).not.toHaveProperty('home')

    const source = await generateShellSource({ root, product, manifest })
    expect(source).not.toContain('home:')
  })
})
