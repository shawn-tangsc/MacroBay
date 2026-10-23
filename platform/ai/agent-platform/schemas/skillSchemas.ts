export type InstalledSkill = {
  id: string
  name: string
  description: string | null
  folderName: string
  source: string
  sourceUrl: string | null
  namespace: string | null
  author: string | null
  sourceTags: string[]
  contentHash: string
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type ListSkillsQuery = {
  agentId?: string
  search?: string
}

export type SkillInstallSource = 'builtin' | 'local' | 'zip' | 'marketplace' | string

export type SkillMetadata = {
  name: string
  description?: string
  folderName: string
  author?: string
  tags: string[]
  tools: string[]
  contentHash: string
  skillFilePath: string
}

export type SkillInstallOptions = {
  installSource: string
}

export type SkillInstallFromZipOptions = {
  zipFilePath: string
}

export type SkillInstallFromDirectoryOptions = {
  directoryPath: string
  source?: SkillInstallSource
  sourceUrl?: string | null
}

export type SkillToggleOptions = {
  agentId: string
  skillId: string
  isEnabled: boolean
}

export type SkillFileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: SkillFileNode[]
}

export type LocalSkill = {
  name: string
  description?: string
  filename: string
}

export type SkillSearchSource = 'claude-plugins.dev' | 'skills.sh' | 'clawhub.ai'

export type SkillSearchResult = {
  slug: string
  name: string
  description: string | null
  author: string | null
  stars: number
  downloads: number
  sourceRegistry: SkillSearchSource
  sourceUrl: string | null
  installSource: string
}
