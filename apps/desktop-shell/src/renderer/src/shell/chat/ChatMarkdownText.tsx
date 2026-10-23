/**
 * The markdown renderer now lives in the platform so a product chat can use it without importing
 * from the shell. This re-export keeps the shell's own imports and tests on their existing path.
 */
export { default, parseMarkdownBlocks } from '@platform/ui/markdown/ChatMarkdownText'
