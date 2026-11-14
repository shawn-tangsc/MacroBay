import { useRef, useState } from 'react'

import type { ManualBlsIcsImportResult, ManualBlsIcsPreview } from '../../../../contracts/macro/economicCalendarQueryContracts'
import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'

export const blsIcsImportPolicy = {
  acceptedExtension: '.ics',
  inputFailureCode: 'invalid-file',
  unexpectedFailureCode: 'persistence-failed',
  fileNameSeparators: /[\\/]/
} as const

type ManualBlsIcsFailureCode = Extract<ManualBlsIcsPreview, { state: 'failed' }>['failureCode']

export type BlsIcsImportDialogState =
  | { state: 'closed' }
  | { state: 'ready'; filename: string; preview: Extract<ManualBlsIcsPreview, { state: 'ready' }> }
  | { state: 'importing'; filename: string; preview: Extract<ManualBlsIcsPreview, { state: 'ready' }> }
  | { state: 'result'; filename: string; result: Extract<ManualBlsIcsImportResult, { state: 'imported' | 'unchanged' }> }
  | { state: 'failed'; filename?: string; failureCode: ManualBlsIcsFailureCode }

type UseBlsIcsImportInput = {
  client: Pick<MacroEconomicCalendarClient, 'previewManualBlsIcs' | 'importManualBlsIcs'>
  onImported?: () => Promise<void>
}

type TextFileReadResult = { path: string; text: string; truncated: boolean }

export function useBlsIcsImport({ client, onImported }: UseBlsIcsImportInput): {
  dialogState: BlsIcsImportDialogState
  hasPendingBody: boolean
  selectFile: () => Promise<void>
  confirmImport: () => Promise<void>
  closeDialog: () => void
} {
  const [dialogState, setDialogState] = useState<BlsIcsImportDialogState>({ state: 'closed' })
  const [body, setBody] = useState<string>()
  const operationId = useRef(0)

  function closeDialog(): void {
    operationId.current += 1
    setBody(undefined)
    setDialogState({ state: 'closed' })
  }

  async function selectFile(): Promise<void> {
    const currentOperation = ++operationId.current
    setBody(undefined)
    setDialogState({ state: 'closed' })
    const selectedPath = await selectFirstFile()
    if (currentOperation !== operationId.current) return
    if (selectedPath === undefined) return

    const filename = fileName(selectedPath)
    if (!filename || !hasAcceptedExtension(filename)) {
      setDialogState({ state: 'failed', failureCode: blsIcsImportPolicy.inputFailureCode })
      return
    }

    const read = await readSelectedFile(selectedPath)
    if (currentOperation !== operationId.current) return
    if (!read || read.truncated) {
      setBody(undefined)
      setDialogState({ state: 'failed', filename, failureCode: blsIcsImportPolicy.inputFailureCode })
      return
    }

    try {
      const preview = await client.previewManualBlsIcs({ body: read.text, truncated: false })
      if (currentOperation !== operationId.current) return
      if (preview.state !== 'ready') {
        setBody(undefined)
        setDialogState({ state: 'failed', filename, failureCode: preview.failureCode })
        return
      }
      setBody(read.text)
      setDialogState({ state: 'ready', filename, preview })
    } catch {
      if (currentOperation !== operationId.current) return
      setBody(undefined)
      setDialogState({ state: 'failed', filename, failureCode: blsIcsImportPolicy.unexpectedFailureCode })
    }
  }

  async function confirmImport(): Promise<void> {
    if (dialogState.state !== 'ready' || body === undefined) return
    const currentOperation = ++operationId.current
    const { filename, preview } = dialogState
    setDialogState({ state: 'importing', filename, preview })
    try {
      const result = await client.importManualBlsIcs({ body, truncated: false })
      if (currentOperation !== operationId.current) return
      setBody(undefined)
      if (result.state === 'failed') {
        setDialogState({ state: 'failed', filename, failureCode: result.failureCode })
        return
      }
      if (result.state === 'imported') {
        try {
          await onImported?.()
        } catch {
          // The durable import succeeded even if the current view cannot refresh.
        }
        if (currentOperation !== operationId.current) return
      }
      setDialogState({ state: 'result', filename, result })
    } catch {
      if (currentOperation !== operationId.current) return
      setBody(undefined)
      setDialogState({ state: 'failed', filename, failureCode: blsIcsImportPolicy.unexpectedFailureCode })
    }
  }

  return { dialogState, hasPendingBody: body !== undefined, selectFile, confirmImport, closeDialog }
}

async function selectFirstFile(): Promise<string | undefined> {
  try {
    const paths = await window.platform.app.selectFiles()
    return Array.isArray(paths) && typeof paths[0] === 'string' && paths[0].trim().length > 0 ? paths[0] : undefined
  } catch {
    return undefined
  }
}

async function readSelectedFile(path: string): Promise<TextFileReadResult | undefined> {
  try {
    const value = await window.platform.app.readTextFile(path)
    return isTextFileReadResult(value, path) ? value : undefined
  } catch {
    return undefined
  }
}

function isTextFileReadResult(value: unknown, selectedPath: string): value is TextFileReadResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.getOwnPropertyNames(record).length === 3 && Object.getOwnPropertySymbols(record).length === 0 &&
    Object.hasOwn(record, 'path') && Object.hasOwn(record, 'text') && Object.hasOwn(record, 'truncated') &&
    record.path === selectedPath && typeof record.text === 'string' && typeof record.truncated === 'boolean'
}

function fileName(path: string): string | undefined {
  const candidate = path.split(blsIcsImportPolicy.fileNameSeparators).pop()?.trim()
  return candidate || undefined
}

function hasAcceptedExtension(filename: string): boolean {
  return filename.toLowerCase().endsWith(blsIcsImportPolicy.acceptedExtension)
}
