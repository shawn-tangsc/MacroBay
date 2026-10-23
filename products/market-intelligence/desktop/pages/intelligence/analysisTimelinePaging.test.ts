import { expect, it } from 'vitest'
import { analysisTimelinePaging, analysisTimelinePagingPolicy } from './analysisTimelinePaging'

it('shows eight nodes a page', () => {
  expect(analysisTimelinePagingPolicy.pageSize).toBe(8)
  // The pull starts a little before the end, so the next page is already there when it is reached.
  expect(analysisTimelinePagingPolicy.loadAheadPx).toBeGreaterThan(0)
})

it.each([[0, 1, 0], [3, 1, 3], [8, 1, 8], [9, 1, 8], [9, 2, 9], [20, 2, 16], [20, 3, 20], [20, 9, 20]])(
  'shows %i read nodes over %i pages as %i rows', (total, pages, visible) => {
    expect(analysisTimelinePaging(total, pages).visible).toBe(visible)
  })

it('says whether anything is already read behind the window', () => {
  // Sixteen read over one page: pulling again only widens the window, nothing has to be fetched.
  expect(analysisTimelinePaging(16, 1)).toEqual({ visible: 8, hasUnread: true })
  // Eight read, all shown: the reader has caught up, so the next pull is a product read.
  expect(analysisTimelinePaging(8, 1)).toEqual({ visible: 8, hasUnread: false })
  // Everything read is already on screen, and a wider window changes nothing.
  expect(analysisTimelinePaging(3, 1)).toEqual({ visible: 3, hasUnread: false })
  expect(analysisTimelinePaging(20, 5)).toEqual({ visible: 20, hasUnread: false })
})

it('never shows a row that was not read, however far the reader has pulled', () => {
  expect(analysisTimelinePaging(0, 4).visible).toBe(0)
  expect(analysisTimelinePaging(2, 40).visible).toBe(2)
})
