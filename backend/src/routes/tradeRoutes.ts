import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../config/env.js'
import { getOverviewStats, listTradesByCursor } from '../db/tradesRepo.js'
import { getCache, setCache } from '../services/cache.js'
import { resolveUserByInitData } from '../services/userService.js'

const getInitDataFromHeader = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }
  return value ?? ''
}

export const registerTradeRoutes = async (app: FastifyInstance): Promise<void> => {
  const tradesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const initData = getInitDataFromHeader(request.headers['x-telegram-init-data'])
    if (!initData) {
      return reply.status(401).send({ message: 'x-telegram-init-data header is required' })
    }

    const query = request.query as { cursor?: string; limit?: string; symbol?: string }
    const limit = Number(query.limit ?? '50')
    const cursor = query.cursor?.trim() || undefined
    const symbol = query.symbol?.trim() || undefined

    if (cursor && Number.isNaN(Date.parse(cursor))) {
      return reply.status(400).send({ message: 'cursor must be ISO timestamp' })
    }

    try {
      const user = await resolveUserByInitData(initData)
      const cacheKey = `trades:${user.id}:${cursor ?? 'first'}:${limit}:${symbol ?? '-'}`

      const cached = await getCache<{ trades: unknown[]; hasMore: boolean; nextCursor: string | null }>(cacheKey)
      if (cached) {
        return cached
      }

      const listArgs: { userId: number; limit: number; cursor?: string; symbol?: string } = {
        userId: user.id,
        limit,
      }
      if (cursor) {
        listArgs.cursor = cursor
      }
      if (symbol) {
        listArgs.symbol = symbol
      }

      const payload = await listTradesByCursor(listArgs)
      await setCache(cacheKey, payload, env.cacheTtlSeconds)
      return payload
    } catch {
      return reply.status(401).send({ message: 'Invalid Telegram initData' })
    }
  }

  const overviewHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const initData = getInitDataFromHeader(request.headers['x-telegram-init-data'])
    if (!initData) {
      return reply.status(401).send({ message: 'x-telegram-init-data header is required' })
    }

    try {
      const user = await resolveUserByInitData(initData)
      const cacheKey = `overview:${user.id}`

      const cached = await getCache<{
        totalBalance: string
        totalPnl: string
        todayPnl: string
        recentTrades: unknown[]
      }>(cacheKey)
      if (cached) {
        return cached
      }

      const stats = await getOverviewStats(user.id)
      const payload = {
        totalBalance: '0',
        totalPnl: stats.totalPnl,
        todayPnl: stats.todayPnl,
        recentTrades: stats.recentTrades,
      }

      await setCache(cacheKey, payload, env.cacheTtlSeconds)
      return payload
    } catch {
      return reply.status(401).send({ message: 'Invalid Telegram initData' })
    }
  }

  app.get('/api/trades', tradesHandler)
  app.get('/miniapp/api/trades', tradesHandler)
  app.get('/api/overview', overviewHandler)
  app.get('/miniapp/api/overview', overviewHandler)
}
