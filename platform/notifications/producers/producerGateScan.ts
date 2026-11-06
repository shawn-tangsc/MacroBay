/**
 * 生产者门禁的扫描器（契约 v2.29 §12.1）。
 *
 * 它要回答的问题只有一个：**批准表里的每一条事件，代码里有没有人真的提交它？**
 * 名义上「声明齐、批准齐、文案齐、测试齐」都不算——今晚漏掉的四条，正是别处都齐、就是没人发。
 *
 * 为什么不能只 grep 字面量 id：仓库里几乎所有提交都把 id 写成常量（`EVENT_IDS.signalTriggered`）。
 * 只扫字面量的门禁会全漏，而**漏光的门禁比没有更糟**——它给「已经接好了」发假证书。
 *
 * 因此判定分三层，逐层收紧：
 * 1. 先**剥注释**再扫。前两次假通过都是被注释里的示例串骗过去的。
 * 2. 认三种调用形态：字面量、常量表成员、以及「先赋给变量再提交」——最后一种**必须解析到**，
 *    解析不到就报「无法判定」并算未通过，**不许默认通过**。
 * 3. 判定单位是**提交那一刻的实参**（或构造这个实参的那个函数体），不是「文件里出现过这个 id」。
 */

export type ProducerGateSource = {
  /** 相对仓库根的路径，只用于报错点名。 */
  path: string
  content: string
}

export type ProducerGateInput = {
  /** 批准表里的每一条事件（唯一真值来源，不手抄）。 */
  approvedIds: readonly string[]
  /** 显式休眠的事件 id（必须在声明里带 owner / reason / reviveWhen）。 */
  dormantIds: readonly string[]
  sources: readonly ProducerGateSource[]
  /** 事件 id 常量表：常量名 → 事件 id。由调用方从定义处读出来，不手抄。 */
  idConstants: Readonly<Record<string, string>>
}

export type ProducerGateResult = {
  /** 有提交点的事件。 */
  produced: string[]
  /** 既没有提交点、也没有显式休眠的事件：门禁红的就是这些。 */
  missing: string[]
  /** 声明了休眠、代码里却有提交点：自相矛盾，也要红。 */
  dormantButProduced: string[]
  /** 解析不了的提交点：按未通过处理，并点名要求改成字面量或常量表成员。 */
  unresolved: { path: string; line: number; snippet: string }[]
}

/** 去掉行注释与块注释，保留换行以便行号仍然对得上。 */
export function stripComments(source: string): string {
  let out = ''
  let index = 0
  let inBlock = false
  while (index < source.length) {
    const two = source.slice(index, index + 2)
    if (inBlock) {
      if (two === '*/') {
        inBlock = false
        out += '  '
        index += 2
        continue
      }
      out += source[index] === '\n' ? '\n' : ' '
      index += 1
      continue
    }
    if (two === '/*') {
      inBlock = true
      out += '  '
      index += 2
      continue
    }
    if (two === '//') {
      while (index < source.length && source[index] !== '\n') {
        out += ' '
        index += 1
      }
      continue
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
      const quote = source[index]
      out += quote
      index += 1
      while (index < source.length) {
        out += source[index]
        if (source[index] === '\\') {
          out += source[index + 1] ?? ''
          index += 2
          continue
        }
        if (source[index] === quote) {
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    out += source[index]
    index += 1
  }
  return out
}

export function evaluateProducerGate(input: ProducerGateInput): ProducerGateResult {
  const produced = new Set<string>()
  const unresolved: ProducerGateResult['unresolved'] = []
  const index = buildDefinitionIndex(input.sources)

  for (const source of input.sources) {
    const code = stripComments(source.content)
    for (const call of findSubmitCalls(code)) {
      const ids = resolveArgumentIds(call.argument, code, input.idConstants, index, call.start)
      if (ids === undefined) {
        unresolved.push({ path: source.path, line: lineOf(code, call.start), snippet: call.argument.trim().slice(0, 120) })
        continue
      }
      for (const id of ids) produced.add(id)
    }
  }

  const approved = new Set(input.approvedIds)
  const dormant = new Set(input.dormantIds)
  const missing = input.approvedIds.filter((id) => !produced.has(id) && !dormant.has(id))
  const dormantButProduced = input.dormantIds.filter((id) => produced.has(id))
  return {
    produced: [...produced].filter((id) => approved.has(id)).sort(),
    missing,
    dormantButProduced,
    unresolved
  }
}

/**
 * 仓库级定义索引：标识符 → 定义片段。
 *
 * 为什么要跨文件：提交实参常常是 `buildXRequest(...)` 或函数里的局部变量，id 写在**构造它的那个函数**
 * 里（契约 §12.1 说的「或其构建函数」）。只跟同文件，会把已经接好的事件误报成没人发——
 * 误报多了，下一个人就会给门禁加豁免，那它就变成第二个万能别名。
 */
function buildDefinitionIndex(sources: readonly ProducerGateSource[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  const add = (name: string, body: string): void => {
    const list = index.get(name)
    if (list === undefined) index.set(name, [body])
    else list.push(body)
  }
  for (const source of sources) {
    const code = stripComments(source.content)
    // 取定义处往后的一段窗口即可：我们只在这段里找 `eventTypeId` 的字面量或常量表成员。
    // 精确切函数体在这里没有收益——切错会漏报，漏报会把已经接好的事件误判成没人发。
    for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/gu)) {
      const name = match[1]
      if (name === undefined) continue
      add(name, code.slice(match.index, match.index + 4000))
    }
    for (const match of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/gu)) {
      const name = match[1]
      if (name === undefined) continue
      add(name, code.slice(match.index, match.index + 4000))
    }
  }
  return index
}

/** 这个标识符在文件里是否以参数形式出现（`(name:` / `, name:` / `name)`）。 */
function looksLikeParameter(code: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(String.raw`[(:,]\s*${escaped}\s*[:,)]`, 'u').test(code)
}

/**
 * 顺着一小段代码里出现的**构造函数名**与**常量名**往下跟（最多两层）。
 *
 * 只跟两类标识符：以 build / create / make / to / from 开头的函数名，以及全大写常量。全跟会顺着
 * 任意局部变量漂走，把别的事件的 id 算到这条头上——误报比漏报更容易让人给门禁加豁免。
 */
function followBuilders(
  window: string,
  index: Map<string, string[]>,
  constants: Readonly<Record<string, string>>,
  depth: number,
  /** 只有最初那段窗口可以「看到什么算什么」；构造函数体里必须只认 `eventTypeId:` 那一处。 */
  collectAllLiterals = true
): Set<string> {
  const ids = new Set<string>()
  if (collectAllLiterals) for (const id of literalIds(window)) ids.add(id)
  for (const constant of window.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/gu)) {
    const mapped = constants[constant[2] ?? '']
    if (mapped !== undefined) ids.add(mapped)
  }
  if (depth <= 0) return ids
  for (const token of window.matchAll(/\b(build[A-Z]\w*|create[A-Z]\w*|make[A-Z]\w*|to[A-Z]\w*|from[A-Z]\w*|[A-Z][A-Z0-9_]{2,})\b/gu)) {
    const body = lookup(index, token[1] ?? '')
    if (body === undefined) continue
    // 只看这个构造函数的 `eventTypeId:` 那一处：函数体窗口会溢出到隔壁函数，
    // 把别的事件的 id 也算进来（实测把 `calendar-refresh` 算成了同一条）。
    const declared = /eventTypeId\s*:\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))/u.exec(body)
    if (declared === null) {
      for (const id of followBuilders(body, index, constants, depth - 1, false)) ids.add(id)
      continue
    }
    const literal = declared[1] ?? declared[2]
    if (literal !== undefined && isEventIdShape(literal)) {
      ids.add(literal)
      continue
    }
    const constant = declared[3] === undefined
      ? undefined
      : (constants[declared[3].split('.').pop() ?? ''] ?? resolveConstant(index, declared[3].split('.').pop() ?? ''))
    if (constant !== undefined) {
      ids.add(constant)
      continue
    }
    for (const id of followBuilders(body, index, constants, depth - 1, false)) ids.add(id)
  }
  return ids
}

/** 一段代码里的事件 id 字面量（用于顺着构造函数再跟一层）。 */
function literalIds(chunk: string): string[] {
  const ids: string[] = []
  for (const literal of chunk.matchAll(/'([^']+)'|"([^"]+)"/gu)) {
    const value = literal[1] ?? literal[2] ?? ''
    if (isEventIdShape(value)) ids.push(value)
  }
  return ids
}

/** 顶层常量 → 它指向的事件 id（定义片段里只有一个事件 id 形状的字面量时才采用）。 */
function resolveConstant(index: Map<string, string[]>, name: string): string | undefined {
  const body = lookup(index, name)
  if (body === undefined) return undefined
  const literal = body.match(/'([^']+)'|"([^"]+)"/u)
  const value = literal?.[1] ?? literal?.[2]
  return value !== undefined && isEventIdShape(value) ? value : undefined
}

/** 名字在仓库里唯一才采用；重名就是「无法判定」，不许挑一个顺眼的。 */
function lookup(index: Map<string, string[]>, name: string): string | undefined {
  const bodies = index.get(name)
  if (bodies === undefined || bodies.length !== 1) return undefined
  return bodies[0]
}

/** 找 `submit(` / `.submit(` 的实参文本；括号配平，嵌套调用也算一处。 */
function findSubmitCalls(code: string): { start: number; argument: string }[] {
  const calls: { start: number; argument: string }[] = []
  // 允许链式写法（`deps\n  .submit({...})`）：前面那截可以有任意多个点，包括一个光秃秃的点。
  // 名字以 submit 开头的都算（`submit(...)`、`deps.submit(...)`、`submitEvent(...)`）。
  const pattern = /(^|[^\w$])(?:[\w$.]*\.)?submit\w*\s*\(/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(code)) !== null) {
    const openIndex = code.indexOf('(', match.index + match[0].length - 1)
    if (openIndex < 0) continue
    const argument = balanced(code, openIndex)
    if (argument === undefined) continue
    // 类型声明里的 `submit(request: T): Promise` 不是调用：闭合括号后面紧跟冒号就是签名。
    const after = code.slice(openIndex + 1 + argument.length + 1).match(/^\s*(=>|:)/u)?.[1] ?? ''
    // `submit: (request: T) => …` 是接线回调的类型签名，不是调用：闭合括号后面是 `:` 或 `=>`。
    if (after !== '') continue
    calls.push({ start: openIndex, argument })
  }
  return calls
}

function balanced(code: string, openIndex: number): string | undefined {
  let depth = 0
  for (let index = openIndex; index < code.length; index += 1) {
    const char = code[index]
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return code.slice(openIndex + 1, index)
    }
  }
  return undefined
}

/**
 * 把一个提交实参解析成事件 id 集合。
 *
 * 解析不到返回 `undefined`——**这不是「没有」**，是「我看不懂」。门禁据此报「无法判定」，
 * 让人把写法改成字面量或常量表成员；宁可要求改写，也不许它悄悄漏过。
 */
function resolveArgumentIds(
  argument: string,
  code: string,
  constants: Readonly<Record<string, string>>,
  index: Map<string, string[]>,
  callIndex: number,
  depth = 0
): string[] | undefined {
  const text = argument.trim()
  // 空实参不是提交通知：`submit()` 在这套代码里还可能是对话框的「保存」（实测有一处）。
  if (text.length === 0) return []
  const collected = new Set<string>()

  const fromText = (chunk: string): boolean => {
    let found = false
    for (const literal of chunk.matchAll(/'([^']+)'|"([^"]+)"/gu)) {
      const value = literal[1] ?? literal[2] ?? ''
      if (isEventIdShape(value)) {
        collected.add(value)
        found = true
      }
    }
    for (const constant of chunk.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/gu)) {
      const mapped = constants[constant[2] ?? '']
      if (mapped !== undefined) {
        collected.add(mapped)
        found = true
      }
    }
    // `eventTypeId: SOME_EVENT_ID` 这种顶层常量：顺着定义找到字面量（契约 §12.1 第 ② 类）。
    for (const named of chunk.matchAll(/\beventTypeId\s*:\s*([A-Za-z_$][\w$]*)/gu)) {
      const resolved = resolveConstant(index, named[1] ?? '')
      if (resolved !== undefined) {
        collected.add(resolved)
        found = true
      }
    }
    return found
  }

  // ① 实参自己就带着 id（对象字面量里的 `eventTypeId: '…'` 或常量表成员）。
  if (fromText(text)) return [...collected]

  // ② 实参是调用：顺着**构造它的那个函数**找一遍（仓库级、名字唯一才采用）。
  const callName = /^([A-Za-z_$][\w$]*)\s*\(/u.exec(text)?.[1]
  if (callName !== undefined) {
    const body = lookup(index, callName)
    if (body !== undefined && fromText(body)) return [...collected]
    return undefined
  }

  // ③ 实参是标识符（局部变量 / 简写属性）：同文件定义优先，其次仓库级唯一定义。
  const identifier = /^([A-Za-z_$][\w$]*)$/u.exec(text)?.[1]
  if (identifier !== undefined) {
    const local = findDefinition(code, identifier, callIndex)
    if (local !== undefined) {
      if (fromText(local)) return [...collected]
      // 局部变量往往来自构造函数或 `map(builder)`：顺着窗口里能唯一解析到定义的标识符再跟一层
      // （契约 §12.1「或其构建函数」）。出现两个不同的事件 id 就算无法判定，不挑一个。
      const viaBuilder = followBuilders(local, index, constants, 2)
      if (viaBuilder.size === 1) {
        for (const id of viaBuilder) collected.add(id)
        return [...collected]
      }
      if (viaBuilder.size > 1) return undefined
    }
    const shared = lookup(index, identifier)
    if (shared !== undefined && fromText(shared)) return [...collected]
    // 参数透传（`(request) => submit(request)` 这类接线）：这里没有构造请求，id 在调用方那边，
    // 由那条调用点自己证明。**不是「无法判定」**——它本来就不打算在这层决定发什么。
    if (looksLikeParameter(code, identifier)) return [...collected]
    return undefined
  }

  // ④ 对象字面量里用简写属性（`{ eventTypeId, … }`）：顺着那个变量的唯一定义找。
  // 封闭表查表：`eventTypeId = SOURCE_ISSUE_EVENT_IDS[kind]`，表里所有值都是事件 id ⇒ 全部算上。
  // 这是可证明的（集合小、封闭、来源唯一），比让产品把同一个 id 写成两处字面量好得多。
  const tableLookup = /^([A-Za-z_$][\w$]*)\s*\[[^\]]+\]$/u.exec(text)
  if (tableLookup !== null) {
    const table = lookup(index, tableLookup[1] ?? '')
    if (table !== undefined) {
      // 表里的值可能是字面量，也可能又是常量（`EVENT_IDS.sourceStale`）：两种都解析。
      const values: string[] = []
      // 键可能是引号包着的（`'consecutive-failed': …`），别只认裸标识符。
      for (const entry of table.matchAll(/['"]?([A-Za-z_$][\w$-]*)['"]?\s*:\s*(?:'([^']+)'|([A-Za-z_$][\w$.]*))/gu)) {
        const literal = entry[2]
        if (literal !== undefined && isEventIdShape(literal)) {
          values.push(literal)
          continue
        }
        const dotted = entry[3]
        const resolved = dotted === undefined
          ? undefined
          : (constants[dotted.split('.').pop() ?? ''] ?? resolveConstant(index, dotted.split('.').pop() ?? ''))
        if (resolved !== undefined) values.push(resolved)
      }
      if (values.length > 0 && values.every(isEventIdShape)) {
        for (const value of values) collected.add(value)
        return [...collected]
      }
    }
    return undefined
  }

  if (/\{[\s\S]*?\beventTypeId\s*,/u.test(text)) {
    const local = findDefinition(code, 'eventTypeId', callIndex)
    if (local !== undefined && fromText(local)) return [...collected]
    // 简写属性常常是「从封闭表里查出来的一格」（`SOURCE_ISSUE_EVENT_IDS[kind]`）：把它当实参再解析一次。
    if (local !== undefined && depth < 2) {
      const nested = resolveArgumentIds(local, code, constants, index, callIndex, depth + 1)
      if (nested !== undefined && nested.length > 0) return [...nested]
    }
    const shared = lookup(index, 'eventTypeId')
    if (shared !== undefined && fromText(shared)) return [...collected]
  }
  return undefined
}

/** 同文件里找定义；`before` 给了就只认提交点**之前最近的那一处**（同名变量在别处也出现过是常态）。 */
function findDefinition(code: string, name: string, before?: number): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const constPattern = new RegExp(String.raw`\b(?:const|let|var)\s+${escaped}\s*(?::[^=]+)?=`, 'u')
  let chosen: RegExpExecArray | null = null
  for (const match of code.matchAll(new RegExp(constPattern.source, 'gu'))) {
    if (before !== undefined && match.index > before) break
    chosen = match
  }
  const constMatch = chosen
  if (constMatch !== null) {
    const start = constMatch.index + constMatch[0].length
    return sliceStatement(code, start)
  }
  // `for (const request of requests)`：把循环变量的来源（`requests`）当成它的定义。
  const loopPattern = new RegExp(String.raw`for\s*\(\s*(?:const|let|var)\s+${escaped}\s+of\s+`, 'u')
  const loopMatch = loopPattern.exec(code)
  if (loopMatch !== null) {
    const start = loopMatch.index + loopMatch[0].length
    const end = code.indexOf(')', start)
    if (end > start) return sliceStatement(code, start)
  }
  const functionPattern = new RegExp(String.raw`\b(?:function\s+${escaped}\s*\(|${escaped}\s*=\s*(?:async\s*)?\()` + '([\\s\\S]{0,4000})', 'u')
  const functionMatch = functionPattern.exec(code)
  if (functionMatch !== null) return functionMatch[1]
  return undefined
}

/** 从 `=` 之后取到同层的 `;` 或换行后的语句结束（对象字面量按花括号配平）。 */
function sliceStatement(code: string, start: number): string {
  let depth = 0
  for (let index = start; index < code.length; index += 1) {
    const char = code[index]
    if (char === '{' || char === '(' || char === '[') depth += 1
    else if (char === '}' || char === ')' || char === ']') {
      depth -= 1
      if (depth === 0) return code.slice(start, index + 1)
    } else if (char === ';' && depth === 0) return code.slice(start, index)
    else if (char === '\n' && depth === 0) {
      const rest = code.slice(start, index).trim()
      if (rest.length > 0) return rest
    }
  }
  return code.slice(start)
}

function isEventIdShape(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/u.test(value) && !value.includes('notification.')
}

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split('\n').length
}
