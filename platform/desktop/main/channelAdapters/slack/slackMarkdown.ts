/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Key differences:
 * - Bold:          **text**  ->  *text*
 * - Italic:        *text*   ->  _text_
 * - Strikethrough: ~~text~~ ->  ~text~
 * - Links:         [text](url) -> <url|text>
 * - Headers:       # text   ->  *text*  (bold as substitute)
 *
 * Code blocks and inline code are preserved as-is since Slack
 * uses the same backtick syntax.
 */

type Segment = { type: 'code'; text: string } | { type: 'text'; text: string }

function splitCodeSegments(input: string): Segment[] {
  const segments: Segment[] = []
  const codePattern = /(```[\s\S]*?```|`[^`\n]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codePattern.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: input.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'code', text: match[0] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < input.length) {
    segments.push({ type: 'text', text: input.slice(lastIndex) })
  }

  return segments
}

function convertTextSegment(text: string): string {
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')

  const boldSpans: string[] = []
  text = text.replace(/\*\*(.+?)\*\*/g, (_, content: string) => {
    const idx = boldSpans.length
    boldSpans.push(content)
    return `%%BOLD_${idx}%%`
  })

  text = text.replace(/\*(.+?)\*/g, '_$1_')
  text = text.replace(/%%BOLD_(\d+)%%/g, (_, idx: string) => `*${boldSpans[Number(idx)]}*`)
  text = text.replace(/~~(.+?)~~/g, '~$1~')
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')

  return text
}

export function toSlackMarkdown(markdown: string): string {
  if (!markdown) return markdown
  const segments = splitCodeSegments(markdown)
  return segments.map((segment) => (segment.type === 'code' ? segment.text : convertTextSegment(segment.text))).join('')
}
