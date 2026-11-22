import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { createBriefingPosterFiles } from './briefingPosterFiles'
import { createBriefingPosterProducer } from './briefingPosterProducer'
import { createBriefingPosterStore } from './briefingPosterStore'

const PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
))

const target = {
  date: '2026-11-22',
  periodId: 'p1',
  locale: 'zh-CN' as const,
  editionGeneratedAt: '2026-11-22T00:30:00.000Z'
}

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'mi-poster-producer-'))
  const files = createBriefingPosterFiles({ directory })
  const store = createBriefingPosterStore({
    db: openSqliteDatabase(':memory:'),
    files,
    now: () => '2026-11-22T00:00:00.000Z'
  })
  return { directory, files, store, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

describe('briefing poster producer', () => {
  it('writes the file first and only then claims a hash', async () => {
    const h = harness()
    const producer = createBriefingPosterProducer({
      capture: async () => ({ ok: true, bytes: PNG, width: 1080, height: 1400 }),
      files: h.files,
      store: h.store
    })

    const outcome = await producer.render(target)

    expect(outcome.ok).toBe(true)
    const contentHash = outcome.ok ? outcome.contentHash : ''
    expect(h.store.byContentHash(contentHash)).toMatchObject({ status: 'ready', contentHash })
    expect(h.store.byEdition({
      date: target.date, periodId: target.periodId, locale: target.locale, editionGeneratedAt: target.editionGeneratedAt
    })).toMatchObject({ status: 'ready', contentHash })
    h.cleanup()
  })

  it('records a timeout as its own status instead of pretending the edition has no poster', async () => {
    const h = harness()
    const producer = createBriefingPosterProducer({
      capture: async () => ({ ok: false, reason: 'timeout' }),
      files: h.files,
      store: h.store
    })

    const outcome = await producer.render(target)

    expect(outcome).toEqual({ ok: false, status: 'timeout', code: 'poster-render-timeout' })
    // 行在、状态是 timeout：读的时候能说「出了但超时」，不会被当成「这一版从没有过图」。
    expect(h.store.byEdition({
      date: target.date, periodId: target.periodId, locale: target.locale, editionGeneratedAt: target.editionGeneratedAt
    })).toMatchObject({ status: 'timeout', contentHash: null, failureCode: 'poster-render-timeout' })
    h.cleanup()
  })

  it('keeps the page\'s own reason when rendering fails', async () => {
    const h = harness()
    const producer = createBriefingPosterProducer({
      capture: async () => ({ ok: false, reason: 'render-failed', detail: 'edition-missing' }),
      files: h.files,
      store: h.store
    })

    const outcome = await producer.render(target)

    expect(outcome).toEqual({ ok: false, status: 'failed', code: 'poster-render-failed:edition-missing' })
    h.cleanup()
  })

  it('records a file that cannot be stored as a failure, without a hash', async () => {
    const h = harness()
    const producer = createBriefingPosterProducer({
      capture: async () => ({ ok: true, bytes: PNG, width: 1080, height: 1400 }),
      files: {
        write: async () => ({ ok: false, reasonCode: 'image_too_large' })
      },
      store: h.store
    })

    const outcome = await producer.render(target)

    expect(outcome).toEqual({ ok: false, status: 'failed', code: 'poster-too-large' })
    expect(h.store.byEdition({
      date: target.date, periodId: target.periodId, locale: target.locale, editionGeneratedAt: target.editionGeneratedAt
    })).toMatchObject({ status: 'failed', contentHash: null, failureCode: 'poster-too-large' })
    h.cleanup()
  })
})