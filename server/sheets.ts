
import { createPrivateKey } from 'node:crypto'
import { google, type sheets_v4 } from 'googleapis'

export interface RunInput {
  date: string
  cashDeposit?: number
  saPrice?: number
  pasabuyQty?: number
  timeRestock?: string
}

const SHEET_NAME = 'Runs'
const SYNC_METADATA_KEY = 'tornSyncLastAttemptAt'
const RUN_LOG_ID_METADATA_KEY = 'tornImportedPurchaseLogId'

async function getSyncMetadata() {
  const sheets = getSheetsClient()
  const spreadsheetId = getSpreadsheetId()
  const result = await sheets.spreadsheets.developerMetadata.search({
    spreadsheetId,
    requestBody: {
      dataFilters: [{ developerMetadataLookup: { metadataKey: SYNC_METADATA_KEY } }],
    },
  })
  return result.data.matchedDeveloperMetadata?.[0]?.developerMetadata
}

export async function getLastSyncAttemptAt(): Promise<number> {
  const metadata = await getSyncMetadata()
  const value = Number(metadata?.metadataValue ?? 0)
  return Number.isFinite(value) ? value : 0
}

export async function setLastSyncAttemptAt(timestamp: number): Promise<void> {
  const sheets = getSheetsClient()
  const spreadsheetId = getSpreadsheetId()
  const existing = await getSyncMetadata()
  if (existing?.metadataId != null) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateDeveloperMetadata: {
            dataFilters: [{ developerMetadataLookup: { metadataId: existing.metadataId } }],
            developerMetadata: { metadataValue: String(timestamp) },
            fields: 'metadataValue',
          },
        }],
      },
    })
  } else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          createDeveloperMetadata: {
            developerMetadata: {
              metadataKey: SYNC_METADATA_KEY,
              metadataValue: String(timestamp),
              location: { spreadsheet: true },
              visibility: 'PROJECT',
            },
          },
        }],
      },
    })
  }
}

function dateSerial(date: string): number {
  return (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000
}

export function buildRunValues(input: RunInput, rowNumber: number): Array<number | string> {
  if (input.saPrice === undefined) return [dateSerial(input.date), input.cashDeposit ?? '', '', '', '', '', '', '']
  return [
    dateSerial(input.date),
    input.cashDeposit ?? '',
    input.saPrice,
    `=C${rowNumber}*(30-E${rowNumber})`,
    input.pasabuyQty ?? '',
    `=E${rowNumber}*C${rowNumber}`,
    `=B${rowNumber}-D${rowNumber}`,
    input.timeRestock ?? '',
  ]
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID

  if (!id) {
    throw new Error('Missing GOOGLE_SPREADSHEET_ID')
  }

  return id
}

export function normalizeGooglePrivateKey(value: string): string {
  let key = value.trim()
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  key = key.replace(/\\n/g, '\n')

  try {
    if (createPrivateKey(key).asymmetricKeyType !== 'rsa') {
      throw new Error('Not an RSA key')
    }
  } catch {
    throw new Error('Invalid GOOGLE_PRIVATE_KEY: expected an RSA PEM private key; check quotes and newline formatting')
  }

  return key
}

function getSheetsClient(): sheets_v4.Sheets {
  const email = process.env.GOOGLE_CLIENT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY

  if (!email || !privateKey) {
    throw new Error('Missing Google credentials')
  }

  const auth = new google.auth.JWT({
    email,
    key: normalizeGooglePrivateKey(privateKey),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
    ],
  })

  return google.sheets({
    version: 'v4',
    auth,
  } as sheets_v4.Options)
}

// Retrieve all 8 columns, including calculated values.
export async function getRuns() {
  const sheets = getSheetsClient()

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A1:H`,
    valueRenderOption: 'FORMATTED_VALUE',
  })

  const rows = (response.data.values ?? []) as string[][]

  return {
    headers: rows[0] ?? [],
    data: rows.slice(1).filter(
      (row) => row.some((value) => value !== ''),
    ),
  }
}

// Insert a run, or reconcile the quantity of a previously imported purchase.
export async function createRun(input: RunInput & { sourceLogId: string; sourceDepositId?: string }) {
  const sheets = getSheetsClient()
  const spreadsheetId = getSpreadsheetId()

  const importedLog = await sheets.spreadsheets.developerMetadata.search({
    spreadsheetId,
    requestBody: {
      dataFilters: [{ developerMetadataLookup: {
        metadataKey: RUN_LOG_ID_METADATA_KEY,
        metadataValue: input.sourceLogId,
      } }],
    },
  })
  const imported = Boolean(importedLog.data.matchedDeveloperMetadata?.length)

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:H`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })

  const rows = (response.data.values ?? []) as unknown[][]
  const depositMetadata = input.sourceDepositId ? await sheets.spreadsheets.developerMetadata.search({
    spreadsheetId,
    requestBody: { dataFilters: [{ developerMetadataLookup: {
      metadataKey: 'tornImportedDepositLogId', metadataValue: input.sourceDepositId,
    } }] },
  }) : undefined
  const depositRow = depositMetadata?.data.matchedDeveloperMetadata?.[0]?.developerMetadata?.location?.dimensionRange?.startIndex
  const existingIndex = depositRow != null ? depositRow - 1 : input.timeRestock === undefined ? -1 : rows.findIndex((row) =>
    Number(row[0]) === dateSerial(input.date) && String(row[7] ?? '') === input.timeRestock,
  )
  if (imported && existingIndex < 0) throw new Error('RUN_ROW_NOT_FOUND')

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2
    // A pending sync must never clear a row that has already been completed.
    if (input.saPrice === undefined) {
      if (input.cashDeposit !== undefined &&
          String(rows[existingIndex]?.[1] ?? '') !== String(input.cashDeposit)) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${SHEET_NAME}!B${rowNumber}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[input.cashDeposit]] },
        })
        return { rowNumber, status: 'updated' }
      }
      return { rowNumber, status: 'unchanged' }
    }
    const quantityChanged = buildRunValues(input, rowNumber).some((value, index) =>
      ![3, 5, 6].includes(index) && String(rows[existingIndex]?.[index] ?? '') !== String(value))
    if (quantityChanged || !imported) {
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(sheetId,title)',
      })
      const sheetId = spreadsheet.data.sheets?.find((sheet: sheets_v4.Schema$Sheet) => sheet.properties?.title === SHEET_NAME)
        ?.properties?.sheetId
      if (sheetId == null) throw new Error(`Missing ${SHEET_NAME} sheet`)
      const requests: sheets_v4.Schema$Request[] = []
      if (quantityChanged) requests.push({
        updateCells: {
          start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 0 },
          rows: [{ values: buildRunValues(input, rowNumber).map((value) => ({
            userEnteredValue: typeof value === 'number' ? { numberValue: value }
              : value.startsWith('=') ? { formulaValue: value } : { stringValue: value },
          })) }],
          fields: 'userEnteredValue',
        },
      })
      if (!imported) requests.push({
        createDeveloperMetadata: {
          developerMetadata: {
            metadataKey: RUN_LOG_ID_METADATA_KEY,
            metadataValue: input.sourceLogId,
            location: { spreadsheet: true },
            visibility: 'PROJECT',
          },
        },
      })
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
    }
    return { rowNumber, status: quantityChanged ? 'updated' : 'unchanged' }
  }

  // Row 2 contains the historical entry; new rows start at row 3.
  const rowNumber = Math.max(3, rows.length + 2)
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  })
  const sheetId = spreadsheet.data.sheets?.find((sheet: sheets_v4.Schema$Sheet) => sheet.properties?.title === SHEET_NAME)
    ?.properties?.sheetId
  if (sheetId == null) throw new Error(`Missing ${SHEET_NAME} sheet`)

  const values = buildRunValues(input, rowNumber).map((value) => ({
    userEnteredValue: typeof value === 'number'
      ? { numberValue: value }
      : value.startsWith('=') ? { formulaValue: value } : { stringValue: value },
  }))

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        ...(input.sourceDepositId ? [{ createDeveloperMetadata: { developerMetadata: {
          metadataKey: 'tornImportedDepositLogId', metadataValue: input.sourceDepositId,
          location: { dimensionRange: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } },
          visibility: 'PROJECT',
        } } } as sheets_v4.Schema$Request] : []),
        {
          updateCells: {
            start: { sheetId, rowIndex: rowNumber - 1, columnIndex: 0 },
            rows: [{ values }],
            fields: 'userEnteredValue',
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowNumber - 1,
              endRowIndex: rowNumber,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'mmmm d' } } },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
        {
          createDeveloperMetadata: {
            developerMetadata: {
              metadataKey: RUN_LOG_ID_METADATA_KEY,
              metadataValue: input.sourceLogId,
              location: { spreadsheet: true },
              visibility: 'PROJECT',
            },
          },
        },
      ],
    },
  })

  return { rowNumber, status: 'created' }
}
