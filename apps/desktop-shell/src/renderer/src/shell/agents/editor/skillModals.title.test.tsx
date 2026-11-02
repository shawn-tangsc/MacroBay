// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { agentTextZh } from '../agentTextZh'
import SkillDetailModal from './SkillDetailModal'
import SkillMarketplaceModal from './SkillMarketplaceModal'

/**
 * 两处技能弹窗的标题都从键解析：键写错时组件解析出空串、标题整条不渲染，
 * 而 `textContent` 包含式断言照样会绿。所以断言的是渲染值本身。
 */

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(node: React.ReactElement): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(node)
  })
  // 弹窗走 portal，首帧后才挂载。
  await act(async () => {
    await Promise.resolve()
  })
}

function title(): string | null {
  return document.querySelector('.ant-modal-title')?.textContent ?? null
}

describe('技能弹窗的标题', () => {
  it('resolves the marketplace title from its key instead of rendering a blank title', async () => {
    await mount(<SkillMarketplaceModal open text={agentTextZh} installedSkills={[]} onClose={() => undefined} />)

    expect(title()).toBe(agentTextZh.editor.tools.marketplaceTitle)
  })

  it('falls back to the detail title key when no skill is selected yet', async () => {
    await mount(
      <SkillDetailModal open text={agentTextZh} skill={null} runtimeEntry={null} onClose={() => undefined} />
    )

    expect(title()).toBe(agentTextZh.editor.tools.skillDetailTitle)
  })
})
