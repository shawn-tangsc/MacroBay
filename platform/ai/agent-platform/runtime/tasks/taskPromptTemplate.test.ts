import { describe, expect, it } from 'vitest'

import { renderTaskPromptTemplate } from './taskPromptTemplate'
import { renderTaskPromptTemplate as renderFromPlatform } from '../../index'

describe('taskPromptTemplate', () => {
  const context = {
    now: '2026-01-02T03:04:05.000Z',
    timezone: 'Asia/Shanghai',
    taskName: 'Morning briefing'
  }

  it('renders the supported task variables in the supplied timezone', () => {
    expect(renderTaskPromptTemplate('{date}|{time}|{datetime}|{timezone}|{task_name}', context)).toBe(
      '2026-01-02|11:04|2026-01-02 11:04|Asia/Shanghai|Morning briefing'
    )
  })

  it('escapes literal braces and preserves unknown variables without evaluation', () => {
    expect(renderTaskPromptTemplate('{{date}} {unknown} {date}', context)).toBe('{date} {unknown} 2026-01-02')
  })

  it('does not interpret nested or expression-like placeholders', () => {
    expect(renderTaskPromptTemplate('{date.toString()} {task_name}', context)).toBe('{date.toString()} Morning briefing')
  })

  it('is available through the platform task runtime entry point', () => {
    expect(renderFromPlatform('{timezone}', context)).toBe('Asia/Shanghai')
  })
})
