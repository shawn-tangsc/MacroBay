// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfigProvider } from 'antd'

import type { JobScheduleView } from '@platform/jobs'

import { platformText } from '../../../i18n/platformText'
import { TaskAutomationResourceJobsSection } from './TaskAutomationResourceJobsSection'
import { TASK_AUTOMATION_CONTROL_CLASSES } from './taskAutomationControlWidths'

const labels = platformText['zh-CN'].taskAutomation

describe('TaskAutomationResourceJobsSection filters', () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('filters the projected jobs by a case-insensitive name substring and recovers with clear filters', async () => {
    const controller = {
      loading: false,
      error: false,
      errorReason: null,
      items: [
        job({ id: 'a', title: 'Alpha collect', productId: null, owner: 'platform' }),
        job({ id: 'b', title: 'Beta collect', productId: 'market-intelligence' }),
        job({ id: 'c', title: 'Beta digest', productId: 'market-intelligence' })
      ],
      productNames: { 'market-intelligence': 'Market Intelligence' },
      reload: vi.fn()
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(TaskAutomationResourceJobsSection, { labels, language: 'zh-CN', controller }))
    })

    expect(rows(container)).toHaveLength(3)
    expect(container.textContent).toContain(labels.resourceCount(3, 3))

    const input = container.querySelector('.task-automation-filters input') as HTMLInputElement
    await act(async () => {
      typeInto(input, 'BETA')
    })
    expect(rows(container)).toHaveLength(2)
    expect(container.textContent).toContain(labels.resourceCount(3, 2))
    expect(container.textContent).toContain('Beta digest')
    expect(container.textContent).not.toContain('Alpha collect')

    await act(async () => {
      typeInto(input, 'zzz')
    })
    expect(rows(container)).toHaveLength(0)
    expect(container.textContent).toContain(labels.filterEmpty)
    const clear = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === labels.clearFilters)
    expect(clear).toBeDefined()

    await act(async () => {
      clear!.click()
    })
    expect(rows(container)).toHaveLength(3)
    expect(container.textContent).toContain(labels.resourceCount(3, 3))
  })
})

describe('TaskAutomationResourceJobsSection pagination', () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('paginates 18 jobs at 10 per page with working next/previous and count text', async () => {
    const container = await renderSection(controllerWith(jobs18()))

    expect(rows(container)).toHaveLength(10)
    expect(text(container)).toContain(labels.resourceCountWithPage(18, 18, 1, 2))
    expect(text(container)).toContain('第 1 / 2 页')
    expect(navButton(container, labels.resourcePrevPage).disabled).toBe(true)
    expect(navButton(container, labels.resourceNextPage).disabled).toBe(false)

    await act(async () => {
      navButton(container, labels.resourceNextPage).click()
    })
    expect(rows(container)).toHaveLength(8)
    expect(text(container)).toContain(labels.resourcePageIndicator(2, 2))
    expect(navButton(container, labels.resourceNextPage).disabled).toBe(true)
    expect(navButton(container, labels.resourcePrevPage).disabled).toBe(false)

    await act(async () => {
      navButton(container, labels.resourcePrevPage).click()
    })
    expect(rows(container)).toHaveLength(10)
    expect(text(container)).toContain(labels.resourcePageIndicator(1, 2))
  })

  it('resets to page 1 and clamps the page window when a filter shrinks the list', async () => {
    const container = await renderSection(controllerWith(jobs18()))
    await act(async () => {
      navButton(container, labels.resourceNextPage).click()
    })
    expect(rows(container)).toHaveLength(8)

    await act(async () => {
      typeInto(container.querySelector('.task-automation-filters input') as HTMLInputElement, 'nasdaq')
    })
    expect(rows(container)).toHaveLength(1)
    expect(text(container)).toContain(labels.resourcePageIndicator(1, 1))
    expect(text(container)).toContain(labels.resourceCountWithPage(18, 1, 1, 1))
    expect(navButton(container, labels.resourceNextPage).disabled).toBe(true)

    await act(async () => {
      typeInto(container.querySelector('.task-automation-filters input') as HTMLInputElement, '')
    })
    expect(rows(container)).toHaveLength(10)
    expect(text(container)).toContain(labels.resourcePageIndicator(1, 2))
  })

  it('hides the pagination controls when the filters match nothing', async () => {
    const container = await renderSection(controllerWith(jobs18()))

    await act(async () => {
      typeInto(container.querySelector('.task-automation-filters input') as HTMLInputElement, 'zzz-no-match')
    })

    expect(rows(container)).toHaveLength(0)
    expect(text(container)).toContain(labels.filterEmpty)
    expect(container.querySelector('.task-automation-pagination')).toBeNull()
    expect(container.querySelector('.task-automation-filters')).not.toBeNull()
  })

  it('changes the page size to 20 and shows the whole 18 job projection on a single page', async () => {
    const container = await renderSection(controllerWith(jobs18()))

    await chooseOption(container.querySelector('.task-automation-pagination .ant-select') as HTMLElement, '20')

    expect(rows(container)).toHaveLength(18)
    expect(text(container)).toContain(labels.resourcePageIndicator(1, 1))
    expect(navButton(container, labels.resourceNextPage).disabled).toBe(true)
    expect(navButton(container, labels.resourcePrevPage).disabled).toBe(true)
  })

  it('keeps fixed width classes on every filter control regardless of the selected value', async () => {
    const first = await renderSection(controllerWith(jobs18()))
    const second = await renderSection(controllerWith(jobs18()))

    await chooseOption(
      second.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.source}`) as HTMLElement,
      'Market Intelligence'
    )

    for (const container of [first, second]) {
      const name = container.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.name}`)
      const source = container.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.source}`)
      const registration = container.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.registration}`)
      expect(name).not.toBeNull()
      expect(source).not.toBeNull()
      expect(registration).not.toBeNull()
      // 宽度只能来自固定类，不能是随内容变化的内联 style。
      expect(source?.getAttribute('style')).toBeNull()
      expect(registration?.getAttribute('style')).toBeNull()
    }
    expect(second.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.source}`)?.className)
      .toBe(first.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.source}`)?.className)
    expect(second.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.registration}`)?.className)
      .toBe(first.querySelector(`.${TASK_AUTOMATION_CONTROL_CLASSES.registration}`)?.className)
  })
})

function jobs18(): JobScheduleView[] {
  return Array.from({ length: 18 }, (_, index) => job({
    id: `job-${index + 1}`,
    title: index === 17 ? 'Nasdaq collector' : `Auto collect ${index + 1}`,
    productId: 'market-intelligence',
    owner: index % 2 === 0 ? 'product' : 'platform'
  }))
}

function controllerWith(items: JobScheduleView[]) {
  return {
    loading: false,
    error: false,
    errorReason: null,
    items,
    productNames: { 'market-intelligence': 'Market Intelligence' },
    reload: vi.fn()
  }
}

async function renderSection(controller: ReturnType<typeof controllerWith>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ConfigProvider, { theme: { token: { motion: false } } },
      createElement(TaskAutomationResourceJobsSection, { labels, language: 'zh-CN', controller })))
  })
  return container
}

function navButton(container: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('button'))
    .find((button) => button.getAttribute('aria-label') === label) as HTMLButtonElement
}

function text(container: HTMLElement): string {
  return container.textContent ?? ''
}

async function chooseOption(select: HTMLElement, optionText: string): Promise<void> {
  const trigger = select.querySelector('.ant-select-selector') ?? select
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await vi.waitFor(() => {
    const options = Array.from(document.querySelectorAll('.ant-select-item-option'))
    expect(options.some((option) => option.textContent?.trim() === optionText)).toBe(true)
  })
  const option = Array.from(document.querySelectorAll('.ant-select-item-option'))
    .find((candidate) => candidate.textContent?.trim() === optionText) as HTMLElement
  await act(async () => {
    option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // 让弹层关闭动画的 rAF/定时器在 act 内收敛，避免测试结束后才更新状态。
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function rows(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('tbody tr'))
}

function job(overrides: Partial<JobScheduleView>): JobScheduleView {
  return {
    id: 'job-1',
    title: 'Job',
    owner: 'product',
    productId: 'market-intelligence',
    trigger: { kind: 'manual' },
    registered: true,
    nextRunAt: null,
    lastRunAt: null,
    lastOutcome: 'never',
    lastRunStatus: null,
    lastDurationMs: null,
    lastErrorSummary: null,
    ...overrides
  }
}
