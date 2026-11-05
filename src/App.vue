<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowRight,
  Check,
  Copy,
  LockKeyhole,
  Package,
  Plane,
  RefreshCw,
  Search,
  Sheet,
} from '@lucide/vue'

type RunsResponse = {
  success: boolean
  headers: string[]
  data: string[][]
  imported?: number
  alreadyPresent?: number
  nextAllowedAt?: string
}
type ApiError = Error & { status?: number; retryAfterSeconds?: number }

const defaultHeaders = [
  'Date', 'Cash Deposit', 'SA Price', 'Main Xanax Cost',
  'Pasabuy Qty', 'Pasabuy Cost', 'Change', 'Time Restock',
]
const copyableColumns = new Set([1, 2, 3, 5, 6])
const keyInput = ref('')
const key = ref('')
const connected = ref(false)
const connecting = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const notice = ref('')
const copyMessage = ref('')
const copiedCell = ref('')
const search = ref('')
const headers = ref<string[]>(defaultHeaders)
const rows = ref<string[][]>([])
const lastUpdated = ref('')
const syncCooldownUntil = ref(0)
const clock = ref(Date.now())
let clockInterval: number | undefined

onMounted(() => {
  syncCooldownUntil.value = Number(localStorage.getItem('tornSyncCooldownUntil') ?? 0)
  clockInterval = window.setInterval(() => { clock.value = Date.now() }, 1000)
})
onUnmounted(() => window.clearInterval(clockInterval))

const cooldownSeconds = computed(() => Math.max(0, Math.ceil((syncCooldownUntil.value - clock.value) / 1000)))
const refreshLabel = computed(() => {
  if (loading.value) return 'Refreshing…'
  if (!cooldownSeconds.value) return 'Refresh'
  const minutes = Math.floor(cooldownSeconds.value / 60)
  const seconds = String(cooldownSeconds.value % 60).padStart(2, '0')
  return `Refresh in ${minutes}:${seconds}`
})

function setCooldown(until: number) {
  syncCooldownUntil.value = until
  localStorage.setItem('tornSyncCooldownUntil', String(until))
  clock.value = Date.now()
}

const latest = computed(() => rows.value.at(-1))
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return rows.value
    .map((cells, index) => ({ cells, row: index + 2 }))
    .reverse()
    .filter(({ cells }) =>
      !query || cells.some((cell) => String(cell ?? '').toLowerCase().includes(query)),
    )
})

async function requestRuns(accessKey: string, sync = false): Promise<RunsResponse> {
  const response = await fetch(sync ? '/api/sync' : '/api/runs', {
    method: sync ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${accessKey}` },
  })
  const payload = await response.json().catch(() => ({})) as Partial<RunsResponse> & { error?: string }
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`) as ApiError
    error.status = response.status
    error.retryAfterSeconds = Number(response.headers.get('Retry-After') ?? 0)
    throw error
  }
  if (!Array.isArray(payload.headers) || !Array.isArray(payload.data)) {
    throw new Error('Unexpected API response')
  }
  return payload as RunsResponse
}

function describeError(error: unknown): string {
  if ((error as ApiError).status === 401) return 'That access key was not accepted. Check it and try again.'
  if ((error as ApiError).status === 429) return 'Refresh is rate limited. Please wait for the countdown.'
  if ((error as ApiError).status === 503) return 'Torn API key is not configured on the server.'
  if ((error as ApiError).status === 502) return 'Torn import failed. Check the server logs for details.'
  if ((error as ApiError).status === 500) return 'The spreadsheet request failed. Check the server logs for details.'
  return 'Could not load runs. Make sure Vercel dev is running and try again.'
}

function applyRuns(result: RunsResponse) {
  headers.value = result.headers.length ? result.headers : defaultHeaders
  rows.value = result.data
  lastUpdated.value = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit',
  }).format(new Date())
}

async function connect() {
  const entered = keyInput.value.trim()
  if (!entered || connecting.value) return
  connecting.value = true
  errorMessage.value = ''
  notice.value = ''
  try {
    applyRuns(await requestRuns(entered))
    key.value = entered
    keyInput.value = ''
    connected.value = true
  } catch (error) {
    errorMessage.value = describeError(error)
  } finally {
    connecting.value = false
  }
}

function lock() {
  key.value = ''
  connected.value = false
  rows.value = []
  search.value = ''
  copiedCell.value = ''
  copyMessage.value = ''
  errorMessage.value = ''
  notice.value = ''
}

async function refresh() {
  if (!key.value || loading.value || cooldownSeconds.value) return
  loading.value = true
  errorMessage.value = ''
  notice.value = ''
  setCooldown(Date.now() + 5 * 60 * 1000)
  try {
    const result = await requestRuns(key.value, true)
    applyRuns(result)
    if (result.nextAllowedAt) setCooldown(Date.parse(result.nextAllowedAt))
    notice.value = result.imported
      ? `Imported ${result.imported} new ${result.imported === 1 ? 'run' : 'runs'} from Torn.`
      : 'No new labeled runs found. Your sheet is up to date.'
  } catch (error) {
    const message = describeError(error)
    const retryAfter = (error as ApiError).retryAfterSeconds
    if (retryAfter && retryAfter > cooldownSeconds.value) setCooldown(Date.now() + retryAfter * 1000)
    if ((error as ApiError).status === 401) lock()
    errorMessage.value = message
  } finally {
    loading.value = false
  }
}

async function copyCell(value: string, row: number, column: number) {
  const cellId = `${row}-${column}`
  try {
    await navigator.clipboard.writeText(value)
    copiedCell.value = cellId
    copyMessage.value = `${headers.value[column]} copied.`
    window.setTimeout(() => {
      if (copiedCell.value === cellId) copiedCell.value = ''
    }, 1800)
  } catch {
    copyMessage.value = `Could not copy ${headers.value[column]}.`
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><Plane :size="19" :stroke-width="2.2" /></span>
        <span class="brand-name">Torn <span>Run Tracker</span></span>
      </div>
      <div class="top-actions">
        <span class="private-label"><LockKeyhole :size="15" /> Private workspace</span>
        <button v-if="connected" class="link-button" type="button" @click="lock">Lock</button>
      </div>
    </header>

    <main class="content">
      <section v-if="!connected" class="access-layout" aria-labelledby="access-title">
        <div class="intro">
          <div class="eyebrow">YOUR RUNS, IN ONE PLACE</div>
          <h1 id="access-title">A clearer view of every run.</h1>
          <p>Review run history and import new records from Torn into your spreadsheet.</p>
          <div class="feature"><span>✓</span> One view for entries and calculated totals</div>
          <div class="feature"><span>✓</span> Refresh to import up to three new runs</div>
        </div>
        <form class="access-card" @submit.prevent="connect">
          <span class="access-icon" aria-hidden="true"><LockKeyhole :size="23" /></span>
          <h2>Open your workspace</h2>
          <p>Enter the access key to view your runs.</p>
          <label for="key">Access key</label>
          <input id="key" v-model="keyInput" type="password" autocomplete="off" placeholder="Enter access key" required />
          <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
          <button class="button primary access-button" type="submit" :disabled="connecting">
            {{ connecting ? 'Connecting…' : 'Open workspace' }}
            <ArrowRight v-if="!connecting" :size="17" />
          </button>
          <small>Your key is kept in memory for this page only.</small>
        </form>
      </section>

      <template v-else>
        <div class="page-heading">
          <div>
            <div class="eyebrow">WORKSPACE OVERVIEW</div>
            <h1>Run tracker</h1>
            <p>Every entry and calculated value, together at a glance.</p>
          </div>
        </div>
        <div class="connection">
          <span class="status-dot" aria-hidden="true"></span>
          <strong>Connected to Google Sheets</strong>
          <span>·</span>
          Last updated {{ lastUpdated }}
        </div>
        <p v-if="errorMessage" class="banner error-message" role="alert">{{ errorMessage }}</p>
        <p v-if="notice" class="banner success-message" role="status">{{ notice }}</p>
        <span class="sr-only" role="status">{{ copyMessage }}</span>

        <section class="stats" aria-label="Run summary">
          <div class="stat">
            <span>Recorded runs</span><strong>{{ rows.length }}</strong><small>Entries in your sheet</small>
            <span class="stat-icon blue" aria-hidden="true"><Plane :size="19" /></span>
          </div>
          <div class="stat">
            <span>Latest run</span><strong class="stat-date">{{ latest?.[0] || '—' }}</strong>
            <small>Most recent entry in the sheet</small>
            <span class="stat-icon violet" aria-hidden="true"><Plane :size="19" /></span>
          </div>
          <div class="stat">
            <span>Latest restock</span><strong class="stat-date">{{ latest?.[7] || '—' }}</strong>
            <small>Time from the latest entry</small>
            <span class="stat-icon green" aria-hidden="true"><Package :size="19" /></span>
          </div>
        </section>

        <section class="panel" aria-labelledby="ledger-title">
          <div class="panel-heading">
            <div>
              <div class="eyebrow">YOUR DATA</div>
              <h2 id="ledger-title">Run ledger</h2>
              <p>All eight columns from your spreadsheet, including calculated values.</p>
            </div>
            <span class="count">{{ rows.length }} {{ rows.length === 1 ? 'entry' : 'entries' }}</span>
          </div>
          <div class="toolbar">
            <label class="search-field">
              <Search :size="17" aria-hidden="true" />
              <span class="sr-only">Search runs</span>
              <input v-model="search" type="search" placeholder="Search runs" />
            </label>
            <button class="button secondary refresh-button" type="button" :disabled="loading || cooldownSeconds > 0" @click="refresh">
              <RefreshCw :size="16" :class="{ spinning: loading }" />
              {{ refreshLabel }}
            </button>
          </div>
          <div v-if="rows.length" class="table-scroll">
            <table>
              <thead><tr><th v-for="(header, index) in headers" :key="index" scope="col">{{ header }}</th></tr></thead>
              <tbody>
                <tr v-for="item in filtered" :key="item.row">
                  <td v-for="(_, index) in headers" :key="index" :class="{ 'date-cell': index === 0, calculated: [3, 5, 6].includes(index) }">
                    <span class="cell-content">
                      <span>{{ item.cells[index] || '—' }}</span>
                      <button
                        v-if="copyableColumns.has(index) && item.cells[index]"
                        class="copy-button"
                        type="button"
                        :aria-label="`Copy ${headers[index]}: ${item.cells[index]}`"
                        :title="copiedCell === `${item.row}-${index}` ? 'Copied' : `Copy ${headers[index]}`"
                        @click="copyCell(item.cells[index], item.row, index)"
                      >
                        <Check v-if="copiedCell === `${item.row}-${index}`" :size="14" />
                        <Copy v-else :size="14" />
                      </button>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="!filtered.length" class="empty-search">No runs match “{{ search }}”.</div>
          </div>
          <div v-else class="empty-state">
            <span class="empty-icon" aria-hidden="true"><Sheet :size="22" /></span>
            <h3>No runs yet</h3>
            <p>Refresh imports up to three new labeled runs from Torn.</p>
            <button class="button secondary" type="button" :disabled="loading || cooldownSeconds > 0" @click="refresh">
              <RefreshCw :size="16" /> {{ refreshLabel }}
            </button>
          </div>
        </section>
        <p class="footnote">Refresh imports recent Torn logs and reads the consolidated Google Sheet. It is limited to once every five minutes.</p>
      </template>
    </main>
  </div>
</template>
