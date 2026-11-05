import assert from 'node:assert/strict'
import test from 'node:test'
import { matchRecentRuns, type TornLog } from './torn.ts'

const friendId = 4079860
const at = (iso: string) => Date.parse(iso) / 1000

function event(id: string, typeId: number, timestamp: string, data: Record<string, unknown>): TornLog {
  return { id, timestamp: at(timestamp), details: { id: typeId }, data }
}

const deposit = event('deposit', 4800, '2026-11-05T06:16:28Z', {
  receiver: friendId, money: 510000, message: 'deposit',
})
const transfer = event('transfer', 4810, '2026-11-06T01:45:54Z', {
  sender: friendId, money: 20198402, message: 'xan5',
})
const purchase = event('purchase', 4201, '2026-11-06T01:46:41Z', {
  item: 206, quantity: 29, cost_each: 676231, cost_total: 19610699, area: 4,
})

test('matches the three events and converts purchase time to Manila', () => {
  assert.deepEqual(matchRecentRuns([purchase, deposit, transfer], friendId), [{
    sourceLogId: 'purchase',
    date: '2026-11-06',
    cashDeposit: 510000,
    saPrice: 676231,
    pasabuyQty: 5,
    timeRestock: '09:46:41',
  }])
})

test('rejects unlabeled and unrelated events', () => {
  assert.equal(matchRecentRuns([{ ...deposit, data: { ...deposit.data, message: 'other' } }, transfer, purchase], friendId).length, 0)
  assert.equal(matchRecentRuns([deposit, { ...transfer, data: { ...transfer.data, sender: 123 } }, purchase], friendId).length, 0)
  assert.equal(matchRecentRuns([deposit, transfer, { ...purchase, data: { ...purchase.data, area: 2 } }], friendId).length, 0)
})

test('uses Manila date across midnight and ignores historical purchases', () => {
  const midnightPurchase = { ...purchase, timestamp: at('2026-11-05T16:01:00Z') }
  const midnightTransfer = { ...transfer, timestamp: at('2026-11-05T15:59:00Z') }
  const midnightDeposit = { ...deposit, timestamp: at('2026-11-05T15:00:00Z') }
  assert.equal(matchRecentRuns([midnightDeposit, midnightTransfer, midnightPurchase], friendId)[0]?.date, '2026-11-06')
  const oldDeposit = { ...deposit, timestamp: at('2026-11-04T22:00:00Z') }
  const oldTransfer = { ...transfer, timestamp: at('2026-11-04T23:58:00Z') }
  const oldPurchase = { ...purchase, timestamp: at('2026-11-04T23:59:00Z') }
  assert.equal(matchRecentRuns([oldDeposit, oldTransfer, oldPurchase], friendId).length, 0)
})

test('keeps two distinct purchases on the same Manila date', () => {
  const secondDeposit = { ...deposit, id: 'deposit-2', timestamp: at('2026-11-05T07:00:00Z') }
  const secondTransfer = { ...transfer, id: 'transfer-2', timestamp: at('2026-11-06T02:00:00Z') }
  const secondPurchase = { ...purchase, id: 'purchase-2', timestamp: at('2026-11-06T02:01:00Z') }
  const runs = matchRecentRuns([
    deposit, transfer, purchase, secondDeposit, secondTransfer, secondPurchase,
  ], friendId)
  assert.deepEqual(runs.map((run) => run.sourceLogId), ['purchase-2', 'purchase'])
  assert.deepEqual(runs.map((run) => run.date), ['2026-11-06', '2026-11-06'])
})
