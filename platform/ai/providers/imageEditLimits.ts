/**
 * 图像编辑的纯契约常量（主进程与渲染层共用；无 node / electron 依赖）。
 * 主进程用它做最终校验，渲染层用它提前给出人话提示 —— 两边必须同一个数值。
 */
export const MAX_SOURCE_IMAGE_BYTES = 4 * 1024 * 1024

export const imageEditSourceMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ImageEditSourceMime = (typeof imageEditSourceMimeTypes)[number]

export function normalizeImageEditSourceMime(mime: string): ImageEditSourceMime | null {
  const normalized = mime.trim().toLowerCase()
  if (normalized === 'image/jpg' || normalized === 'image/pjpeg') return 'image/jpeg'
  return (imageEditSourceMimeTypes as readonly string[]).includes(normalized)
    ? (normalized as ImageEditSourceMime)
    : null
}
