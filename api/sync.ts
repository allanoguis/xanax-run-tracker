import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRecentTornRuns } from '../server/torn.js'
import {
  createRun,
  getLastSyncAttemptAt,
  getRuns,
  setLastSyncAttemptAt,
} from '../server/sheets.js'

const COOLDOWN_MS = 5 * 60 * 1000
let lastAttemptAt = 0
let inFlight = false

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (inFlight) {
    const retryAfterSeconds = Math.max(1, Math.ceil((lastAttemptAt + COOLDOWN_MS - Date.now()) / 1000))
    res.setHeader('Retry-After', String(retryAfterSeconds))
    return res.status(429).json({ error: 'Sync cooldown active', retryAfterSeconds })
  }
  inFlight = true

  try {
    const now = Date.now()
    const previousAttempt = Math.max(lastAttemptAt, await getLastSyncAttemptAt())
    if (now - previousAttempt < COOLDOWN_MS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((previousAttempt + COOLDOWN_MS - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSeconds))
      return res.status(429).json({ error: 'Sync cooldown active', retryAfterSeconds })
    }
    await setLastSyncAttemptAt(now)
    lastAttemptAt = now
    const candidates = await getRecentTornRuns()
    let imported = 0
    let alreadyPresent = 0
    for (const run of candidates.sort((a, b) => a.date.localeCompare(b.date))) {
      try {
        await createRun(run)
        imported++
      } catch (error) {
        if (error instanceof Error && error.message === 'RUN_ALREADY_EXISTS') {
          alreadyPresent++
        } else {
          throw error
        }
      }
    }
    const result = await getRuns()
    return res.status(200).json({
      success: true,
      imported,
      alreadyPresent,
      nextAllowedAt: new Date(now + COOLDOWN_MS).toISOString(),
      ...result,
    })
  } catch (error) {
    console.error('Torn sync failed:', error)
    if (error instanceof Error && error.message === 'Missing TORN_API_KEY') {
      return res.status(503).json({ error: 'Torn API key is not configured' })
    }
    return res.status(502).json({ error: 'Torn sync failed' })
  } finally {
    inFlight = false
  }
}
