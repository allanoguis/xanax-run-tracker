import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRunValues } from './sheets.ts'

test('builds a dated row with the sheet formulas', () => {
  assert.deepEqual(buildRunValues({
    date: '2026-11-06',
    cashDeposit: 510000,
    saPrice: 676231,
    pasabuyQty: 5,
    timeRestock: '09:46:41',
  }, 3), [
    46332,
    510000,
    676231,
    '=C3*(30-E3)',
    5,
    '=E3*C3',
    '=B3-D3',
    '09:46:41',
  ])
})
