import type { SkillFileNode } from '@platform/ai/agent-platform/schemas/skillSchemas'

const markdownExtensions = new Set(['.md', '.mdx', '.markdown'])
const languageByExtension: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  css: 'css',
  html: 'html',
  xml: 'xml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  rb: 'ruby',
  txt: 'text'
}

export type FlatSkillFileNode = Pick<SkillFileNode, 'name' | 'path' | 'type'> & {
  depth: number
}

export function findFirstSkillPreviewFile(nodes: readonly SkillFileNode[]): string | null {
  return (
    findFirstFile(nodes, (node) => node.name.toLowerCase() === 'skill.md') ??
    findFirstFile(nodes, (node) => isSkillMarkdownFile(node.name)) ??
    findFirstFile(nodes, () => true)
  )
}

export function flattenSkillFileTree(nodes: readonly SkillFileNode[], depth = 0): FlatSkillFileNode[] {
  return nodes.flatMap((node) => [
    { name: node.name, path: node.path, type: node.type, depth },
    ...(node.children ? flattenSkillFileTree(node.children, depth + 1) : [])
  ])
}

export function isSkillMarkdownFile(filename: string): boolean {
  const dotIndex = filename.lastIndexOf('.')
  const extension = dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : ''
  return markdownExtensions.has(extension)
}

export function guessSkillFileLanguage(filename: string): string {
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  return languageByExtension[extension] ?? 'text'
}

function findFirstFile(nodes: readonly SkillFileNode[], predicate: (node: SkillFileNode) => boolean): string | null {
  for (const node of nodes) {
    if (node.type === 'file' && predicate(node)) return node.path
    if (node.children) {
      const child = findFirstFile(node.children, predicate)
      if (child) return child
    }
  }
  return null
}
