import type { CSSProperties, ReactElement } from 'react'

import type { VisualIdentity } from '@platform/ui/icons/modelProviderVisuals'

import { getModelIconUrl, getProviderIconUrl } from './visualIconAssets'

type VisualIdentityAvatarProps = {
  visual: VisualIdentity
  size?: number
  className?: string
}

export function VisualIdentityAvatar({ visual, size = 28, className }: VisualIdentityAvatarProps): ReactElement {
  const iconUrl =
    visual.iconSet === 'model' ? getModelIconUrl(visual.iconKey) : visual.iconSet === 'provider' ? getProviderIconUrl(visual.iconKey) : undefined
  const style: CSSProperties = {
    '--avatar-size': `${size}px`,
    '--avatar-bg': visual.tone.background,
    '--avatar-fg': visual.tone.foreground,
    '--avatar-border': visual.tone.border ?? 'transparent'
  } as CSSProperties
  const classes = ['visual-avatar', iconUrl ? 'has-icon' : null, className].filter(Boolean).join(' ')

  return (
    <span className={classes} style={style} aria-hidden="true">
      {iconUrl ? <img src={iconUrl} alt="" draggable={false} /> : visual.shortLabel}
    </span>
  )
}
