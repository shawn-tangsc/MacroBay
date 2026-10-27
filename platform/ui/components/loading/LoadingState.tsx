import './loadingState.css'

/** Ring sizes. `sm` sits inside a control, `md` is the region default, `lg` covers a whole page slot. */
export type LoadingSize = 'sm' | 'md' | 'lg'

export type LoadingSpinnerProps = {
  size?: LoadingSize
  className?: string
}

/**
 * The only spinner in the app.
 *
 * It is decorative: the wait is named by the `LoadingState` copy, by the surrounding control's
 * label, or by the region's own heading — so the ring itself stays out of the accessibility tree.
 */
export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={['loading-spinner', `loading-spinner--${size}`, className].filter(Boolean).join(' ')}
    />
  )
}

type LoadingCopy = { label: string; ariaLabel?: string } | { label?: undefined; ariaLabel: string }

export type LoadingStateProps = LoadingCopy & {
  size?: LoadingSize
  /** `inline` puts the ring beside the copy, for a status bar or a list row. */
  layout?: 'block' | 'inline'
  /** Fill the parent region (one that already owns height) instead of a fixed minimum. */
  fill?: boolean
  /** Minimum block height in pixels. Defaults to the stylesheet's 96px; ignored when `fill` is set. */
  minHeight?: number
  className?: string
}

/**
 * The standard "this region is waiting" surface: a centered spinning ring, with the wait's copy
 * underneath it. Region, drawer-body, panel and card waits all render this — never a lone
 * `<p>loading…</p>`, and never an empty box.
 *
 * A visible `label` is the normal case. When the region already names the wait elsewhere, pass
 * `ariaLabel` alone: the ring still gets an accessible name, it just renders no second sentence.
 */
export function LoadingState({
  label,
  ariaLabel,
  size = 'md',
  layout = 'block',
  fill = false,
  minHeight,
  className
}: LoadingStateProps): React.ReactElement {
  const Root = layout === 'inline' ? 'span' : 'div'
  const classes = ['loading-state', `loading-state--${layout}`, fill ? 'loading-state--fill' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <Root
      className={classes}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label ? undefined : ariaLabel}
      data-loading-state=""
      data-loading-size={size}
      style={fill || minHeight === undefined ? undefined : { minHeight }}>
      <LoadingSpinner size={size} />
      {label ? <span className="loading-state__label">{label}</span> : null}
    </Root>
  )
}
