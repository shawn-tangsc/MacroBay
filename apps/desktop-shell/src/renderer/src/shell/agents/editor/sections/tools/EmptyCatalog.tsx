export function EmptyCatalog({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
}): React.ReactElement {
  return (
    <div className="agent-empty-catalog">
      {icon}
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}
