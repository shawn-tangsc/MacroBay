import { describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeMessagePartDetailItem } from './agentRuntimeMessageParts'
import { openAgentRuntimeMessagePartDetailItem } from './agentRuntimeMessagePartItemOpen'

describe('agent runtime message part item opener', () => {
  it('opens path targets through the platform path seam', async () => {
    const openExternal = vi.fn<(target: string) => Promise<void>>().mockResolvedValue(undefined)
    const openPath = vi.fn<(target: string) => Promise<void>>().mockResolvedValue(undefined)
    const item: AgentRuntimeMessagePartDetailItem = {
      kind: 'resource',
      title: 'resource',
      openTarget: '/tmp/report.txt',
      openTargetKind: 'path'
    }

    await expect(openAgentRuntimeMessagePartDetailItem(item, { openExternal, openPath })).resolves.toBe(true)
    expect(openPath).toHaveBeenCalledWith('/tmp/report.txt')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens external targets through the platform external seam', async () => {
    const openExternal = vi.fn<(target: string) => Promise<void>>().mockResolvedValue(undefined)
    const openPath = vi.fn<(target: string) => Promise<void>>().mockResolvedValue(undefined)
    const item: AgentRuntimeMessagePartDetailItem = {
      kind: 'media',
      title: 'image',
      openTarget: 'https://example.com/report',
      openTargetKind: 'external'
    }

    await expect(openAgentRuntimeMessagePartDetailItem(item, { openExternal, openPath })).resolves.toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://example.com/report')
    expect(openPath).not.toHaveBeenCalled()
  })

  it('does nothing when an item has no opener target', async () => {
    const openExternal = vi.fn<(target: string) => Promise<void>>().mockResolvedValue(undefined)
    const openPath = vi.fn<(target: string) => Promise<void>>().mockResolvedValue(undefined)
    const item: AgentRuntimeMessagePartDetailItem = {
      kind: 'text',
      title: 'text',
      text: 'hello'
    }

    await expect(openAgentRuntimeMessagePartDetailItem(item, { openExternal, openPath })).resolves.toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
    expect(openPath).not.toHaveBeenCalled()
  })
})
