import { readFile } from 'node:fs/promises'

import { writeJsonFileAtomically } from '@platform/storage/jsonFileStorage'

/**
 * 「格级启用」的存储：一份**独立小文档**，不进源 profile（那是源自己的采集开关），也不新建表。
 *
 * 文档形状：`{ version: number, cells: Record<string, boolean>, selections: Record<string, string> }`。
 * `cells` 与 `selections` 是**同一份文档里的两个字段**：前者记「这一格开不开」，后者记「这一格选了哪个源」。
 * 老文档没有 `selections` 也照读（缺键 = 未选）。
 *
 * 三条语义（与产品口径一致，别在这里加解释）：
 * - **缺键 = 启用**：`readCellEnabled()` 只回**显式写过**的键；缺的键由调用方按「启用」解释。
 *   本存储不补默认值、不写回缺省——那会把「没设置过」写成「读者设过」。
 * - **cellId 是不透明字符串**（如 `quotes:ndx`）：本存储不认识、不校验白名单，原样作键。
 * - **按 id 合并写、未知的照留**：写一次只动那一个键；文档里读不懂的字段、其它 cellId
 *   （哪怕值不是布尔）原样保留。`version` 每次真正写入 +1，绝不回退。
 *
 * 读：文件不存在或解析不了 → `{}`（调用方看到的就是「全都启用」），**读不改写文件**。
 * 写：同值重复写直接返回，不产生新版本、不动文件；写盘走平台原子写（临时文件 + rename）。
 */

export type CellEnabledStore = Readonly<{
  /** 只返回显式写过的键；缺键由调用方当作「启用」。 */
  readCellEnabled: () => Promise<Record<string, boolean>>
  /** 写一个格子的启用状态；同值重复写不改文档。 */
  setCellEnabled: (cellId: string, enabled: boolean) => Promise<void>
  /** 只返回显式写过的选择；缺键 = 这一格没选过源（调用方按默认主源处理）。 */
  readCellSelection: () => Promise<Record<string, string>>
  /** 选一个源；`null` = 清掉这一格的选择（键从文档里删掉，不是写成空串）。 */
  setCellSelection: (cellId: string, sourceId: string | null) => Promise<void>
}>

type RawDocument = Record<string, unknown>

function isPlainObject(value: unknown): value is RawDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readRaw(filePath: string): Promise<RawDocument> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    // 没写过 / 读不懂都按「没有显式设置」处理；**不在这里回写**，读路径永远只读。
    return {}
  }
}

function explicitCells(raw: RawDocument): Record<string, boolean> {
  const cells = raw.cells
  if (!isPlainObject(cells)) return {}
  const result: Record<string, boolean> = {}
  for (const [cellId, value] of Object.entries(cells)) {
    // 只把布尔值交给调用方；其它形状是「读不懂」，留在文档里、不进读结果。
    if (typeof value === 'boolean') result[cellId] = value
  }
  return result
}

function explicitSelections(raw: RawDocument): Record<string, string> {
  const selections = raw.selections
  if (!isPlainObject(selections)) return {}
  const result: Record<string, string> = {}
  for (const [cellId, value] of Object.entries(selections)) {
    // 只把字符串交给调用方；非字符串是「读不懂」，留在文档里、不进读结果。
    if (typeof value === 'string') result[cellId] = value
  }
  return result
}

function currentVersion(raw: RawDocument): number {
  const current = raw.version
  return typeof current === 'number' && Number.isInteger(current) && current >= 0 ? current : 0
}

function nextVersion(raw: RawDocument): number {
  const current = raw.version
  return currentVersion(raw) + 1
}

export function createCellEnabledStore(filePath: string): CellEnabledStore {
  /** 串行化写入：同一次点击里的并发写不能互相覆盖（都是「读整份 → 改一格 → 写回」）。 */
  let queue: Promise<unknown> = Promise.resolve()

  const write = async (cellId: string, enabled: boolean): Promise<void> => {
    const raw = await readRaw(filePath)
    const cells = isPlainObject(raw.cells) ? { ...raw.cells } : {}
    const alreadySet = Object.prototype.hasOwnProperty.call(cells, cellId) && cells[cellId] === enabled
    // 同值重复写：不产生新版本、不动文件（读者连点两次不该让文档变两次）。
    if (alreadySet) return
    cells[cellId] = enabled
    await writeJsonFileAtomically(filePath, { ...raw, version: nextVersion(raw), cells })
  }

  const writeSelection = async (cellId: string, sourceId: string | null): Promise<void> => {
    const raw = await readRaw(filePath)
    const selections = isPlainObject(raw.selections) ? { ...raw.selections } : {}
    const hasKey = Object.prototype.hasOwnProperty.call(selections, cellId)
    if (sourceId === null) {
      // `null` = 没选中源：把键删掉（缺键就是未选），不写空串。
      if (!hasKey) return
      delete selections[cellId]
      await writeJsonFileAtomically(filePath, { ...raw, version: nextVersion(raw), cells: isPlainObject(raw.cells) ? raw.cells : {}, selections })
      return
    }
    if (hasKey && selections[cellId] === sourceId) return
    selections[cellId] = sourceId
    await writeJsonFileAtomically(filePath, { ...raw, version: nextVersion(raw), cells: isPlainObject(raw.cells) ? raw.cells : {}, selections })
  }

  return {
    async readCellEnabled() {
      return explicitCells(await readRaw(filePath))
    },
    setCellEnabled(cellId, enabled) {
      const run = queue.then(() => write(cellId, enabled))
      // 队列本身不能吞掉这次失败：调用方要拿到；只是后续写不被它卡住。
      queue = run.catch(() => undefined)
      return run
    },
    async readCellSelection() {
      return explicitSelections(await readRaw(filePath))
    },
    setCellSelection(cellId, sourceId) {
      const run = queue.then(() => writeSelection(cellId, sourceId))
      queue = run.catch(() => undefined)
      return run
    }
  }
}
