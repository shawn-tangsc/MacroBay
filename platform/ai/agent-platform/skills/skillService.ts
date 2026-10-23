import { execFile } from 'node:child_process'
import { lstat, mkdir, readdir, readFile, rm, stat, symlink, unlink } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import type {
  InstalledSkill,
  LocalSkill,
  SkillFileNode,
  SkillInstallFromDirectoryOptions,
  SkillInstallOptions,
  SkillInstallFromZipOptions,
  SkillToggleOptions
} from '../schemas/skillSchemas'
import type { AgentStoreState } from '../store/agentStore'
import { deleteInstalledSkill, setAgentSkillEnabled, upsertInstalledSkill } from '../store/agentRelationsStore'
import { SkillInstaller } from './skillInstaller'
import { findAllSkillDirectories, parseSkillMetadata } from './skillMetadataParser'

const maxFolderNameLength = 80
const maxExtractedZipSizeBytes = 100 * 1024 * 1024
const maxZipFileCount = 1000
const execFileAsync = promisify(execFile)

export type SkillRepositoryFetcher = (repoUrl: string, destDir: string) => Promise<void>
export type SkillZipExtractor = (zipFilePath: string, destDir: string) => Promise<void>
export type SkillZipInspection = {
  totalSize: number
  fileCount: number
}
export type SkillZipInspector = (zipFilePath: string) => Promise<SkillZipInspection>
export type SkillHttpResponse = {
  ok: boolean
  status: number
  arrayBuffer: () => Promise<ArrayBuffer>
}
export type SkillHttpFetcher = (url: string, init?: { headers?: Record<string, string> }) => Promise<SkillHttpResponse>

export type SkillServicePaths = {
  skillsRoot: string
  installTempRoot: string
}

export type SkillServiceOptions = {
  paths: SkillServicePaths
  installer?: SkillInstaller
  fetchRepository?: SkillRepositoryFetcher
  fetchHttp?: SkillHttpFetcher
  inspectZip?: SkillZipInspector
  extractZip?: SkillZipExtractor
  now?: () => string
  queries?: {
    list?: (query?: { agentId?: string; search?: string }) => InstalledSkill[]
  }
}

export type SkillMutationResult<T = InstalledSkill | null> = {
  state: AgentStoreState
  skill: T
}

export class SkillService {
  private readonly installer: SkillInstaller
  private readonly fetchRepository: SkillRepositoryFetcher
  private readonly fetchHttp: SkillHttpFetcher
  private readonly inspectZipArchive: SkillZipInspector
  private readonly extractZipArchive: SkillZipExtractor
  private readonly now: () => string

  constructor(private readonly options: SkillServiceOptions) {
    this.installer = options.installer ?? new SkillInstaller()
    this.fetchRepository = options.fetchRepository ?? cloneRepository
    this.fetchHttp = options.fetchHttp ?? fetchHttp
    this.inspectZipArchive = options.inspectZip ?? inspectZipWithUnzip
    this.extractZipArchive = options.extractZip ?? extractZipWithUnzip
    this.now = options.now ?? (() => new Date().toISOString())
  }

  list(state: AgentStoreState, query: { agentId?: string; search?: string } = {}): InstalledSkill[] {
    if (this.options.queries?.list) {
      return this.options.queries.list(query)
    }

    const keyword = query.search?.trim().toLowerCase() ?? ''
    const enabledSkillIds = new Set(
      query.agentId
        ? state.agentSkills
            .filter((binding) => binding.agentId === query.agentId && binding.isEnabled)
            .map((binding) => binding.skillId)
        : []
    )

    return state.skills
      .filter((skill) => {
        if (!keyword) return true
        return `${skill.name} ${skill.description ?? ''} ${skill.folderName} ${skill.sourceTags.join(' ')}`
          .toLowerCase()
          .includes(keyword)
      })
      .map((skill) => ({ ...skill, isEnabled: enabledSkillIds.has(skill.id) }))
  }

  getById(state: AgentStoreState, skillId: string): InstalledSkill | null {
    return state.skills.find((skill) => skill.id === skillId) ?? null
  }

  getByFolderName(state: AgentStoreState, name: string): InstalledSkill | null {
    const folderName = sanitizeFolderName(name)
    return state.skills.find((skill) => skill.folderName === folderName) ?? null
  }

  getSkillDirectory(name: string): string {
    return join(this.options.paths.skillsRoot, sanitizeFolderName(name))
  }

  async install(state: AgentStoreState, options: SkillInstallOptions): Promise<SkillMutationResult<InstalledSkill>> {
    const [source, ...identifierParts] = options.installSource.split(':')
    const identifier = identifierParts.join(':')

    switch (source) {
      case 'claude-plugins':
        return this.installFromClaudePlugins(state, identifier)
      case 'skills.sh':
        return this.installFromSkillsSh(state, identifier)
      case 'clawhub':
        return this.installFromClawhub(state, identifier)
      default:
        throw new Error(`Unknown install source: ${source}`)
    }
  }

  async installFromZip(state: AgentStoreState, options: SkillInstallFromZipOptions): Promise<SkillMutationResult<InstalledSkill>> {
    await this.validateZipFile(options.zipFilePath)
    await this.assertZipWithinLimits(options.zipFilePath)
    const tempDir = await this.createTempDir('zip-install')

    try {
      await this.extractZipArchive(options.zipFilePath, tempDir)
      const skillDir = await resolveSkillDirectory(tempDir, null, null)
      return await this.installSkillDir(state, skillDir, 'zip', null)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  async installFromDirectory(
    state: AgentStoreState,
    options: SkillInstallFromDirectoryOptions
  ): Promise<SkillMutationResult<InstalledSkill>> {
    const sourcePath = resolve(options.directoryPath)
    const sourceStats = await stat(sourcePath)
    if (!sourceStats.isDirectory()) throw new Error(`Directory not found: ${options.directoryPath}`)
    return this.installSkillDir(state, sourcePath, options.source ?? 'local', options.sourceUrl ?? null)
  }

  async syncBuiltinSkill(
    state: AgentStoreState,
    folderName: string,
    sourcePath: string,
    filesUpdated: boolean
  ): Promise<SkillMutationResult<InstalledSkill>> {
    const safeFolderName = sanitizeFolderName(folderName)
    const existing = state.skills.find((skill) => skill.folderName === safeFolderName)
    if (existing && !filesUpdated) {
      return { state, skill: existing }
    }

    const result = await this.installSkillDir(state, sourcePath, 'builtin', null)
    if (existing) return result

    let nextState = result.state
    for (const agent of nextState.agents) {
      nextState = setAgentSkillEnabled(nextState, agent.id, result.skill.id, true)
      for (const workspace of this.getAgentSessionWorkspaces(nextState, agent.id)) {
        await this.linkSkill(result.skill.folderName, workspace)
      }
    }

    return {
      state: nextState,
      skill: result.skill
    }
  }

  async enableBuiltinSkillsForNewAgents(state: AgentStoreState): Promise<AgentStoreState> {
    let nextState = state
    const builtinSkills = nextState.skills.filter((skill) => skill.source === 'builtin' && skill.isEnabled)
    if (builtinSkills.length === 0) return nextState

    for (const agent of nextState.agents) {
      const hasAnySkillChoice = nextState.agentSkills.some((binding) => binding.agentId === agent.id)
      if (hasAnySkillChoice) continue

      for (const skill of builtinSkills) {
        nextState = setAgentSkillEnabled(nextState, agent.id, skill.id, true)
        for (const workspace of this.getAgentSessionWorkspaces(nextState, agent.id)) {
          await this.linkSkill(skill.folderName, workspace)
        }
      }
    }

    return nextState
  }

  async toggle(state: AgentStoreState, options: SkillToggleOptions): Promise<SkillMutationResult> {
    const skill = state.skills.find((item) => item.id === options.skillId)
    if (!skill) return { state, skill: null }

    let nextState = setAgentSkillEnabled(state, options.agentId, options.skillId, options.isEnabled)
    const workspaces = this.getAgentSessionWorkspaces(nextState, options.agentId)
    const applied: string[] = []

    try {
      for (const workspace of workspaces) {
        if (options.isEnabled) await this.linkSkill(skill.folderName, workspace)
        else await this.unlinkSkill(skill.folderName, workspace)
        applied.push(workspace)
      }
    } catch (error) {
      for (const workspace of applied) {
        if (options.isEnabled) await this.unlinkSkill(skill.folderName, workspace).catch(() => undefined)
        else await this.linkSkill(skill.folderName, workspace).catch(() => undefined)
      }
      nextState = setAgentSkillEnabled(state, options.agentId, options.skillId, !options.isEnabled)
      throw error
    }

    return {
      state: nextState,
      skill: { ...skill, isEnabled: options.isEnabled }
    }
  }

  async uninstall(state: AgentStoreState, skillId: string): Promise<AgentStoreState> {
    const skill = state.skills.find((item) => item.id === skillId)
    if (!skill) throw new Error(`Skill not found: ${skillId}`)
    if (skill.source === 'builtin') throw new Error('Built-in skills cannot be uninstalled.')

    const enabledBindings = state.agentSkills.filter((binding) => binding.skillId === skillId && binding.isEnabled)
    for (const binding of enabledBindings) {
      for (const workspace of this.getAgentSessionWorkspaces(state, binding.agentId)) {
        await this.unlinkSkill(skill.folderName, workspace).catch(() => undefined)
      }
    }

    await this.installer.uninstall(this.getSkillDirectory(skill.folderName))
    return deleteInstalledSkill(state, skillId)
  }

  async readFile(state: AgentStoreState, skillId: string, filename: string): Promise<string | null> {
    const skill = this.getById(state, skillId)
    if (!skill) return null
    const root = resolve(this.getSkillDirectory(skill.folderName))
    const filePath = resolve(root, filename)
    if (!isPathInside(filePath, root)) return null

    try {
      const info = await stat(filePath)
      if (!info.isFile()) return null
      return await readFile(filePath, 'utf8')
    } catch {
      return null
    }
  }

  async listFiles(state: AgentStoreState, skillId: string): Promise<SkillFileNode[]> {
    const skill = this.getById(state, skillId)
    if (!skill) return []
    const root = this.getSkillDirectory(skill.folderName)
    try {
      return await buildFileTree(root, root)
    } catch {
      return []
    }
  }

  async listLocal(workdir: string): Promise<LocalSkill[]> {
    const skillsDir = join(workdir, '.claude', 'skills')
    const directories = await findAllSkillDirectories(skillsDir, skillsDir, 1)
    const localSkills: LocalSkill[] = []

    for (const directory of directories) {
      try {
        const metadata = await parseSkillMetadata(directory.folderPath)
        localSkills.push({
          name: metadata.name,
          description: metadata.description,
          filename: basename(directory.folderPath)
        })
      } catch {
        // Ignore malformed local skills.
      }
    }

    return localSkills
  }

  async reconcileAgentSkills(state: AgentStoreState, agentId: string, workspace: string): Promise<void> {
    const enabledSkillIds = new Set(
      state.agentSkills.filter((binding) => binding.agentId === agentId && binding.isEnabled).map((binding) => binding.skillId)
    )
    for (const skill of state.skills) {
      if (enabledSkillIds.has(skill.id)) await this.linkSkill(skill.folderName, workspace)
      else await this.unlinkSkill(skill.folderName, workspace)
    }
  }

  async reconcileWorkspaceSkills(state: AgentStoreState, workspace: string): Promise<void> {
    const activeAgentIds = new Set(
      state.sessions
        .filter((session) => session.workspace.path === workspace && session.agentId)
        .map((session) => session.agentId)
        .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0)
    )
    const enabledSkillIds = new Set(
      state.agentSkills
        .filter((binding) => binding.isEnabled && activeAgentIds.has(binding.agentId))
        .map((binding) => binding.skillId)
    )

    for (const skill of state.skills) {
      if (enabledSkillIds.has(skill.id)) await this.linkSkill(skill.folderName, workspace)
      else await this.unlinkSkill(skill.folderName, workspace)
    }
  }

  async linkSkill(folderName: string, workspace: string): Promise<void> {
    const target = this.getSkillDirectory(folderName)
    const linkPath = join(workspace, '.claude', 'skills', folderName)
    await mkdir(dirname(linkPath), { recursive: true })

    try {
      const info = await lstat(linkPath)
      if (!info.isSymbolicLink()) {
        throw new Error(`Cannot link skill "${folderName}": ${linkPath} already exists and is not a symlink.`)
      }
      await unlink(linkPath)
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }

    await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  }

  async unlinkSkill(folderName: string, workspace: string): Promise<void> {
    const linkPath = join(workspace, '.claude', 'skills', folderName)
    try {
      await unlink(linkPath)
    } catch (error) {
      if (!isMissingFileError(error)) throw error
    }
  }

  private async installSkillDir(
    state: AgentStoreState,
    skillDir: string,
    source: string,
    sourceUrl: string | null
  ): Promise<SkillMutationResult<InstalledSkill>> {
    const metadata = await parseSkillMetadata(skillDir)
    const folderName = sanitizeFolderName(metadata.folderName)
    const existing = state.skills.find((skill) => skill.folderName === folderName)
    const destPath = this.getSkillDirectory(folderName)

    await mkdir(this.options.paths.skillsRoot, { recursive: true })
    await mkdir(this.options.paths.installTempRoot, { recursive: true })
    await this.installer.install(skillDir, destPath)

    const timestamp = this.now()
    const skill: InstalledSkill = {
      id: existing?.id ?? createId('skill'),
      name: metadata.name,
      description: metadata.description ?? null,
      folderName,
      source,
      sourceUrl,
      namespace: null,
      author: metadata.author ?? null,
      sourceTags: metadata.tags,
      contentHash: metadata.contentHash,
      isEnabled: true,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    }

    return {
      state: upsertInstalledSkill(state, skill),
      skill
    }
  }

  private async installFromClaudePlugins(state: AgentStoreState, identifier: string): Promise<SkillMutationResult<InstalledSkill>> {
    const parts = identifier.split('/').filter(Boolean)
    if (parts.length < 3) throw new Error(`Invalid claude-plugins identifier: ${identifier}`)

    const [owner, repo, ...directoryParts] = parts
    const directoryPath = directoryParts.join('/')
    const repoUrl = `https://github.com/${owner}/${repo}`
    const tempDir = await this.createTempDir('claude-plugins')

    try {
      await this.fetchRepository(repoUrl, tempDir)
      const skillDir = await resolveSkillDirectory(tempDir, parts.at(-1) ?? null, directoryPath)
      return await this.installSkillDir(state, skillDir, 'marketplace', `${repoUrl}/tree/main/${directoryPath}`)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  private async installFromSkillsSh(state: AgentStoreState, identifier: string): Promise<SkillMutationResult<InstalledSkill>> {
    const parts = identifier.split('/').filter(Boolean)
    if (parts.length < 2) throw new Error(`Invalid skills.sh identifier: ${identifier}`)

    const [owner, repo, ...skillNameParts] = parts
    const repoUrl = `https://github.com/${owner}/${repo}`
    const tempDir = await this.createTempDir('skills-sh')

    try {
      await this.fetchRepository(repoUrl, tempDir)
      const skillDir = await resolveSkillDirectory(tempDir, skillNameParts.length > 0 ? skillNameParts.join('/') : null, null)
      return await this.installSkillDir(state, skillDir, 'marketplace', repoUrl)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  private async installFromClawhub(state: AgentStoreState, slug: string): Promise<SkillMutationResult<InstalledSkill>> {
    if (!slug.trim()) throw new Error('Invalid clawhub identifier')

    const detailUrl = `https://api.clawhub.ai/api/v1/skills/${slug}`
    const detailResp = await this.fetchHttp(detailUrl, { headers: { 'User-Agent': 'MacroBay' } })
    if (!detailResp.ok) throw new Error(`clawhub detail failed: HTTP ${detailResp.status}`)

    const downloadUrl = `https://api.clawhub.ai/api/v1/skills/${slug}/download`
    const downloadResp = await this.fetchHttp(downloadUrl, { headers: { 'User-Agent': 'MacroBay' } })
    if (!downloadResp.ok) throw new Error(`clawhub download failed: HTTP ${downloadResp.status}`)

    const tempDir = await this.createTempDir('clawhub')
    const zipFilePath = join(tempDir, 'skill.zip')
    const extractDir = join(tempDir, 'extracted')

    try {
      await mkdir(extractDir, { recursive: true })
      await writeFileFromArrayBuffer(zipFilePath, await downloadResp.arrayBuffer())
      await this.assertZipWithinLimits(zipFilePath)
      await this.extractZipArchive(zipFilePath, extractDir)
      const skillDir = await resolveSkillDirectory(extractDir, null, null)
      return await this.installSkillDir(state, skillDir, 'marketplace', `https://clawhub.ai/skills/${slug}`)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  private async createTempDir(prefix: string): Promise<string> {
    const tempDir = join(this.options.paths.installTempRoot, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(tempDir, { recursive: true })
    return tempDir
  }

  private getAgentSessionWorkspaces(state: AgentStoreState, agentId: string): string[] {
    return Array.from(
      new Set(
        state.sessions
          .filter((session) => session.agentId === agentId)
          .map((session) => session.workspace.path)
          .filter(Boolean)
      )
    )
  }

  private async validateZipFile(zipFilePath: string): Promise<void> {
    const info = await stat(zipFilePath)
    if (!info.isFile()) throw new Error(`Not a file: ${zipFilePath}`)
    if (!zipFilePath.toLowerCase().endsWith('.zip')) throw new Error(`Not a ZIP file: ${zipFilePath}`)
  }

  private async assertZipWithinLimits(zipFilePath: string): Promise<void> {
    const inspection = await this.inspectZipArchive(zipFilePath)
    if (inspection.totalSize > maxExtractedZipSizeBytes) {
      throw new Error(`ZIP too large: ${inspection.totalSize} bytes exceeds ${maxExtractedZipSizeBytes}`)
    }
    if (inspection.fileCount > maxZipFileCount) {
      throw new Error(`ZIP has too many files: ${inspection.fileCount} exceeds ${maxZipFileCount}`)
    }
  }
}

export function createSkillService(options: SkillServiceOptions): SkillService {
  return new SkillService(options)
}

async function buildFileTree(dir: string, root: string): Promise<SkillFileNode[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nodes: SkillFileNode[] = []

  for (const entry of [...entries].filter((item) => !item.name.startsWith('.') && item.name !== 'node_modules').sort(sortEntries)) {
    const fullPath = join(dir, entry.name)
    const path = relative(root, fullPath)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path, type: 'directory', children: await buildFileTree(fullPath, root) })
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path, type: 'file' })
    }
  }

  return nodes
}

function sortEntries(a: { isDirectory: () => boolean; name: string }, b: { isDirectory: () => boolean; name: string }): number {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
  return a.name.localeCompare(b.name)
}

function sanitizeFolderName(folderName: string): string {
  return folderName
    .replace(/[/\\]/g, '_')
    .replace(new RegExp(String.fromCharCode(0), 'g'), '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, maxFolderNameLength)
}

function isPathInside(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

async function resolveSkillDirectory(repoDir: string, skillName: string | null, directoryPath: string | null): Promise<string> {
  if (directoryPath) {
    const resolved = resolve(repoDir, directoryPath)
    if (await hasSkillEntryFile(resolved)) return resolved
  }

  const candidates = await findAllSkillDirectories(repoDir, repoDir, 8)

  if (skillName) {
    const normalizedName = basename(skillName).toLowerCase()
    const exact = candidates.find((candidate) => basename(candidate.folderPath).toLowerCase() === normalizedName)
    if (exact) return exact.folderPath

    const fuzzy = candidates.find((candidate) => {
      const base = basename(candidate.folderPath).toLowerCase()
      return base.includes(normalizedName) || normalizedName.includes(base)
    })
    if (fuzzy) return fuzzy.folderPath
  }

  if (candidates.length > 0) return candidates[0].folderPath
  if (await hasSkillEntryFile(repoDir)) return repoDir

  throw new Error(`No skill directory found in ${repoDir}`)
}

async function hasSkillEntryFile(dirPath: string): Promise<boolean> {
  try {
    await parseSkillMetadata(dirPath)
    return true
  } catch {
    return false
  }
}

async function cloneRepository(repoUrl: string, destDir: string): Promise<void> {
  await execFileAsync('git', ['clone', '--depth', '1', '--', repoUrl, destDir])
}

async function extractZipWithUnzip(zipFilePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true })
  await execFileAsync('unzip', ['-q', zipFilePath, '-d', destDir])
}

async function inspectZipWithUnzip(zipFilePath: string): Promise<SkillZipInspection> {
  const { stdout } = await execFileAsync('unzip', ['-Z', '-l', zipFilePath])
  const lines = stdout.split('\n').map((line) => line.trim())
  let summaryLine: string | undefined
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/\bfiles?,\s+\d+\s+bytes\s+uncompressed/.test(lines[index])) {
      summaryLine = lines[index]
      break
    }
  }
  if (!summaryLine) throw new Error(`Unable to inspect ZIP file: ${zipFilePath}`)

  const match = summaryLine.match(/(\d+)\s+files?,\s+(\d+)\s+bytes\s+uncompressed/)
  if (!match) throw new Error(`Unable to inspect ZIP summary: ${summaryLine}`)

  return {
    fileCount: Number(match[1]),
    totalSize: Number(match[2])
  }
}

async function fetchHttp(url: string, init?: { headers?: Record<string, string> }): Promise<SkillHttpResponse> {
  return fetch(url, init)
}

async function writeFileFromArrayBuffer(filePath: string, arrayBuffer: ArrayBuffer): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, Buffer.from(arrayBuffer))
}
