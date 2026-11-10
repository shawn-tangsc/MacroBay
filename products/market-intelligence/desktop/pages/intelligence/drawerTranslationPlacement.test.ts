import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户看图提的：抽屉「来源与采集」屏里的**翻译偏好是多余的**——它已经收进「内容处理」屏。
 *
 * 三条一起才说明「只摘了抽屉里那一处」，而不是顺手把别处也删了：
 * 1. 抽屉来源屏**不再有**翻译（连 import 与 prop 都没有，不是画出来再隐藏）；
 * 2. 抽屉内容处理屏**仍然有**翻译偏好；
 * 3. 设置页情报源**仍然有**翻译偏好与「翻译当前筛选结果」（那是**按源**的队列，和抽屉里那份全局的不同）。
 *
 * 这一条是源码级守卫（不做 DOM 断言）：`DashboardSourcesPanel` 的渲染要先挂一整套设置 hook 与 IPC 模拟，
 * 而「摘掉」这件事的判据就是**这一屏不再持有那份数据**——源码里 0 命中比 DOM 更贴近事实。
 */
const ROOT = process.cwd()
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

describe('the drawer keeps translation in one screen only', () => {
  it('leaves no translation at all in the drawer sources screen', () => {
    const source = read('products/market-intelligence/desktop/pages/intelligence/DashboardSourcesPanel.tsx')
    // 连 hook、import、prop 都不该留；留一个读了不用的 hook 也算没摘干净。
    expect(source).not.toContain('translation')
    expect(source).not.toContain('useIntelligenceTranslationSettings')
  })

  it('keeps translation on the drawer content screen', () => {
    const source = read('products/market-intelligence/desktop/pages/intelligence/ProcessingSettingsPanel.tsx')
    expect(source).toContain('TranslationPreferencesSection')
    expect(source).toContain('useIntelligenceTranslationSettings')
  })

  it('keeps translation on the settings page, where the queue is per source', () => {
    const source = read('products/market-intelligence/desktop/settings/intelligence-sources/index.tsx')
    // 设置页这一层不直接画那块组件（它在 `SourceConfigSurface` → `ProviderDetail` 里），
    // 它的判据是**仍然把翻译的数据与队列入口传下去**：`translation=` 与 `onQueueMissing`。
    expect(source).toContain('useIntelligenceTranslationSettings')
    expect(source).toContain('onQueueMissing')
  })
})
