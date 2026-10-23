export type TaskPromptTemplateContext = {
  now: string | Date
  timezone: string
  taskName: string
}

export function renderTaskPromptTemplate(template: string, context: TaskPromptTemplateContext): string {
  const date = context.now instanceof Date ? context.now : new Date(context.now)
  const values = formatTaskDateTime(date, context.timezone)
  const tokens: Record<string, string> = {
    date: values.date,
    time: values.time,
    datetime: `${values.date} ${values.time}`,
    timezone: context.timezone,
    task_name: context.taskName
  }
  const escapedOpen = '\u0000task-open-brace\u0000'
  const escapedClose = '\u0000task-close-brace\u0000'

  return template
    .replaceAll('{{', escapedOpen)
    .replaceAll('}}', escapedClose)
    .replace(/\{([a-z_]+)\}/g, (match, name: string) => tokens[name] ?? match)
    .replaceAll(escapedOpen, '{')
    .replaceAll(escapedClose, '}')
}

function formatTaskDateTime(date: Date, timezone: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  }
}
