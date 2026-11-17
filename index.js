/**
 * Host half of the sidebar account usage bundle.
 *
 * Exposes one read-only JSON route that returns the stored DeepSeek account
 * wallets plus today's Platform spend. The account token never leaves the
 * Host: the route reads it through `deepseekAccount.getPlatformSession()` and
 * forwards only currency/amount totals.
 */

const ROUTE_PATH = '/plugins/sidebar-account-usage/snapshot'
const CACHE_TTL_MS = 20_000
const REQUEST_TIMEOUT_MS = 12_000
const MAX_WINDOW_SECONDS = 32 * 24 * 60 * 60

/** China has no daylight saving time, so Beijing time is a fixed +08:00. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
/** Peak windows in Beijing minutes-of-day: 09:00-12:00 and 14:00-18:00. */
const PEAK_WINDOWS = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]]
/**
 * Weekday dates of China's statutory holiday periods (Beijing calendar).
 * Weekends are off-peak by rule, so only the weekday dates inside each
 * announced 放假安排 need to be listed. Sources:
 * 2026: 国办发明电〔2025〕7号; 2027: 国办发明电〔2026〕10号.
 * When a new year's notice is published, add its weekday dates here.
 */
const HOLIDAYS = new Set([
  // 2026
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
  '2026-04-06',
  '2026-05-01', '2026-05-04', '2026-05-05',
  '2026-06-19',
  '2026-09-25',
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
  // 2027
  '2027-01-01',
  '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12',
  '2027-04-05',
  '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-06-09',
  '2027-09-15',
  '2027-10-01', '2027-10-04', '2027-10-05', '2027-10-06', '2027-10-07',
])

/** The Web carrier is required; the account service is read optionally. */
export const inject = ['webServer']

export { isPeakAt, peakState }

/**
 * Register the snapshot route for the lifetime of the plugin row.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const cache = new Map()

  const snapshotFor = (query) => {
    const key = `${query.start}:${query.end}:${query.tz}:${query.locale}:${query.version}`
    const now = Date.now()
    const cached = cache.get(key)
    if (cached !== undefined && cached.expiresAt > now) return cached.value
    const value = loadSnapshot(ctx, query)
    cache.set(key, { value, expiresAt: now + CACHE_TTL_MS })
    value.catch(() => cache.delete(key))
    if (cache.size > 32) {
      for (const [entryKey, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(entryKey)
      }
    }
    return value
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    resource: async (request) => {
      try {
        const query = parseQuery(new URL(request.url).searchParams)
        const snapshot = await snapshotFor(query)
        return respond(200, { ...snapshot, peak: peakState(Date.now()) })
      } catch (error) {
        console.error('[sidebar-account-usage] snapshot failed:', describe(error))
        return respond(200, {
          signedIn: false,
          balanceState: 'unavailable',
          spendState: 'unavailable',
          updatedAt: Date.now(),
        })
      }
    },
  }), 'sidebar-account-usage: snapshot route')
}

/**
 * Read one snapshot; each half degrades independently.
 * @param ctx - Host plugin context.
 * @param query - validated query window and client identity.
 */
async function loadSnapshot(ctx, query) {
  const updatedAt = Date.now()
  const account = ctx.get('deepseekAccount')
  if (account === undefined) {
    return { signedIn: false, balanceState: 'unavailable', spendState: 'unavailable', updatedAt }
  }

  let view
  try {
    view = await account.getState()
  } catch (error) {
    console.error('[sidebar-account-usage] account state failed:', describe(error))
    view = undefined
  }
  if (view === undefined || view === null || view.status !== 'credential-stored') {
    return { signedIn: false, balanceState: 'signed-out', spendState: 'signed-out', updatedAt }
  }

  const [balance, spend] = await Promise.all([
    readBalance(account, query),
    readSpend(account, query),
  ])
  return { signedIn: true, ...balance, ...spend, updatedAt: Date.now() }
}

/**
 * Read the recharge and bonus wallets through the account service.
 * @param account - the `deepseekAccount` service.
 * @param query - client identity carried into the Platform request.
 */
async function readBalance(account, query) {
  let details
  try {
    details = await account.getBalance({
      version: query.version,
      locale: query.locale,
      timezoneOffsetSeconds: query.tz,
    })
  } catch (error) {
    console.error('[sidebar-account-usage] balance failed:', describe(error))
    return { balanceState: 'unavailable' }
  }
  if (details === null || details === undefined || details.status !== 'ready') {
    return { balanceState: 'unavailable' }
  }
  return {
    balanceState: 'ready',
    wallets: walletAmounts(details.value),
    bonusWallets: walletAmounts(details.bonusWallets),
  }
}

/**
 * Sum today's cost buckets from the Platform usage endpoint.
 * @param account - the `deepseekAccount` service.
 * @param query - the local-day window and client identity.
 */
async function readSpend(account, query) {
  let session
  try {
    session = await account.getPlatformSession()
  } catch (error) {
    console.error('[sidebar-account-usage] platform session failed:', describe(error))
    return { spendState: 'unavailable' }
  }
  if (
    session === null || session === undefined
    || typeof session.origin !== 'string'
    || typeof session.token !== 'string'
  ) {
    return { spendState: 'signed-out' }
  }

  let url
  try {
    url = new URL('/api/v0/usage/by_api_key/cost', session.origin)
  } catch {
    return { spendState: 'unavailable' }
  }
  url.searchParams.set('start', String(query.start))
  url.searchParams.set('end', String(query.end))
  url.searchParams.set('tz', String(query.tz))

  const headers = {
    accept: 'application/json',
    'x-client-platform': 'web',
    ...(session.requestHeaders ?? {}),
    'x-dsh-auth-token': session.token,
  }

  let response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    console.error('[sidebar-account-usage] usage request failed:', describe(error))
    return { spendState: 'unavailable' }
  }
  if (!response.ok) {
    console.error('[sidebar-account-usage] usage returned HTTP', response.status)
    return { spendState: 'unavailable' }
  }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    console.error('[sidebar-account-usage] usage response was not JSON:', describe(error))
    return { spendState: 'unavailable' }
  }
  if (payload === null || typeof payload !== 'object' || payload.code !== 0) {
    return { spendState: 'unavailable' }
  }

  const spend = [...sumCosts(payload, query.start, query.end)]
    .map(([currency, amount]) => ({ currency, amount: Math.round(amount * 10_000) / 10_000 }))
    .filter((entry) => Number.isFinite(entry.amount))
  return { spendState: 'ready', spend }
}

/**
 * Sum every hourly `cost` bucket that falls inside the requested day.
 * @param payload - the Platform usage response.
 * @param start - inclusive window start in Unix seconds.
 * @param end - exclusive window end in Unix seconds.
 */
function sumCosts(payload, start, end) {
  const totals = new Map()
  const groups = payload?.data?.biz_data?.data
  if (!Array.isArray(groups)) return totals
  for (const group of groups) {
    const currency = typeof group?.currency === 'string' ? group.currency : null
    if (currency === null) continue
    for (const key of ['series', 'function_series']) {
      const series = group[key]
      if (!Array.isArray(series)) continue
      for (const entry of series) {
        const buckets = entry?.buckets
        if (!Array.isArray(buckets)) continue
        for (const bucket of buckets) {
          const time = Number(bucket?.time)
          const cost = Number(bucket?.cost)
          if (!Number.isFinite(time) || !Number.isFinite(cost)) continue
          if (time < start || time >= end) continue
          totals.set(currency, (totals.get(currency) ?? 0) + cost)
        }
      }
    }
  }
  return totals
}

/**
 * Map service wallets to plain JSON amounts, dropping unparseable rows.
 * @param wallets - the service wallet list.
 */
function walletAmounts(wallets) {
  const out = []
  if (!Array.isArray(wallets)) return out
  for (const wallet of wallets) {
    const currency = typeof wallet?.currency === 'string' ? wallet.currency : null
    const amount = Number(wallet?.balance)
    if (currency === null || !Number.isFinite(amount)) continue
    out.push({ currency, amount })
  }
  return out
}

/**
 * Validate the snapshot query, falling back to the caller's local day.
 * @param params - the request query parameters.
 */
function parseQuery(params) {
  const now = Date.now()
  const tz = boundedInteger(params.get('tz'), -18 * 3600, 18 * 3600)
    ?? -new Date(now).getTimezoneOffset() * 60

  const localNow = now + tz * 1000
  const localMidnight = Math.floor(localNow / 86_400_000) * 86_400_000
  const fallbackStart = Math.floor((localMidnight - tz * 1000) / 1000)
  const fallbackEnd = fallbackStart + 86_400

  let start = boundedInteger(params.get('start'), 0, Number.MAX_SAFE_INTEGER)
  let end = boundedInteger(params.get('end'), 0, Number.MAX_SAFE_INTEGER)
  const valid = start !== undefined && end !== undefined
    && end > start
    && end - start <= MAX_WINDOW_SECONDS
    && start <= Math.floor(now / 1000) + 86_400
    && end >= Math.floor(now / 1000) - 2 * 86_400
  if (!valid) {
    start = fallbackStart
    end = fallbackEnd
  }

  return {
    start,
    end,
    tz,
    locale: sanitizeLocale(params.get('locale')),
    version: sanitizeVersion(params.get('version')),
  }
}

/**
 * @param raw - the raw query value.
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @returns the integer, or undefined when absent or out of range.
 */
function boundedInteger(raw, min, max) {
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) return undefined
  return value
}

/**
 * @param raw - the raw locale query value.
 * @returns a conservative locale identifier.
 */
function sanitizeLocale(raw) {
  if (typeof raw !== 'string') return 'en-US'
  const value = raw.trim()
  if (value.length === 0 || value.length > 32) return 'en-US'
  return /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(value) ? value : 'en-US'
}

/**
 * @param raw - the raw version query value.
 * @returns a conservative version string.
 */
function sanitizeVersion(raw) {
  if (typeof raw !== 'string') return '0.0.0'
  const value = raw.trim()
  if (value.length === 0 || value.length > 32) return '0.0.0'
  return /^[0-9A-Za-z.+-]+$/.test(value) ? value : '0.0.0'
}

/**
 * @param status - the HTTP status code.
 * @param body - a JSON-serializable response body.
 */
function respond(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Read one instant on the Beijing calendar.
 * @param ms - epoch milliseconds.
 */
function beijingParts(ms) {
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

/**
 * DeepSeek peak pricing: Beijing Mon-Fri inside the two windows, excluding
 * statutory holidays; everything else is off-peak at half price.
 * @param ms - epoch milliseconds.
 */
function isPeakAt(ms) {
  const parts = beijingParts(ms)
  if (parts.weekday === 0 || parts.weekday === 6) return false
  if (HOLIDAYS.has(parts.date)) return false
  return PEAK_WINDOWS.some(([from, to]) => parts.minutes >= from && parts.minutes < to)
}

/**
 * Describe the current pricing window and when it next flips.
 * @param ms - epoch milliseconds.
 */
function peakState(ms) {
  const parts = beijingParts(ms)
  const active = isPeakAt(ms)
  const limit = 10 * 24 * 60
  let nextChangeAt = null
  for (let step = 1; step <= limit; step += 1) {
    const candidate = ms + step * 60 * 1000
    if (isPeakAt(candidate) !== active) {
      nextChangeAt = candidate - (candidate % 60_000)
      break
    }
  }
  return {
    active,
    holiday: HOLIDAYS.has(parts.date),
    weekend: parts.weekday === 0 || parts.weekday === 6,
    date: parts.date,
    nextChangeAt,
  }
}

/**
 * @param error - an unknown thrown value.
 * @returns a message without request or response data.
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
