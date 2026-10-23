declare module 'grammy' {
  export class Bot<TContext = unknown> {
    constructor(token: string)
    use(handler: (ctx: TContext, next: () => Promise<void>) => Promise<void> | void): void
    command(command: string, handler: (ctx: TContext) => Promise<void> | void): void
    on(event: string, handler: (ctx: TContext) => Promise<void> | void): void
    catch(handler: (error: unknown) => void): void
    start(): Promise<void>
    stop(): Promise<void>
    api: {
      setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void>
      sendMessage(
        chatId: string | number,
        text: string,
        options?: Record<string, unknown>
      ): Promise<{ message_id?: number }>
      editMessageText(
        chatId: string | number,
        messageId: number,
        text: string,
        options?: Record<string, unknown>
      ): Promise<unknown>
      sendMessageDraft?(chatId: number, draftId: number, text: string): Promise<unknown>
      sendChatAction(chatId: string | number, action: string): Promise<void>
      getFile(fileId: string): Promise<{ file_path?: string }>
    }
  }
}

declare module 'telegram-markdown-v2' {
  export function convert(text: string): string
}
