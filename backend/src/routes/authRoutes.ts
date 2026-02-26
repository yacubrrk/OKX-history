import type { FastifyInstance } from 'fastify'
import { resolveUserByInitData } from '../services/userService.js'

export const registerAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post('/auth/telegram', async (request, reply) => {
    const body = request.body as { initData?: string } | undefined
    const initData = body?.initData?.trim() ?? ''

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
  })
}
