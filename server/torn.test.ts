import assert from 'node:assert/strict'
import test from 'node:test'
import { matchRecentRuns, type TornLog } from './torn.ts'

const friendId = 4079860
const at = (iso: string) => Date.parse(iso) / 1000

function event(id: string, typeId: number, timestamp: string, data: Record<string, unknown>): TornLog {
  return { id, timestamp: at(timestamp), details: { id: typeId }, data }
}

const deposit = event('deposit', 4800, '2026-11-05T06:16:28Z', {
  receiver: friendId, money: 510000, message: 'deposit-11/6/2026',
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
    sourceDepositId: 'deposit',
    date: '2026-11-06',
    cashDeposit: 510000,
    saPrice: 676231,
    pasabuyQty: 5,
    timeRestock: '09:46:41',
  }])
})

test('keeps one labeled quantity across repeated transfers for a purchase', () => {
  const firstTransfer = { ...transfer, id: 'transfer-1', timestamp: at('2026-11-06T01:30:00Z') }
  const secondTransfer = { ...transfer, id: 'transfer-2', timestamp: at('2026-11-06T01:40:00Z') }
  const thirdTransfer = { ...transfer, id: 'transfer-3' }
  const laterTransfer = { ...transfer, id: 'transfer-after-purchase', timestamp: at('2026-11-06T02:00:00Z') }
  const runs = matchRecentRuns([deposit, firstTransfer, firstTransfer, secondTransfer, thirdTransfer, laterTransfer, purchase], friendId)

  assert.equal(runs.length, 1)
  assert.equal(runs[0].date, '2026-11-06')
  assert.equal(runs[0].pasabuyQty, 5)
})

test('does not guess a quantity when transfers for one purchase have different labels', () => {
  const otherQuantity = { ...transfer, id: 'transfer-2', data: { ...transfer.data, message: 'xan3' } }
  assert.equal(matchRecentRuns([deposit, transfer, otherQuantity, purchase], friendId)[0]?.pasabuyQty, undefined)
})

test('rejects unlabeled and unrelated events', () => {
  assert.equal(matchRecentRuns([{ ...deposit, data: { ...deposit.data, message: 'other' } }, transfer, purchase], friendId).length, 0)
  assert.equal(matchRecentRuns([deposit, { ...transfer, data: { ...transfer.data, sender: 123 } }, purchase], friendId)[0]?.saPrice, undefined)
  assert.equal(matchRecentRuns([deposit, transfer, { ...purchase, data: { ...purchase.data, area: 2 } }], friendId)[0]?.saPrice, undefined)
})

test('uses the label date across midnight and ignores historical purchases', () => {
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
  assert.deepEqual(runs.map((run) => run.pasabuyQty), [5, 5])
})

test('uses the explicit deposit date regardless of deposit or purchase calendar day', () => {
  const labeledDeposit = { ...deposit, timestamp: at('2026-11-05T15:50:00Z') }
  const laterPurchase = { ...purchase, timestamp: at('2026-11-07T01:46:41Z') }
  const laterTransfer = { ...transfer, timestamp: at('2026-11-07T01:45:54Z') }
  const [run] = matchRecentRuns([labeledDeposit, laterTransfer, laterPurchase], friendId)
  assert.equal(run?.date, '2026-11-06')
  assert.equal(run?.timeRestock, '09:46:41')
})

test('rejects missing, malformed and impossible deposit dates', () => {
  for (const message of ['deposit', 'deposit-13/6/2026', 'deposit-2/29/2026', 'deposit-11/31/2026', 'deposit-0/6/2026', 'deposit-11/6/26', 'deposit-11/6/2026 extra']) {
    assert.equal(matchRecentRuns([{ ...deposit, data: { ...deposit.data, message } }, transfer, purchase], friendId).length, 0, message)
  }
})

test('creates a date-only candidate before transfers or a purchase arrive', () => {
  const pending = matchRecentRuns([deposit], friendId)
  assert.deepEqual(pending, [{ sourceLogId: 'deposit:deposit', sourceDepositId: 'deposit', date: '2026-11-06' }])
  const completed = matchRecentRuns([deposit, transfer, purchase], friendId)
  assert.equal(completed.length, 1)
  assert.equal(completed[0]?.sourceDepositId, pending[0]?.sourceDepositId)
  assert.equal(completed[0]?.saPrice, 676231)
})
