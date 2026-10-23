import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { RendererProcessDiagnosticEvent } from './rendererProcessDiagnostics'

export function createRendererProcessLog(filePath: string): {
  write: (event: RendererProcessDiagnosticEvent) => void
} {
  return {
    write(event) {
      void appendRendererProcessLog(filePath, event)
    }
  }
}

async function appendRendererProcessLog(filePath: string, event: RendererProcessDiagnosticEvent): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
  } catch (error) {
    console.error('[desktop] failed to write renderer diagnostics log', error)
  }
}
