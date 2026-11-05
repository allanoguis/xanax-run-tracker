import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { buildRunValues, normalizeGooglePrivateKey } from './sheets.ts'

test('accepts PEM keys with literal quotes and escaped newlines', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

  for (const input of [pem, `"${pem}"`, `"${pem.replace(/\n/g, '\\n')}"`]) {
    const normalized = normalizeGooglePrivateKey(input)
    assert.ok(normalized.trimEnd() === pem.trimEnd())
    assert.ok(createSign('RSA-SHA256').update('test').sign(normalized).length > 0)
  }
})

test('rejects malformed Google private keys without exposing their content', () => {
  assert.throws(
    () => normalizeGooglePrivateKey('"not a private key"'),
    (error: unknown) => error instanceof Error &&
      error.message.includes('Invalid GOOGLE_PRIVATE_KEY') &&
      !error.message.includes('not a private key'),
  )
})

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
