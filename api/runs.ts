import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRuns } from '../server/sheets.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const secret = process.env.ADMIN_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    return res.status(200).json({ success: true, ...await getRuns() })
  } catch (error) {
    console.error('Google Sheets operation failed:', error)
    return res.status(500).json({ error: 'Spreadsheet operation failed' })
  }
}
