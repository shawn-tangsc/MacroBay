// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { AssistantMentionedModelsPicker } from './AssistantMentionedModelsPicker'

const info = vi.hoisted(() => vi.fn())
vi.mock('@platform/ui/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), info, error: vi.fn(), warning: vi.fn() })
}))

const labels = platformText['en-US'].assistants
let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(options: { modelOptions?: []; disabled?: boolean; onRequireModel?: () => void } = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(
      <AssistantMentionedModelsPicker
        disabled={options.disabled ?? false}
        labels={labels}
        mentionedModels={[]}
        modelOptions={options.modelOptions ?? []}
        onClearMentionedModels={() => undefined}
        onRequireModel={options.onRequireModel ?? (() => undefined)}
        onToggleMentionedModel={() => undefined}
      />
    )
  })
  return host
}

describe('AssistantMentionedModelsPicker', () => {
  it('stays clickable with no model options, shows a receipt and hands over the next step', async () => {
    const onRequireModel = vi.fn()
    const host = await mount({ onRequireModel })

    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Mentioned models"]')
    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(false)

    await act(async () => button?.click())
    expect(onRequireModel).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ titleKey: 'mentionedModelsMissingHint' }))
  })
})
