'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/components/LocaleProvider'
import { TextField } from '@/components/TextField'

export function MobileSearchBar() {
  const router = useRouter()
  const { t } = useLocale()
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q) return
    router.push(`/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <form onSubmit={handleSubmit} className="hidden md:block px-4 pt-4 pb-2">
      <div className="relative">
        <span
          className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ fontSize: '18px', color: 'var(--muted-foreground)' }}
        >
          search
        </span>
        <TextField
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t.searchInputPlaceholder}
          className="w-full rounded-xl pl-9 pr-4 py-2.5 text-sm font-medium placeholder:opacity-40"
        />
      </div>
    </form>
  )
}
