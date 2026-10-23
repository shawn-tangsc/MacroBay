import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Bot,
  ChartCandlestick,
  Database,
  FileText,
  Home,
  KeyRound,
  Languages,
  MessageSquareText,
  ScrollText,
  Settings,
  Shield
} from 'lucide-react'

import type { ShellIconId } from '@platform/product-registry/shellIconIds'

const shellIconComponents: Record<ShellIconId, LucideIcon> = {
  activity: Activity,
  bot: Bot,
  'chart-candlestick': ChartCandlestick,
  database: Database,
  'file-text': FileText,
  home: Home,
  'key-round': KeyRound,
  languages: Languages,
  'message-square-text': MessageSquareText,
  'scroll-text': ScrollText,
  settings: Settings,
  shield: Shield
}

export function resolveShellIcon(iconId: string): LucideIcon {
  return shellIconComponents[iconId as ShellIconId] ?? Activity
}

export function resolveLocalizedTitle(title: { 'zh-CN': string; 'en-US': string }, language: AppLanguage): string {
  return title[language]
}
