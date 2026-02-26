import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { delCache } from '../services/cache.js'
import { syncUserTrades } from '../services/syncService.js'
import { resolveUserByInitData } from '../services/userService.js'

export const registerSyncRoutes = async (app: FastifyInstance): Promise<void> => {
  const syncHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { initData?: string } | undefined
    const initData = body?.initData?.trim() ?? ''

    if (!initData) {
      return reply.status(400).send({ message: 'initData is required' })
    }

    let user
    try {
      user = await resolveUserByInitData(initData)
    } catch {
      return reply.status(401).send({ message: 'Invalid Telegram initData' })
    }

    if (!user.apiConnected || !user.encryptedApiKey || !user.encryptedSecret) {
      return reply.status(400).send({ message: 'API keys are not connected' })
    }

    const result = await syncUserTrades(user)

    await delCache(`user:${user.telegramId}`, `overview:${user.id}`)

    return result
  }

  app.post('/api/sync', syncHandler)
  app.post('/miniapp/api/sync', syncHandler)
}
