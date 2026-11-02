import { describe, expect, it } from 'vitest'

import { updateLinkUrl } from '../updateSource'
import { openUpdateLink } from './openUpdateLink'

function ports(opened: string[]) {
  return {
    openExternal: async (url: string) => {
      opened.push(url)
    },
    log: () => undefined
  }
}

describe('opening a link destination', () => {
  it('opens the constant address of each of the five destinations', async () => {
    for (const id of ['download', 'changelog', 'docs', 'site', 'feedback'] as const) {
      const opened: string[] = []
      await expect(openUpdateLink(id, ports(opened))).resolves.toEqual({ ok: true })
      expect(opened).toEqual([updateLinkUrl(id)])
    }
  })

  it('rejects anything that is not one of the five ids, without opening anything', async () => {
    for (const payload of [{ url: 'https://example.invalid/x' }, 'download ', '', null, 42, ['download']]) {
      const opened: string[] = []
      await expect(openUpdateLink(payload, ports(opened))).resolves.toEqual({ ok: false })
      expect(opened, JSON.stringify(payload)).toEqual([])
    }
  })

  it('answers ok:false instead of throwing when the system refuses to open it', async () => {
    const result = await openUpdateLink('docs', {
      openExternal: async () => {
        throw new Error('Failed to open')
      },
      log: () => undefined
    })
    expect(result).toEqual({ ok: false })
  })
})
