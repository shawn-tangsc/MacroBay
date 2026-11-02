/**
 * 更新提示与关于页的地址唯一出处。
 *
 * 两条规矩，写在这里而不是散在各调用点：
 *
 * 1. **地址只在本文件拼一次**，界面永远拿不到网址——IPC 只传一个封闭的 id；
 * 2. **两层校验缺一不可**：
 *    - 第 1 层「主机精确 + 仓库路径段」挡**越权**：`/MacroBay-evil`、`/MacroBayX`、别人的 owner 全拒；
 *    - 第 2 层「id 与地址严格相等」挡**同仓库任意页面**：每个 id 只能打开它自己那条常量。
 *
 * 只有第 1 层，`/MacroBay` 下任何页面都能开；只有第 2 层，常量写错成别人的仓库也会放行。
 */

export const UPDATE_REPOSITORY = {
  owner: 'shawn-tangsc',
  name: 'MacroBay'
} as const

/**
 * 两个平台的元数据文件名。**这是本功能唯一按系统分叉的地方**：其余（版本号、日计数、代理、
 * 节流、界面）都与平台无关。没有对应产物的平台（例如 Linux）返回 `null`，调用方据此判定
 * 「这台机器没有更新通道」，不是「查不到」。
 */
const metadataFileNames = {
  darwin: 'latest-mac.yml',
  win32: 'latest.yml'
} as const

export type UpdateMetadataPlatform = keyof typeof metadataFileNames

/** 主机的精确值。按域名放行等于允许打开该站任意页面，所以这里比对的是完整 host。 */
export const updateLinkHost = 'github.com'

const releaseSiteBase = `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}`

function isUpdateMetadataPlatform(platform: string): platform is UpdateMetadataPlatform {
  return platform === 'darwin' || platform === 'win32'
}

export function updateMetadataFileName(platform: string): string | null {
  return isUpdateMetadataPlatform(platform) ? metadataFileNames[platform] : null
}

export function updateMetadataUrl(platform: string): string | null {
  const fileName = updateMetadataFileName(platform)
  return fileName === null ? null : `${releaseSiteBase}/releases/latest/download/${fileName}`
}

/**
 * 关于页与更新块能打开的五个去处。**id 就是按钮的名字**（`changelog` 对应「更新日志」），
 * 载荷类型就是这五个字面量的联合——渲染层没有位置放地址。
 */
export const updateLinkIds = ['download', 'changelog', 'docs', 'site', 'feedback'] as const

export type UpdateLinkId = (typeof updateLinkIds)[number]

const updateLinkPaths: Readonly<Record<UpdateLinkId, string>> = {
  // 最新那一版的发布页：看说明 + 拿安装包
  download: '/releases/latest',
  // 发布列表：逐版看改了什么。与 download 是**两个目的地**，所以不重复。
  changelog: '/releases',
  docs: '/tree/main/docs',
  site: '',
  feedback: '/issues/new/choose'
}

export function isUpdateLinkId(value: unknown): value is UpdateLinkId {
  return typeof value === 'string' && (updateLinkIds as readonly string[]).includes(value)
}

/** 由 id 拼出地址；这是全仓唯一一处把 id 变成网址的地方。 */
export function updateLinkUrl(id: UpdateLinkId): string {
  return `${releaseSiteBase}${updateLinkPaths[id]}`
}

function pathSegments(pathname: string): string[] {
  return pathname.split('/').filter((segment) => segment.length > 0)
}

/**
 * 两层校验。第 1 层看主机与仓库段，第 2 层看 id 与地址是否严格相等。
 *
 * 段比较**不用字符串 `startsWith`**：`/MacroBay-evil`、`/MacroBayX` 都会被它放过去。
 * 含百分号的段一律拒——解码后再比会多出一层「看起来是同名路径」的空间。
 */
export function isAllowedUpdateLinkUrl(id: UpdateLinkId, url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  if (parsed.host !== updateLinkHost) return false

  // 第 1 层：仓库路径段（大小写不敏感；GitHub 的 owner/repo 是同一个仓库）。
  const segments = pathSegments(parsed.pathname)
  if (segments.some((segment) => segment.includes('%'))) return false
  if (segments.length < 2) return false
  if (segments[0].toLowerCase() !== UPDATE_REPOSITORY.owner.toLowerCase()) return false
  if (segments[1].toLowerCase() !== UPDATE_REPOSITORY.name.toLowerCase()) return false

  // 第 2 层：id 与地址严格相等（允许一个结尾斜杠）。
  const normalizedPath = `/${segments.join('/')}`
  const expectedPath = `/${pathSegments(updateLinkPaths[id]).join('/')}`
  const normalizedExpected = expectedPath === '/' ? `/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}` : `/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}${expectedPath}`
  return normalizedPath === normalizedExpected
}
