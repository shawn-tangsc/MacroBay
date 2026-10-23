import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import type { AgentStoreState } from '../store/agentStore'
import type { SkillService } from './skillService'

const versionFileName = '.version'

export type BuiltinSkillSyncOptions = {
  state: AgentStoreState
  service: SkillService
  resourceSkillsRoot: string
  appVersion: string
}

export async function syncBuiltinSkillsFromResource(options: BuiltinSkillSyncOptions): Promise<AgentStoreState> {
  const { service, resourceSkillsRoot, appVersion } = options
  let nextState = options.state

  try {
    await access(resourceSkillsRoot)
  } catch {
    return nextState
  }

  const entries = await readdir(resourceSkillsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!isSafeChildName(entry.name)) continue

    const sourcePath = join(resourceSkillsRoot, entry.name)
    const destPath = service.getSkillDirectory(entry.name)
    const filesUpdated = !(await isUpToDate(destPath, appVersion))

    if (filesUpdated) {
      await mkdir(destPath, { recursive: true })
      await cp(sourcePath, destPath, { recursive: true })
      await writeFile(join(destPath, versionFileName), appVersion, 'utf8')
    }

    const result = await service.syncBuiltinSkill(nextState, entry.name, destPath, filesUpdated)
    nextState = result.state
  }

  return nextState
}

async function isUpToDate(destPath: string, appVersion: string): Promise<boolean> {
  try {
    return (await readFile(join(destPath, versionFileName), 'utf8')).trim() === appVersion
  } catch {
    return false
  }
}

function isSafeChildName(name: string): boolean {
  if (!name || name === '.' || name === '..') return false
  const parentRelative = relative('safe-root', join('safe-root', name))
  return parentRelative === name && !parentRelative.startsWith(`..${sep}`) && parentRelative !== '..'
}
