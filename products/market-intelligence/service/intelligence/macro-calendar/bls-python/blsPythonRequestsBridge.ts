import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(nodeExecFile)

export const blsPythonRequestsBridgePolicy = Object.freeze({
  pythonPath: '/usr/local/bin/python3',
  processDeadlineMs: 17_000,
  maximumStdoutBytes: 1_600_000,
  userAgent: 'BLS-CPS-Pipeline/1.0 (market-intelligence@example.com)'
} as const)

export type BlsPythonBridgeOperation =
  | Readonly<{ kind: 'calendar-family-values'; family: 'cpi' | 'employment'; period: `${number}-M${string}` }>
  | Readonly<{ kind: 'employment-schedule'; year: `${number}` }>

type BlsScheduleRow = Readonly<{ releaseDate: string; referencePeriod: `${number}-M${string}` }>

export type BlsPythonBridgeResult =
  | Readonly<{ state: 'response'; status: number; body: string }>
  | Readonly<{
    state: 'schedule'
    rows: readonly BlsScheduleRow[]
    employmentRows?: readonly BlsScheduleRow[]
    cpiRows?: readonly BlsScheduleRow[]
  }>
  | Readonly<{ state: 'unavailable' }>

type ExecFile = (file: string, args: readonly string[], options: Readonly<{ timeout: number; maxBuffer: number; encoding: 'utf8' }>) => Promise<{ stdout: string; stderr: string }>

export function createBlsPythonRequestsBridge(deps: Readonly<{ execFile?: ExecFile; pythonPath?: string }>): Readonly<{ run: (operation: unknown) => Promise<BlsPythonBridgeResult> }> {
  const runChild = deps.execFile ?? execFileCallback
  return Object.freeze({
    async run(operation: unknown): Promise<BlsPythonBridgeResult> {
      if (!isOperation(operation)) return unavailable()
      try {
        const result = await runChild(
          deps.pythonPath ?? blsPythonRequestsBridgePolicy.pythonPath,
          ['-c', BLS_PYTHON_BRIDGE_SOURCE, JSON.stringify(operation)],
          { timeout: blsPythonRequestsBridgePolicy.processDeadlineMs, maxBuffer: blsPythonRequestsBridgePolicy.maximumStdoutBytes, encoding: 'utf8' }
        )
        return parseChildOutput(result.stdout, operation)
      } catch {
        return unavailable()
      }
    }
  })
}

const BLS_PYTHON_BRIDGE_SOURCE = String.raw`
import json, re, sys
import requests

USER_AGENT = "${blsPythonRequestsBridgePolicy.userAgent}"
API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
SCHEDULE_URL = "https://www.bls.gov/schedule/{year}/home.htm"
MAX_BYTES = ${blsPythonRequestsBridgePolicy.maximumStdoutBytes}
MONTHS = {name: index for index, name in enumerate(("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"), 1)}

def emit(value):
    encoded = json.dumps(value, separators=(",", ":"))
    if len(encoded.encode("utf-8")) <= MAX_BYTES:
        print(encoded)

def main():
    operation = json.loads(sys.argv[1])
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    if operation["kind"] == "calendar-family-values":
        period = operation["period"]
        year = period[:4]
        series = ["CUUR0000SA0", "CUUR0000SA0L1E"] if operation["family"] == "cpi" else ["CES0000000001", "LNS14000000", "CES0500000003"]
        start_year = int(year) - (2 if operation["family"] == "cpi" and period.endswith("-M01") else 1)
        payload = {"seriesid": series, "startyear": str(start_year), "endyear": year}
        response = session.post(API_URL, json=payload, headers={"Content-type": "application/json"}, timeout=15, allow_redirects=False)
        body = response.content
        if len(body) > 1500000:
            emit({"state": "unavailable"})
            return
        emit({"state": "response", "status": response.status_code, "body": body.decode("utf-8") if response.status_code >= 200 and response.status_code < 300 else ""})
        return
    year = operation["year"]
    response = session.get(SCHEDULE_URL.format(year=year), timeout=15, allow_redirects=False)
    body = response.content
    if response.status_code < 200 or response.status_code >= 300 or len(body) > 1500000:
        emit({"state": "unavailable"})
        return
    text = body.decode("utf-8")
    employment_rows = []
    cpi_rows = []
    last_date = None
    date_pattern = re.compile(r'<td class="date-cell"><p>\w+,\s+([A-Za-z]+ \d{1,2}, \d{4})</p></td>')
    event_pattern = re.compile(r'<strong>\s*(Employment Situation|Consumer Price Index)\s*</strong>\s+for\s+([A-Za-z]+)\s+(\d{4})', re.IGNORECASE)
    for line in text.splitlines():
        date_match = date_pattern.search(line)
        if date_match:
            last_date = date_match.group(1)
        event_match = event_pattern.search(line)
        if event_match and last_date and event_match.group(2) in MONTHS:
            from datetime import datetime
            release_date = datetime.strptime(last_date, "%B %d, %Y").strftime("%Y-%m-%d")
            entry = {"releaseDate": release_date, "referencePeriod": "%s-M%02d" % (event_match.group(3), MONTHS[event_match.group(2)])}
            if event_match.group(1).lower() == "employment situation":
                employment_rows.append(entry)
            else:
                cpi_rows.append(entry)
    emit({"state": "schedule", "employmentRows": employment_rows, "cpiRows": cpi_rows})

try:
    main()
except Exception:
    emit({"state": "unavailable"})
`

async function execFileCallback(file: string, args: readonly string[], options: Readonly<{ timeout: number; maxBuffer: number; encoding: 'utf8' }>): Promise<{ stdout: string; stderr: string }> {
  return execFile(file, [...args], options)
}

function parseChildOutput(stdout: string, operation: BlsPythonBridgeOperation): BlsPythonBridgeResult {
  if (Buffer.byteLength(stdout, 'utf8') > blsPythonRequestsBridgePolicy.maximumStdoutBytes) return unavailable()
  try {
    const value: unknown = JSON.parse(stdout.trim())
    if (!isPlainRecord(value) || own(value, 'state') === 'unavailable') return unavailable()
    if (own(value, 'state') === 'response' && Number.isInteger(own(value, 'status')) && typeof own(value, 'body') === 'string') {
      return Object.freeze({ state: 'response', status: own(value, 'status') as number, body: own(value, 'body') as string })
    }
    if (own(value, 'state') === 'schedule' && Object.keys(value).length === 3 &&
      operation.kind === 'employment-schedule' &&
      isCompleteScheduleRows(own(value, 'employmentRows'), operation.year) &&
      isCompleteScheduleRows(own(value, 'cpiRows'), operation.year)) {
      const employmentRows = Object.freeze(own(value, 'employmentRows') as readonly BlsScheduleRow[])
      const cpiRows = Object.freeze(own(value, 'cpiRows') as readonly BlsScheduleRow[])
      return Object.freeze({ state: 'schedule', rows: employmentRows, employmentRows, cpiRows })
    }
  } catch {}
  return unavailable()
}

function isOperation(value: unknown): value is BlsPythonBridgeOperation {
  if (!isPlainRecord(value)) return false
  if (own(value, 'kind') === 'calendar-family-values') return (own(value, 'family') === 'cpi' || own(value, 'family') === 'employment') && typeof own(value, 'period') === 'string' && /^\d{4}-M(?:0[1-9]|1[0-2])$/.test(own(value, 'period') as string) && Object.keys(value).length === 3
  return own(value, 'kind') === 'employment-schedule' && typeof own(value, 'year') === 'string' && /^\d{4}$/.test(own(value, 'year') as string) && Object.keys(value).length === 2
}

function isCompleteScheduleRows(value: unknown, year: string): value is readonly BlsScheduleRow[] {
  try {
    if (!Array.isArray(value) || value.length !== 12 || !value.every((row) => isPlainRecord(row) && Object.keys(row).length === 2 &&
      typeof own(row, 'releaseDate') === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(own(row, 'releaseDate') as string) &&
      typeof own(row, 'referencePeriod') === 'string' && /^\d{4}-M(?:0[1-9]|1[0-2])$/.test(own(row, 'referencePeriod') as string))) return false
    const rows = value as readonly BlsScheduleRow[]
    return new Set(rows.map((row) => row.releaseDate)).size === rows.length &&
      samePeriods(rows, annualReferencePeriods(year))
  } catch { return false }
}

function annualReferencePeriods(year: string): ReadonlySet<string> {
  return new Set([`${Number(year) - 1}-M12`, ...Array.from({ length: 11 }, (_, index) => `${year}-M${String(index + 1).padStart(2, '0')}`)])
}

function samePeriods(rows: readonly BlsScheduleRow[], expected: ReadonlySet<string>): boolean {
  return rows.length === expected.size && rows.every((row) => expected.has(row.referencePeriod))
}

function own(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0 } catch { return false }
}

function unavailable(): BlsPythonBridgeResult { return Object.freeze({ state: 'unavailable' }) }
