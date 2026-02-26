import type { AuthResponse, HistoryResponse, OverviewData, ProfileData, Trade } from '../types/models'
import { getTelegramInitData, getTelegramProfile } from './telegram'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const DEFAULT_LAST_SYNC = '—'

const STORAGE_KEYS = {
  onboarding: 'okx_onboarding_completed',
  lastSync: 'okx_last_sync',
  profileOverrides: 'okx_profile_overrides',
}

type ProfileOverrides = {
  name?: string
  username?: string
  avatar?: string
}

type BackendTrade = {
  id?: string | number
  symbol?: string
  entryPrice?: string | number
  exitPrice?: string | number
  quantity?: string | number
  buyTotal?: string | number
  sellTotal?: string | number
  pnl?: string | number
  pnlPercent?: string | number
  entryTime?: string
  exitTime?: string
}

let onboardingCompleted = localStorage.getItem(STORAGE_KEYS.onboarding) === '1'
let lastSync = localStorage.getItem(STORAGE_KEYS.lastSync) || DEFAULT_LAST_SYNC
let profileOverrides: ProfileOverrides = (() => {
  const raw = localStorage.getItem(STORAGE_KEYS.profileOverrides)

  if (!raw) {
    return {}
  }

  try {
    return JSON.parse(raw) as ProfileOverrides
  } catch {
    return {}
  }
})()

const iconMap: Record<string, string> = {
  BTC: '₿',
  ETH: 'Ξ',
  SOL: '◎',
  XRP: '✕',
  DOGE: 'Ð',
  AVAX: 'A',
}

const persistLocalState = () => {
  localStorage.setItem(STORAGE_KEYS.onboarding, onboardingCompleted ? '1' : '0')
  localStorage.setItem(STORAGE_KEYS.lastSync, lastSync)
  localStorage.setItem(STORAGE_KEYS.profileOverrides, JSON.stringify(profileOverrides))
}

const readInitDataOrThrow = (): string => {
  const initData = getTelegramInitData().trim()
  if (!initData) {
    throw new Error('Открой Mini App внутри Telegram')
  }
  return initData
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeSymbol = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '')

const getCoinIcon = (symbol: string): string => {
  const normalized = normalizeSymbol(symbol)
  const base = normalized.replace(/USDT$|USDC$|BUSD$/g, '').slice(0, 6)
  return iconMap[base] ?? '•'
}

const mapTrade = (trade: BackendTrade, index: number): Trade => {
  const symbolRaw = trade.symbol || 'UNKNOWN'
  const symbol = normalizeSymbol(symbolRaw)
  const buyDateTime = trade.entryTime || new Date().toISOString()
  const sellDateTime = trade.exitTime || buyDateTime

  return {
    id: String(trade.id ?? `trade-${index}`),
    symbol,
    buyPrice: toNumber(trade.entryPrice),
    sellPrice: toNumber(trade.exitPrice),
    quantity: toNumber(trade.quantity),
    spent: toNumber(trade.buyTotal),
    received: toNumber(trade.sellTotal),
    pnl: toNumber(trade.pnl),
    pnlPercent: toNumber(trade.pnlPercent),
    buyDateTime,
    sellDateTime,
    coinIcon: getCoinIcon(symbol),
  }
}

const buildUrl = (path: string): string => `${API_BASE_URL}${path}`

const parseErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`.trim()

  const raw = await response.text()
  if (!raw.trim()) {
    return fallback || 'Request failed'
  }

  try {
    const data = JSON.parse(raw) as { message?: string; error?: string }
    if (data?.message) {
      return data.message
    }
    if (data?.error) {
      return data.error
    }
  } catch {
    return `${fallback}: ${raw.slice(0, 160)}`
  }

  return fallback || 'Request failed'
}

const request = async <T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE'
    body?: unknown
    headers?: Record<string, string>
  } = {},
): Promise<T> => {
  const method = options.method ?? 'GET'
  const requestInit: RequestInit = {
    method,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }

  let response = await fetch(buildUrl(path), requestInit)

  if (response.status === 405 && path.startsWith('/') && !path.startsWith('/miniapp/')) {
    response = await fetch(buildUrl(`/miniapp${path}`), requestInit)
  }

  if (!response.ok) {
    const details = await parseErrorMessage(response)
    throw new Error(`${method} ${path}: ${details}`)
  }

  return (await response.json()) as T
}

export const authWithTelegram = async (initData: string): Promise<AuthResponse> => {
  const rawInitData = initData.trim() || readInitDataOrThrow()
  let data: { hasApi?: boolean } | null = null
  const attempts: Array<{ path: string; method: 'POST' | 'GET' }> = [
    { path: '/miniapp/auth/telegram', method: 'POST' },
    { path: '/auth/telegram', method: 'POST' },
    { path: '/miniapp/auth/telegram', method: 'GET' },
    { path: '/auth/telegram', method: 'GET' },
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    try {
      data = await request<{ hasApi?: boolean }>(attempt.path, {
        method: attempt.method,
        body: attempt.method === 'POST' ? { initData: rawInitData } : undefined,
        headers:
          attempt.method === 'GET'
            ? {
                'x-telegram-init-data': rawInitData,
              }
            : undefined,
      })
      break
    } catch (error) {
      lastError = error
    }
  }

  if (!data) {
    throw lastError instanceof Error ? lastError : new Error('Authentication failed')
  }

  return {
    hasApi: Boolean(data.hasApi),
    onboardingCompleted,
  }
}

export const completeOnboarding = async (): Promise<void> => {
  onboardingCompleted = true
  persistLocalState()
}

export const registerApi = async ({
  apiKey,
  secretKey,
  passphrase,
}: {
  apiKey: string
  secretKey: string
  passphrase?: string
}): Promise<void> => {
  const initData = readInitDataOrThrow()
  const trimmedApiKey = apiKey.trim()
  const trimmedSecretKey = secretKey.trim()
  const trimmedPassphrase = passphrase?.trim() ?? ''

  if (!trimmedApiKey || !trimmedSecretKey) {
    throw new Error('Поля API Key и Secret Key обязательны')
  }

  await request('/api/register', {
    method: 'POST',
    headers: {
      'x-telegram-init-data': initData,
    },
    body: {
      initData,
      apiKey: trimmedApiKey,
      secretKey: trimmedSecretKey,
      passphrase: trimmedPassphrase,
    },
  })

  lastSync = new Date().toISOString()
  persistLocalState()
}

export const getOverview = async (): Promise<OverviewData> => {
  const initData = readInitDataOrThrow()
  const data = await request<{
    totalBalance?: string | number
    totalPnl?: string | number
    todayPnl?: string | number
    recentTrades?: BackendTrade[]
  }>('/api/overview', {
    headers: {
      'x-telegram-init-data': initData,
    },
  })

  return {
    totalBalance: toNumber(data.totalBalance),
    totalPnl: toNumber(data.totalPnl),
    todayPnl: toNumber(data.todayPnl),
    recentTrades: (data.recentTrades ?? []).map(mapTrade),
  }
}

export const getHistory = async ({
  limit,
  cursor,
  query,
}: {
  limit: number
  cursor?: string
  query?: string
}): Promise<HistoryResponse> => {
  const initData = readInitDataOrThrow()
  const params = new URLSearchParams()
  params.set('limit', String(limit))

  if (cursor) {
    params.set('cursor', cursor)
  }

  const symbol = query?.trim().toUpperCase()
  if (symbol) {
    params.set('symbol', symbol)
  }

  const data = await request<{
    trades?: BackendTrade[]
    hasMore?: boolean
    nextCursor?: string | null
  }>(`/api/trades?${params.toString()}`, {
    headers: {
      'x-telegram-init-data': initData,
    },
  })

  return {
    trades: (data.trades ?? []).map(mapTrade),
    hasMore: Boolean(data.hasMore),
    nextCursor: data.nextCursor ?? '',
  }
}

export const getProfile = async (): Promise<ProfileData> => {
  const tg = getTelegramProfile()
  const auth = await authWithTelegram(getTelegramInitData())

  return {
    name: profileOverrides.name || tg.name,
    username: profileOverrides.username || tg.username,
    avatar: profileOverrides.avatar || tg.avatar,
    apiConnected: auth.hasApi,
    lastSync,
    maskedApi: auth.hasApi ? '****8F3D' : 'Not connected',
  }
}

export const updateProfile = async ({
  name,
  username,
  avatar,
}: {
  name: string
  username: string
  avatar?: string
}): Promise<void> => {
  const normalizedName = name.trim()
  const normalizedUsername = username.trim().startsWith('@') ? username.trim() : `@${username.trim()}`

  if (!normalizedName || !normalizedUsername || normalizedUsername === '@') {
    throw new Error('Введите имя и username')
  }

  profileOverrides = {
    ...profileOverrides,
    name: normalizedName,
    username: normalizedUsername,
    avatar: avatar?.trim() || profileOverrides.avatar,
  }

  persistLocalState()
}

export const syncData = async (): Promise<void> => {
  const initData = readInitDataOrThrow()
  const data = await request<{ status?: 'OK' | 'API_INVALID' }>('/api/sync', {
    method: 'POST',
    headers: {
      'x-telegram-init-data': initData,
    },
    body: { initData },
  })

  if (data.status === 'API_INVALID') {
    throw new Error('API ключ недействителен, подключи ключи заново')
  }

  lastSync = new Date().toISOString()
  persistLocalState()
}

export const deleteApi = async (): Promise<void> => {
  const initData = readInitDataOrThrow()

  await request('/api/register', {
    method: 'DELETE',
    headers: {
      'x-telegram-init-data': initData,
    },
    body: { initData },
  })

  lastSync = DEFAULT_LAST_SYNC
  persistLocalState()
}
