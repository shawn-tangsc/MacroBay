import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 「默认首页」至多一处 —— 把契约里那条红线变成一条会自己红的用例。
 *
 * 契约（`home-menu-contract.md` §4）规定：两项及以上声明 `home: true` 是错误；零项退回菜单 `order`
 * 第一项。今天壳层还没读这个字段，所以「两项都声明」不会有任何症状——它会一直安静地待在库里，
 * 直到第 3 步接线那一刻才变成「首页跟着菜单顺序漂」。**红线的价值就在于它在被读之前就拦住了人**。
 *
 * 为什么不 import 生成物：`products/generated/*` 是构建期生成的、**不入库**，而预检钩子把「这一笔
 * 会进库的树」单独落出来再查——树里没有生成物，静态 import 会让每一笔提交都红（这条写在 hook 的
 * 注释里，我这里踩过一次）。所以按目录找真清单（都是入库的源文件），运行时再加载。
 */

type MenuPage = { id: string; home?: true; order: number }
type Manifest = { id: string; shellContributions?: { menuPages?: readonly MenuPage[] } }

const PRODUCTS_DIR = resolve(__dirname, '../../products')

function manifestFiles(): string[] {
  return readdirSync(PRODUCTS_DIR)
    .map((name) => join(PRODUCTS_DIR, name, 'product.manifest.ts'))
    .filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true)
}

async function loadManifests(): Promise<Manifest[]> {
  const loaded: Manifest[] = []
  for (const file of manifestFiles()) {
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    for (const value of Object.values(module)) {
      if (value === null || typeof value !== 'object') continue
      const candidate = value as Manifest
      if (typeof candidate.id === 'string' && 'shellContributions' in candidate) loaded.push(candidate)
    }
  }
  return loaded
}

/** 纯函数：把「声明了 home 的菜单项」挑出来。合成数据也能测，不必真去改产品清单。 */
export function homeDeclarations(manifests: readonly Manifest[]): string[] {
  return manifests.flatMap((manifest) =>
    (manifest.shellContributions?.menuPages ?? [])
      .filter((page) => page.home === true)
      .map((page) => `${manifest.id}/${page.id}`)
  )
}

describe('默认首页声明', () => {
  it('全仓至多一处声明 home: true', async () => {
    const manifests = await loadManifests()

    // 扫不到只能说明路径变了；不先断言非空，这条会退化成「永远为 0」的假绿。
    expect(manifests.length).toBeGreaterThan(0)
    expect(homeDeclarations(manifests).length).toBeLessThanOrEqual(1)
  })

  it('反向：两处都声明时必须被这条判据抓出来（红线不是写着好看的）', () => {
    const twoHomes = homeDeclarations([
      { id: 'market-intelligence', shellContributions: { menuPages: [{ id: 'intelligence', home: true, order: 10 }] } },
      { id: 'another-product', shellContributions: { menuPages: [{ id: 'overview', home: true, order: 10 }] } }
    ])

    expect(twoHomes).toEqual(['market-intelligence/intelligence', 'another-product/overview'])
    expect(twoHomes.length).toBeGreaterThan(1)
  })

  it('零处声明是合法状态（退回菜单排序第一项），不是缺陷', () => {
    expect(homeDeclarations([{ id: 'p', shellContributions: { menuPages: [{ id: 'a', order: 1 }] } }])).toEqual([])
  })
})
