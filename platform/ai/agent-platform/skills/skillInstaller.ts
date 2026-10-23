import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { findSkillMdPath } from './skillMetadataParser'

export class SkillInstaller {
  async install(sourceDir: string, destPath: string): Promise<void> {
    if (resolve(sourceDir) === resolve(destPath)) return

    const backupPath = `${destPath}.bak`
    let hasBackup = false

    try {
      await rm(backupPath, { recursive: true, force: true })
      await mkdir(dirname(destPath), { recursive: true })
      try {
        await rename(destPath, backupPath)
        hasBackup = true
      } catch (error) {
        if (!isMissingFileError(error)) throw error
      }

      await cp(sourceDir, destPath, {
        recursive: true,
        dereference: true,
        force: true
      })
      if (hasBackup) await rm(backupPath, { recursive: true, force: true })
    } catch (error) {
      if (hasBackup) {
        await rm(destPath, { recursive: true, force: true }).catch(() => undefined)
        await rename(backupPath, destPath).catch(() => undefined)
      }
      throw error
    }
  }

  async uninstall(skillPath: string): Promise<void> {
    await rm(skillPath, { recursive: true, force: true })
  }

  async computeContentHash(skillDir: string): Promise<string> {
    const skillMdPath = await findSkillMdPath(skillDir)
    if (!skillMdPath) throw new Error(`SKILL.md not found in ${skillDir}`)
    return createHash('sha256').update(await readFile(skillMdPath, 'utf8')).digest('hex')
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
