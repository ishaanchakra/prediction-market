'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getAuth, signInWithCustomToken } from 'firebase/auth'
import { app } from '@/lib/firebase'

const TOKEN = process.env.NEXT_PUBLIC_DOGFOOD_TOKEN

export default function TestLoginPage() {
  const router = useRouter()
  const [status, setStatus] = useState('Signing in\u2026')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!TOKEN) return

    signInWithCustomToken(getAuth(app), TOKEN)
      .then(() => {
        router.push('/')
      })
      .catch(err => {
        setError(err.message)
      })
  }, [router])

  if (!TOKEN) {
    return <p>Not available.</p>
  }

  if (error) {
    return <p>{error}</p>
  }

  return <p>{status}</p>
}
