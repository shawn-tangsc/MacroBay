/**
 * 更新检查的地址唯一出处。
 *
 * 这个文件存在，只为一件事：**发布地址在仓库里只写一遍**。渲染层不持有地址，IPC 载荷里不带地址，
 * 主进程从这里的常量拼出要打开的页面——远端返回的内容（元数据里的 `files[].url`）永远不能决定
 * 我们打开哪个地址，否则「打开下载页」就变成了「打开远端指定的任意地址」。
 *
 * 地址长这样（同名文件覆盖，不需要知道 tag）：
 * - macOS：`releases/latest/download/latest-mac.yml`
 * - Windows：`releases/latest/download/latest.yml`
 *
 * 为什么读静态元数据而不是发布接口：不受接口限流约束，且元数据本来就是发布流水线产出的
 * （`release.yml` 里 electron-builder 生成 `latest-mac.yml` / `latest.yml` 并挂到 Release 上）。
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

/** 读者点「打开下载页」去的页面；由本文件的常量拼出，不接受任何入参覆盖。 */
export function updateDownloadPageUrl(): string {
  return `${releaseSiteBase}/releases/latest`
}

/**
 * 交给系统打开之前只放行这些域名（协议必须是 https）。
 * 目前只有发布页所在的那个域名；将来地址换了，改这里，不要在各个调用点各写一份。
 */
export const updateDownloadAllowedHosts = ['github.com'] as const
