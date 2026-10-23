// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import type { SafeIntelligenceTranslationSettings } from '../../../service/intelligence/schema/intelligenceTranslation'
import { TranslationPreferencesSection } from './TranslationPreferencesSection'

const labels = productText['zh-CN'].settings.intelligenceSources.translationPreferences

function provider(id: string, name: string, models: ModelDefinition[]): SafeModelProvider {
  return {
    id,
    name,
    endpoints: [{ protocol: 'chat-completions', baseUrl: `https://${id}.example.test` }],
    enabled: true,
    baseUrl: `https://${id}.example.test`,
    hasApiKey: true,
    apiKeyPreview: 'sk-**********test',
    isSystem: false,
    models
  }
}

const silicon = provider('silicon', 'SiliconCloud', [
  { id: 'deepseek-v3', name: 'DeepSeek V3', capabilities: { chat: true } },
  { id: 'alpha-lite', name: 'Qwen 2.5 7B', capabilities: { chat: true } }
])

function settings(overrides: Partial<SafeIntelligenceTranslationSettings> = {}): SafeIntelligenceTranslationSettings {
  return {
    autoTranslateEnabled: true,
    targetLocale: 'follow-app',
    translateTitle: true,
    translateSummary: true,
    translateEvidenceExcerpt: true,
    updatedAt: '2026-10-22T00:00:00.000Z',
    resolvedTargetLocale: 'zh-CN',
    defaultModelId: '',
    ...overrides
  }
}

function section(overrides: Partial<SafeIntelligenceTranslationSettings> = {}): React.ReactElement {
  return (
    <ShellLanguageProvider language="zh-CN">
      <TranslationPreferencesSection
        settings={settings(overrides)}
        modelProviders={[silicon]}
        saving={false}
        queuing={false}
        labels={labels}
        onChange={() => undefined}
        onQueueMissing={() => undefined}
      />
    </ShellLanguageProvider>
  )
}

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('TranslationPreferencesSection model picker', () => {
  it('shows the model-service default translation model when no explicit model is bound', () => {
    const markup = renderToStaticMarkup(section({ defaultModelId: 'silicon:deepseek-v3' }))

    expect(markup).toContain('跟随模型服务默认 · SiliconCloud / DeepSeek V3')
  })

  it('gives the model row a full-width line so the picker cannot overlap its label', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(section({ defaultModelId: 'silicon:deepseek-v3' }))

    const row = container.querySelector('.intelligence-translation-model')?.closest('.intelligence-setting-row')
    expect(row?.classList.contains('intelligence-setting-row-wide')).toBe(true)
    expect(row?.querySelector('.intelligence-setting-label')?.textContent).toBe(labels.translationModel)
  })

  it('says the model service has no default translation model yet', () => {
    const markup = renderToStaticMarkup(section({ defaultModelId: '' }))

    expect(markup).toContain('跟随模型服务默认（未设置默认翻译模型）')
  })

  it('shows an explicit binding instead of the default', () => {
    const markup = renderToStaticMarkup(
      section({ providerId: 'silicon', modelId: 'alpha-lite', defaultModelId: 'silicon:deepseek-v3' })
    )

    expect(markup).toContain('Qwen 2.5 7B')
    expect(markup).not.toContain('跟随模型服务默认 · SiliconCloud / DeepSeek V3')
  })

  it('writes the picked model back as providerId/modelId', async () => {
    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <ShellLanguageProvider language="zh-CN">
          <TranslationPreferencesSection
            settings={settings({ defaultModelId: 'silicon:deepseek-v3' })}
            modelProviders={[silicon]}
            saving={false}
            queuing={false}
            labels={labels}
            onChange={onChange}
            onQueueMissing={() => undefined}
          />
        </ShellLanguageProvider>
      )
    })

    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-model-picker-trigger]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      document
        .querySelector<HTMLElement>('[data-model-picker-option="silicon:alpha-lite"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onChange).toHaveBeenCalledWith({ providerId: 'silicon', modelId: 'alpha-lite' })
  })

  it('clears an explicit binding back to following the default', async () => {
    const onChange = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <ShellLanguageProvider language="zh-CN">
          <TranslationPreferencesSection
            settings={settings({ providerId: 'silicon', modelId: 'alpha-lite', defaultModelId: 'silicon:deepseek-v3' })}
            modelProviders={[silicon]}
            saving={false}
            queuing={false}
            labels={labels}
            onChange={onChange}
            onQueueMissing={() => undefined}
          />
        </ShellLanguageProvider>
      )
    })

    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-model-picker-clear]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onChange).toHaveBeenCalledWith({ providerId: '', modelId: '' })
  })
})
