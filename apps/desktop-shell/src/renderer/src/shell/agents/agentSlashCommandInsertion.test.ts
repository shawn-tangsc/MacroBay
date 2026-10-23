import { describe, expect, it } from 'vitest'

import { applyAgentSlashCommandInsertion } from './agentSlashCommandInsertion'

describe('agentSlashCommandInsertion', () => {
  it('replaces the slash token before the cursor with the selected command text', () => {
    expect(
      applyAgentSlashCommandInsertion({
        text: 'Please /com',
        selectionStart: 11,
        selectionEnd: 11,
        insertion: 'Please compact the current conversation.\n'
      })
    ).toEqual({
      text: 'Please Please compact the current conversation.\n',
      caret: 48
    })
  })

  it('inserts the command text at the current selection when no slash token exists', () => {
    expect(
      applyAgentSlashCommandInsertion({
        text: 'Status',
        selectionStart: 6,
        selectionEnd: 6,
        insertion: '/todos '
      })
    ).toEqual({
      text: 'Status/todos ',
      caret: 13
    })
  })
})
