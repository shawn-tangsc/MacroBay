import { describe, expect, it } from 'vitest'

import {
  assertNotificationEventCopy,
  findMissingNotificationEventCopy,
  type NotificationEventCopyLookup
} from './notificationEventCopyGate'

/**
 * 文案键存在性门禁：缺键的界面会直接显示键名，而且不报错、只有人看得见。
 * 这里判门禁本身的两面——全在时静默、缺一条时点名（事件 id + 键 + 语言）。
 */
const event = {
  id: 'platform.job.failed-terminal',
  titleKey: 'notification.event.platform.job.failed-terminal.title',
  reasonKey: 'notification.event.platform.job.failed-terminal.reason'
}

function lookupFrom(tables: Partial<Record<'zh-CN' | 'en-US', Record<string, string>>>): NotificationEventCopyLookup {
  return (language, key) => tables[language]?.[key]
}

const complete = {
  'zh-CN': { [event.titleKey]: '任务失败', [event.reasonKey]: '这次没有完成' },
  'en-US': { [event.titleKey]: 'Task failed', [event.reasonKey]: 'This run did not finish' }
}

describe('notification event copy gate', () => {
  it('stays silent when both languages have both sentences', () => {
    expect(findMissingNotificationEventCopy([event], lookupFrom(complete))).toEqual([])
    expect(() => assertNotificationEventCopy([event], lookupFrom(complete))).not.toThrow()
  })

  it('names the event, the key and the language when a sentence is missing', () => {
    const missingEn = {
      'zh-CN': complete['zh-CN'],
      'en-US': { [event.titleKey]: 'Task failed' }
    }
    const gaps = findMissingNotificationEventCopy([event], lookupFrom(missingEn))
    expect(gaps).toEqual([{ eventTypeId: event.id, key: event.reasonKey, language: 'en-US' }])
    expect(() => assertNotificationEventCopy([event], lookupFrom(missingEn))).toThrow(/platform\.job\.failed-terminal en-US/)
  })

  it('treats an empty sentence as missing: a blank line is as invisible as a missing key', () => {
    const blank = {
      'zh-CN': { [event.titleKey]: '任务失败', [event.reasonKey]: '   ' },
      'en-US': complete['en-US']
    }
    expect(findMissingNotificationEventCopy([event], lookupFrom(blank))).toEqual([
      { eventTypeId: event.id, key: event.reasonKey, language: 'zh-CN' }
    ])
  })

  it('reports every gap instead of stopping at the first one', () => {
    expect(findMissingNotificationEventCopy([event], lookupFrom({}))).toHaveLength(4)
  })
})
