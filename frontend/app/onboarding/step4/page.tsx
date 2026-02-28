'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Onboarding is deprecated. Unauthenticated users are sent to /login.
// Authenticated users are bounced to /watchlists by middleware.
export default function Step4() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/login')
  }, [router])

  // Blank screen while redirect fires
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#102218' }} />
  )
}
