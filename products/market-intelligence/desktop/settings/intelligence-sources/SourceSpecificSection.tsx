export function SourceSpecificSection(props: {
  fields: string[]
  labels: { title: string; empty: string }
}): React.ReactElement {
  return (
    <section className="intelligence-section">
      <div className="intelligence-section-title">{props.labels.title}</div>
      <p className="intelligence-source-note">
        {props.fields.length > 0 ? props.fields.join(', ') : props.labels.empty}
      </p>
    </section>
  )
}
