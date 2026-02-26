import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { resolveUserByInitData } from '../services/userService.js'

export const registerAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  const resolveInitData = (request: FastifyRequest): string => {
    const header = request.headers['x-telegram-init-data']
    const headerValue = Array.isArray(header) ? header[0] : header
    const body = request.body as { initData?: string } | undefined
    const query = request.query as { initData?: string } | undefined
    return headerValue?.trim() || body?.initData?.trim() || query?.initData?.trim() || ''
  }

  const authHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const initData = resolveInitData(request)

    if (!initData) {
      return reply.status(400).send({ message: 'initData is required' })
    }

    try {
      const user = await resolveUserByInitData(initData)
      return {
        hasApi: Boolean(user.apiConnected && user.encryptedApiKey && user.encryptedSecret),
        onboardingCompleted: true,
      }
    } catch (error) {
      app.log.warn({ err: error }, 'Telegram initData verification failed')
      const details = error instanceof Error ? error.message : 'Invalid Telegram initData'
      return reply.status(401).send({ message: details })
    }
  }

  app.post('/auth/telegram', authHandler)
  app.get('/auth/telegram', authHandler)
  app.post('/miniapp/auth/telegram', authHandler)
  app.get('/miniapp/auth/telegram', authHandler)
}
