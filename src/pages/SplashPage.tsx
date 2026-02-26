import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authWithTelegram } from '../services/api'
import { getTelegramInitData, initTelegram } from '../services/telegram'

export const SplashPage = () => {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true

    const bootstrap = async () => {
      try {
        initTelegram()
        const initData = getTelegramInitData()

        const [auth] = await Promise.all([authWithTelegram(initData), new Promise((res) => setTimeout(res, 1200))])

        if (!alive) {
          return
        }

        if (!auth.onboardingCompleted) {
          navigate('/onboarding', { replace: true })
          return
        }

        navigate(auth.hasApi ? '/overview' : '/api-register', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось инициализировать приложение')
      }
    }

    bootstrap()

    return () => {
      alive = false
    }
  }, [navigate])

  return (
    <section className="screen grid place-items-center bg-[#0b0e11] px-6">
      <div className="text-center">
        <motion.div
          className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-3xl border border-white/12 bg-[#4f8cff1f] text-2xl"
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        >
          OKX
        </motion.div>
        <p className="text-sm text-[#9aa3b2]">Загрузка аналитики...</p>
        {error ? <p className="mt-2 text-xs text-[#ea3943]">{error}</p> : null}
      </div>
    </section>
  )
}
