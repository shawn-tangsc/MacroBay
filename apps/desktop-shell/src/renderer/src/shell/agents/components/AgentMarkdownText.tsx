import ChatMarkdownText, { parseMarkdownBlocks } from '../../chat/ChatMarkdownText'

type AgentMarkdownTextProps = {
  text: string
}

export default function AgentMarkdownText({ text }: AgentMarkdownTextProps): React.ReactElement | null {
  return <ChatMarkdownText text={text} className="agent-markdown" codeClassName="agent-markdown-code" />
}

export { parseMarkdownBlocks }
