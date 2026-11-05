export interface TornLog {
  id: string
  timestamp: number
  details: { id: number; title?: string }
  data: Record<string, unknown>
}

export interface ImportedRun {
  sourceLogId: string
  sourceDepositId?: string
  date: string
  cashDeposit?: number
  saPrice?: number
  pasabuyQty?: number
  timeRestock?: string
}

const XANAX_ITEM_ID = 206
const SOUTH_AFRICA_AREA_ID = 4
const MONEY_SEND_LOG_ID = 4800
const MONEY_RECEIVE_LOG_ID = 4810
const ABROAD_BUY_LOG_ID = 4201
const FIRST_IMPORT_TIMESTAMP = Date.parse('2026-11-05T00:00:00Z') / 1000
const MAX_TRANSFER_AGE = 24 * 60 * 60
const MAX_DEPOSIT_AGE = 72 * 60 * 60
const FIRST_RELEVANT_LOG_TIMESTAMP = FIRST_IMPORT_TIMESTAMP - MAX_TRANSFER_AGE - MAX_DEPOSIT_AGE
const MAX_PAGES_PER_TYPE = 3
const MAX_RUNS_PER_SYNC = 3
const manilaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
})

function friendId(): number {
  const id = Number(process.env.TORN_FRIEND_ID)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid TORN_FRIEND_ID')
  return id
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function manilaDateTime(timestamp: number) {
  const parts = Object.fromEntries(
    manilaFormatter.formatToParts(new Date(timestamp * 1000))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  }
}

function depositDate(log: TornLog): string | null {
  const match = /^deposit-(\d{1,2})\/(\d{1,2})\/(\d{4})$/i.exec(String(log.data.message ?? '').trim())
  if (!match) return null
  const [, month, day, year] = match
  const date = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number(year) >= 1000 && Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date ? date : null
}

function isDeposit(log: TornLog, recipientId: number): boolean {
  return log.details.id === MONEY_SEND_LOG_ID &&
    numeric(log.data.receiver) === recipientId &&
    depositDate(log) !== null &&
    (numeric(log.data.money) ?? 0) >= 0
}

function pasabuyQuantity(log: TornLog, senderId: number): number | null {
  if (log.details.id !== MONEY_RECEIVE_LOG_ID || numeric(log.data.sender) !== senderId) return null
  const match = /^xan(\d+)$/i.exec(String(log.data.message ?? '').trim())
  if (!match) return null
  const quantity = Number(match[1])
  return Number.isInteger(quantity) && quantity >= 0 && quantity <= 30 ? quantity : null
}

function isXanaxPurchase(log: TornLog): boolean {
  return log.details.id === ABROAD_BUY_LOG_ID &&
    numeric(log.data.item) === XANAX_ITEM_ID &&
    numeric(log.data.area) === SOUTH_AFRICA_AREA_ID &&
    (numeric(log.data.cost_each) ?? 0) > 0
}

export function matchRecentRuns(logs: TornLog[], recipientId = friendId()): ImportedRun[] {
  const purchases = logs.filter(isXanaxPurchase).sort((a, b) => a.timestamp - b.timestamp)
  const transfers = [...new Map(
    logs.filter((log) => pasabuyQuantity(log, recipientId) !== null).map((log) => [log.id, log]),
  ).values()]
  const deposits = logs.filter((log) => isDeposit(log, recipientId))
  const usedDeposits = new Set<string>()
  const runs: ImportedRun[] = []
  let previousPurchaseAt = -Infinity

  for (const purchase of purchases) {
    const previous = previousPurchaseAt
    previousPurchaseAt = purchase.timestamp
    if (purchase.timestamp < FIRST_IMPORT_TIMESTAMP) continue
    const { time } = manilaDateTime(purchase.timestamp)
    const purchaseTransfers = transfers
      .filter((log) => log.timestamp > previous && log.timestamp <= purchase.timestamp &&
        purchase.timestamp - log.timestamp <= MAX_TRANSFER_AGE)
      .sort((a, b) => a.timestamp - b.timestamp)
    if (!purchaseTransfers.length) continue
    const deposit = deposits
      .filter((log) => !usedDeposits.has(log.id) && log.timestamp <= purchaseTransfers[0].timestamp &&
        purchaseTransfers[0].timestamp - log.timestamp <= MAX_DEPOSIT_AGE)
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    if (!deposit) continue
    const quantity = pasabuyQuantity(purchaseTransfers[0], recipientId)
    if (quantity === null || purchaseTransfers.some((transfer) =>
      pasabuyQuantity(transfer, recipientId) !== quantity)) continue
    const cashDeposit = numeric(deposit.data.money)
    const saPrice = numeric(purchase.data.cost_each)
    if (cashDeposit === null || saPrice === null) continue
    runs.push({
      sourceLogId: purchase.id,
      sourceDepositId: deposit.id,
      date: depositDate(deposit)!,
      cashDeposit,
      saPrice,
      pasabuyQty: quantity,
      timeRestock: time,
    })
    usedDeposits.add(deposit.id)
  }
  for (const deposit of deposits) {
    if (usedDeposits.has(deposit.id) || deposit.timestamp < FIRST_IMPORT_TIMESTAMP) continue
    runs.push({
      sourceLogId: `deposit:${deposit.id}`,
      sourceDepositId: deposit.id,
      date: depositDate(deposit)!,
    })
  }
  return runs.reverse().sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_RUNS_PER_SYNC)
}

async function fetchLogType(typeId: number, relevant: (log: TornLog) => boolean): Promise<TornLog[]> {
  const key = process.env.TORN_API_KEY
  if (!key) throw new Error('Missing TORN_API_KEY')
  const matches: TornLog[] = []
  let to: number | undefined
  for (let page = 0; page < MAX_PAGES_PER_TYPE; page++) {
    const url = new URL('https://api.torn.com/v2/user/log')
    url.searchParams.set('log', String(typeId))
    url.searchParams.set('limit', '100')
    if (to !== undefined) url.searchParams.set('to', String(to))
    const response = await fetch(url, {
      headers: { Authorization: `ApiKey ${key}` },
      signal: AbortSignal.timeout(8000),
    })
    const body = await response.json() as {
      log?: TornLog[]
      error?: { code?: number }
    }
    if (!response.ok || body.error || !Array.isArray(body.log)) {
      throw new Error(`Torn API log request failed (${body.error?.code ?? response.status})`)
    }
    if (!body.log.length) break
    matches.push(...body.log.filter(relevant))
    const oldest = Math.min(...body.log.map((log) => log.timestamp))
    if (oldest <= FIRST_RELEVANT_LOG_TIMESTAMP || to === oldest - 1) break
    to = oldest - 1
  }
  return matches
}

export async function getRecentTornRuns(): Promise<ImportedRun[]> {
  const recipientId = friendId()
  const [deposits, transfers, purchases] = await Promise.all([
    fetchLogType(MONEY_SEND_LOG_ID, (log) => isDeposit(log, recipientId)),
    fetchLogType(MONEY_RECEIVE_LOG_ID, (log) => pasabuyQuantity(log, recipientId) !== null),
    fetchLogType(ABROAD_BUY_LOG_ID, isXanaxPurchase),
  ])
  return matchRecentRuns([...deposits, ...transfers, ...purchases], recipientId)
}
