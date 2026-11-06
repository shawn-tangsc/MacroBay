import { useState, type ReactElement } from 'react'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'

import './SignalDetail.css'

/** One "label: value" line. The value arrives already formatted by the owning module. */
export type SignalDetailRow = Readonly<{ labelKey: string; value: string }>

/** A named block of rows: the divergence chip shows one group per leg. */
export type SignalDetailGroup = Readonly<{ labelKey: string; rows: readonly SignalDetailRow[] }>

/**
 * The one expandable reading block behind every module chip.
 *
 * Four chips open five or six "label: value" lines, and the rule that opens them is the same in all
 * four: the trigger carries the expanded state and names the region, the region is named by its
 * title, and the same control closes it again. Written once here so no card can forget one of the
 * three; the trigger itself stays with its module, because the four chips differ in copy, state and
 * meaning.
 *
 * The component formats nothing: each module's projection hands in finished strings, because the
 * same reading must look identical wherever it appears.
 */
export function useSignalDetail(id: string): Readonly<{
  open: boolean
  toggle: () => void
  triggerProps: Readonly<{ 'aria-expanded': boolean; 'aria-controls': string }>
}> {
  const [open, setOpen] = useState(false)
  return {
    open,
    toggle: () => setOpen(value => !value),
    triggerProps: { 'aria-expanded': open, 'aria-controls': id }
  }
}

export function SignalDetail({ id, titleKey, rows, groups, noteKey }: Readonly<{
  id: string
  titleKey: string
  /** Flat rows, for a chip whose readings are one list. */
  rows?: readonly SignalDetailRow[]
  /** Grouped rows, for a chip whose readings are one list per leg. */
  groups?: readonly SignalDetailGroup[]
  /** An optional closing sentence, e.g. that the reading is inferred rather than observed. */
  noteKey?: string
}>): ReactElement {
  const resolveText = useProductTextKey()
  return (
    <div className="mi-signal-detail" id={id} role="region" aria-label={resolveText(titleKey)}>
      {groups?.map(group => (
        <section className="mi-signal-detail__group" key={group.labelKey}>
          <h3 className="mi-signal-detail__group-title">{resolveText(group.labelKey)}</h3>
          <dl className="mi-signal-detail__rows">
            {group.rows.map(row => (
              <div key={row.labelKey}><dt>{resolveText(row.labelKey)}</dt><dd>{row.value}</dd></div>
            ))}
          </dl>
        </section>
      ))}
      {rows && rows.length > 0 ? (
        <dl className="mi-signal-detail__rows">
          {rows.map(row => (
            <div key={row.labelKey}><dt>{resolveText(row.labelKey)}</dt><dd>{row.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {noteKey ? <p className="mi-signal-detail__note">{resolveText(noteKey)}</p> : null}
    </div>
  )
}
