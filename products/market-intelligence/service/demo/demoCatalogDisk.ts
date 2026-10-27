/**
 * 开发期的示例场景加载：直接从磁盘读 `demo/scenarios/**`。
 *
 * 打包后的应用用构建期 glob（`demoCatalog`），开发期用这个——改一份 JSON 只要重新进入示例，
 * 不必重启 Electron 主进程。两条路径产出同一种文件表，校验与语言解析完全共用。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type SampleModeDiskFiles = Readonly<{
  scenarioFiles: Record<string, unknown>
  surfacesFiles: Record<string, unknown>
  responseFiles: Record<string, unknown>
}>

const LOCALES = ['common', 'zh-CN', 'en-US'] as const

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function listDirectories(root: string): string[] {
  try {
    return readdirSync(root).filter((entry) => {
      try {
        return statSync(join(root, entry)).isDirectory() && entry !== 'raw'
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/** 目录不存在时返回空表：示例数据是可选资产，缺了只是「没有场景」。 */
export function readSampleModeFilesFromDisk(root: string): SampleModeDiskFiles {
  const scenarioFiles: Record<string, unknown> = {}
  const surfacesFiles: Record<string, unknown> = {}
  const responseFiles: Record<string, unknown> = {}
  for (const scenarioId of listDirectories(root)) {
    const directory = join(root, scenarioId)
    const metaPath = join(directory, 'scenario.json')
    try {
      statSync(metaPath)
      scenarioFiles[metaPath] = readJson(metaPath)
    } catch {
      continue
    }
    const surfacesPath = join(directory, 'surfaces.json')
    try {
      statSync(surfacesPath)
      surfacesFiles[surfacesPath] = readJson(surfacesPath)
    } catch {
      // surfaces 缺失由 catalog 报问题，不在这里中断。
    }
    for (const locale of LOCALES) {
      const localeDirectory = join(directory, 'responses', locale)
      let files: string[]
      try {
        files = readdirSync(localeDirectory)
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const path = join(localeDirectory, file)
        responseFiles[path] = readJson(path)
      }
    }
  }
  return { scenarioFiles, surfacesFiles, responseFiles }
}
