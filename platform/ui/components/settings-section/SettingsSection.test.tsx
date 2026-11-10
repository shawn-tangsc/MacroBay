// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsSection, SettingsSectionHeader } from './SettingsSection'

/**
 * 只钉结构上的三条决定：标题在区块头里、ⓘ 紧跟标题（不推到右侧）、动作槽在标题行另一端。
 * 数值（13/650、8、16）在 `styles.css` 里，跟设置页现状一致，不在这里断像素。
 */
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(node: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(node))
  return host
}

describe('settings section', () => {
  it('renders the title inside the block header, with the body under it', async () => {
    const host = await mount(<SettingsSection title="分析设置"><p>row</p></SettingsSection>)
    expect(host.querySelector('.settings-section__title')?.textContent).toBe('分析设置')
    expect(host.querySelector('.settings-section__body')?.textContent).toBe('row')
  })

  it('renders a caller-supplied ⓘ slot inside the title, so a block does not hand-build the row', async () => {
    const host = await mount(<SettingsSection info={<button data-info="true" type="button">i</button>} title="生成">
      <span>row</span>
    </SettingsSection>)
    const title = host.querySelector('.settings-section__title')!
    expect(title.querySelector('.settings-section__info [data-info="true"]')).not.toBeNull()
  })

  it('keeps ⓘ next to the title instead of pushing it to the far end', async () => {
    const host = await mount(<SettingsSection title="分析设置" action={<button type="button">动作</button>}>
      <span>row</span>
    </SettingsSection>)
    const title = host.querySelector('.settings-section__title')!
    expect(title.querySelector('.settings-section__info')).toBeNull()
    expect(host.querySelector('.settings-section__action')?.textContent).toBe('动作')

    const withInfo = await mount(<SettingsSectionHeader info={<button type="button">i</button>} title="分析设置" />)
    const titleWithInfo = withInfo.querySelector('.settings-section__title')!
    expect(titleWithInfo.querySelector('.settings-section__info')).not.toBeNull()
    // 动作槽与标题是同一行的两个端：动作不在标题元素里面。
    expect(titleWithInfo.querySelector('.settings-section__action')).toBeNull()
  })
})
