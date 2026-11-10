#!/usr/bin/env tsx
/**
 * 提示条基线的**唯一写入口**：`--remove '<文件> :: <键>'` / `--lower '<文件> :: <键>'`，一次一条，原子写。
 *
 * 为什么禁止手改 JSON：手改会把「别人未提交的删除」当成自己的改动一起带走——2026-11-10 两次事故
 * （一次基线条目、一次 CSS hunk）都是「共享文件 + 几个人同时改」。基线按 owner 拆成
 * `scripts/inline-notice-baseline/<owner>.json`，本脚本**只改条目所在的那一份**。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'scripts/inline-notice-baseline')

type Entry = { count: number; owner: string; shared: string; kind: 'debt' | 'by-design'; why: string; clearWhen: string }
type File = { owner: string; entries: Record<string, Entry> }

function loadFiles(): Array<{ path: string; data: File }> {
  return readdirSync(DIR).filter((n) => n.endsWith('.json')).map((name) => ({
    path: join(DIR, name),
    data: JSON.parse(readFileSync(join(DIR, name), 'utf8')) as File
  }))
}

const [, , mode, target] = process.argv
if (mode !== '--remove' && mode !== '--lower') {
  console.log("用法：tsx scripts/inline-notice-baseline.mts --remove|--lower '<文件> :: <键>'")
  process.exit(1)
}
const ownerFile = loadFiles().find((file) => file.data.entries[target ?? ''] !== undefined)
if (ownerFile === undefined) {
  console.log(`没找到这一条：${target ?? '（没给）'}`)
  process.exit(1)
}
const before = ownerFile.data.entries[target!]!.count
if (mode === '--remove') delete ownerFile.data.entries[target!]
else ownerFile.data.entries[target!] = { ...ownerFile.data.entries[target!]!, count: Math.max(0, before - 1) }
writeFileSync(ownerFile.path, `${JSON.stringify(ownerFile.data, null, 2)}\n`)
console.log(`${mode === '--remove' ? '已删' : '已降'}：${target}（基线 ${before} → 现在 ${mode === '--remove' ? 0 : before - 1}）`)
