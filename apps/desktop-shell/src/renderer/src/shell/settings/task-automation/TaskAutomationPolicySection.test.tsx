// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { TaskAutomationPolicySection } from './TaskAutomationPolicySection'
import type { TaskAutomationSettingsController } from './useTaskAutomationSettings'

const labels = platformText['zh-CN'].taskAutomation

/**
 * 写失败与读失败是两件事，这一组用**点击**钉住它们走的是两条路：
 * 保存失败 → 控件还能改、读者选的值还在、重试重发那次修改；
 * 读取失败 → 控件停用（没有可选的）、重试重读。
 *
 * 只断言文案不够：这次真正的缺陷是「重试调了读口」，而静态标记看不出点下去调了谁。
 */
describe('TaskAutomationPolicySection failure handling', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps the control usable and shows the picked value when a save fails', async () => {
    const container = await render({ policyWriteError: true, pendingPolicyPreset: 'conservative' })

    const select = container.querySelector('.ant-select')
    expect(select?.className).not.toContain('ant-select-disabled')
    // 读者选的是「保守」，已存的是「平衡」：没保存上不等于他没选过，控件显示的是他选的那个。
    expect(container.textContent).toContain('保守')
    expect(container.textContent).toContain('这次操作没有成功，可以重试')
    // 保存失败不是读失败，不许说「数据没有读出来」。
    expect(container.textContent).not.toContain('数据没有读出来，可以重试')
    expect(container.textContent).not.toContain(labels.policyLoadFailed)
  })

  it('re-sends the same change from the retry instead of re-reading the policy', async () => {
    const retryPolicySave = vi.fn()
    const reloadPolicy = vi.fn()
    const container = await render({
      policyWriteError: true,
      pendingPolicyPreset: 'conservative',
      retryPolicySave,
      reloadPolicy
    })

    await act(async () => {
      retryButton(container).click()
    })

    expect(retryPolicySave).toHaveBeenCalledTimes(1)
    expect(reloadPolicy).not.toHaveBeenCalled()
  })

  it('stops the control and re-reads when the policy itself could not be read', async () => {
    const reloadPolicy = vi.fn()
    const retryPolicySave = vi.fn()
    const container = await render({ policy: null, policyReadError: true, reloadPolicy, retryPolicySave })

    expect(container.querySelector('.ant-select')?.className).toContain('ant-select-disabled')
    expect(container.textContent).toContain('数据没有读出来，可以重试')
    expect(container.textContent).toContain(labels.policyLoadFailed)

    await act(async () => {
      retryButton(container).click()
    })

    expect(reloadPolicy).toHaveBeenCalledTimes(1)
    expect(retryPolicySave).not.toHaveBeenCalled()
  })
})

async function render(overrides: Partial<TaskAutomationSettingsController>): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(TaskAutomationPolicySection, {
      labels,
      language: 'zh-CN',
      controller: controller(overrides),
      emptyTasks: false
    }))
  })
  return container
}

function retryButton(container: HTMLElement): HTMLElement {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === labels.retry)
  if (!button) throw new Error('retry button not rendered')
  return button
}

function controller(overrides: Partial<TaskAutomationSettingsController>): TaskAutomationSettingsController {
  return {
    loading: false,
    error: false,
    tasks: [],
    status: 'all',
    setStatus: vi.fn(),
    nameQuery: '',
    setNameQuery: vi.fn(),
    clearFilters: vi.fn(),
    expandedTaskId: null,
    toggleTaskExpanded: vi.fn(),
    audits: [],
    state: {
      filteredTasks: [],
      rows: [],
      selectedTask: null,
      expandedTaskId: null,
      auditCount: 0,
      deliveryHealth: { delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 },
      aggregateHealth: { delivered: 0, failed: 0, pending: 0, skipped: 0, unknown: 0 },
      latestRunAt: null,
      emptyState: 'none',
      hasFilters: false
    },
    policy: {
      preset: 'balanced',
      policy: {
        maxActiveTasksPerAgent: 30,
        minimumRecurringIntervalMs: 300_000,
        maximumTimeoutMinutes: 120,
        maxChannelsPerTask: 10
      }
    },
    policyLoading: false,
    policyReadError: false,
    policyWriteError: false,
    pendingPolicyPreset: null,
    reloadPolicy: vi.fn(),
    retryPolicySave: vi.fn(),
    hasMore: false,
    loadMore: vi.fn(),
    reload: vi.fn(),
    updatePolicy: vi.fn(),
    ...overrides
  } as TaskAutomationSettingsController
}
