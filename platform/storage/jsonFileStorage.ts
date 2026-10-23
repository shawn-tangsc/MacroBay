import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type JsonFileStorage<T> = {
  read: () => Promise<T>
  write: (value: T) => Promise<void>
}

export function createJsonFileStorage<T>(filePath: string, fallback: T): JsonFileStorage<T> {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(filePath, 'utf8')) as T
      } catch (error) {
        if (isMissingFileError(error)) return fallback
        throw error
      }
    },
    async write(value) {
      await mkdir(dirname(filePath), { recursive: true })
      const temporaryPath = `${filePath}.next`
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, filePath)
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
