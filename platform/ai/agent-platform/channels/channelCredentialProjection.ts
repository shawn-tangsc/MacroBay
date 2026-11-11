/**
 * 把凭据的头尾掩码贴到只读投影上（列表行与编辑弹层显示「改成功了没有」）。
 *
 * 为什么单独一个模块：解密是异步的，而 `list()` / `get()` 是同步、被推送端口等无凭据场景共用；
 * 把解密塞进主查询会逼所有调用方变异步。这里只做「补一列显示串」，谁需要谁 await。
 *
 * 边界（Chief 2026-11-04 定）：解密 → 头 4 + `…` + 尾 3；长度 < 8 一律 `********`；
 * 完整值不出这个函数；日志/审计/错误提示不许出现这个串。
 */
import type { ChannelManagementRepository } from './ChannelManagementRepository'
import type { ChannelManagementSafeView } from './ChannelManagementContracts'
import { credentialFieldsFor, readCredentialPreviews } from './channelCredentialPreview'

export type CredentialPreviewVault = { get: (ref: string) => Promise<Record<string, string> | null> }

/** 短串兜底：露头尾等于露全文，不如只给固定掩码。 */
const FULL_MASK = '********'

async function withPreviews(
  repository: ChannelManagementRepository,
  vault: CredentialPreviewVault,
  view: ChannelManagementSafeView
): Promise<ChannelManagementSafeView> {
  if (!view.credential.hasCredential) return view
  const metadata = repository.credentialMetadata(view.id)
  if (!metadata) return view
  let previews: Record<string, string> = {}
  try {
    previews = await readCredentialPreviews(vault, { type: view.type, ref: metadata.ref })
  } catch {
    // Vault 不可用时保留静态掩码：显示「已配置」即可，不能因此让列表读失败。
    return view
  }
  // 每个描述符字段都要有一格：有值给掩码，**没有值给空串**（界面据此说「未填」）。
  // 只回「已配的那些」会让少配一个字段的行看起来是齐的——那正是这次用户看到的第二个 token 不见了。
  const maskedFields: Record<string, string> = {}
  for (const field of credentialFieldsFor(view.type)) {
    const value = previews[field]
    maskedFields[field] = value === undefined ? '' : (value.length < 8 ? FULL_MASK : value)
  }
  if (Object.keys(maskedFields).length === 0) return view
  return { ...view, credential: { ...view.credential, maskedFields: { ...view.credential.maskedFields, ...maskedFields } } }
}

export async function listWithCredentialPreviews(
  repository: ChannelManagementRepository,
  vault: CredentialPreviewVault,
  views: readonly ChannelManagementSafeView[]
): Promise<readonly ChannelManagementSafeView[]> {
  return Promise.all(views.map((view) => withPreviews(repository, vault, view)))
}

export async function getWithCredentialPreviews(
  repository: ChannelManagementRepository,
  vault: CredentialPreviewVault,
  view: ChannelManagementSafeView | null
): Promise<ChannelManagementSafeView | null> {
  return view === null ? null : withPreviews(repository, vault, view)
}
