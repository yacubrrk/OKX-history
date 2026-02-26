import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../config/env.js'
import { clearUserApiCredentials, setUserApiCredentials } from '../db/usersRepo.js'
import { delCache } from '../services/cache.js'
import { encryptSecret } from '../services/crypto.js'
import { OkxHttpError, validateOkxCredentials } from '../services/okxClient.js'
import { resolveUserByInitData } from '../services/userService.js'

export const registerApiKeyRoutes = async (app: FastifyInstance): Promise<void> => {
  const registerHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as
      | {
          initData?: string
          apiKey?: string
          secretKey?: string
          passphrase?: string
        }
      | undefined

    const initData = body?.initData?.trim() ?? ''
    const apiKey = body?.apiKey?.trim() ?? ''
    const secretKey = body?.secretKey?.trim() ?? ''
    const passphrase = body?.passphrase?.trim() ?? ''

    if (!initData || !apiKey || !secretKey) {
      return reply.status(400).send({ message: 'initData, apiKey, secretKey are required' })
    }

    let user
    try {
      user = await resolveUserByInitData(initData)
    } catch {
      return reply.status(401).send({ message: 'Invalid Telegram initData' })
    }

    try {
      await validateOkxCredentials({ apiKey, secretKey, passphrase })
    } catch (error) {
      if (error instanceof OkxHttpError) {
        return reply.status(error.statusCode).send({ message: error.message })
      }
      throw error
    }

    await setUserApiCredentials({
      userId: user.id,
      encryptedApiKey: encryptSecret(apiKey),
      encryptedSecret: encryptSecret(secretKey),
      encryptedPassphrase: passphrase ? encryptSecret(passphrase) : null,
      apiConnected: true,
    })

    await delCache(`user:${user.telegramId}`, `overview:${user.id}`, `trades:${user.id}`)

    return {
      ok: true,
      apiConnected: true,
      cacheTtlSeconds: env.cacheTtlSeconds,
    }
  }

  const removeHandler = async (request: FastifyRequest, reply: FastifyReply) => {
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

    await clearUserApiCredentials(user.id)
    await delCache(`user:${user.telegramId}`, `overview:${user.id}`, `trades:${user.id}`)

    return {
      ok: true,
      apiConnected: false,
    }
  }

  app.post('/api/register', registerHandler)
  app.post('/miniapp/api/register', registerHandler)
  app.delete('/api/register', removeHandler)
  app.delete('/miniapp/api/register', removeHandler)
}
