import { describe, expect, it } from 'vitest'

import { createTaskIpcScheduleValidationOptions } from './taskScheduleValidationOptions'

describe('createTaskIpcScheduleValidationOptions', () => {
  it('takes the default time zone from the shell reader, not from the machine', () => {
    let zone = 'Asia/Tokyo'
    const read = createTaskIpcScheduleValidationOptions({
      timeZone: () => zone,
      now: () => new Date('2026-11-01T00:00:00.000Z')
    })

    expect(read()).toEqual({
      now: new Date('2026-11-01T00:00:00.000Z'),
      defaultTimezone: 'Asia/Tokyo'
    })

    // 用户在设置里换了时区：同一个读取器给出的默认时区必须跟着变。
    zone = 'Asia/Shanghai'
    expect(read().defaultTimezone).toBe('Asia/Shanghai')
  })
})
