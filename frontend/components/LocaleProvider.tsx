'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { type Locale, translations } from '@/lib/i18n'

type Translation = (typeof translations)[Locale]

interface LocaleContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translation
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'da',
  setLocale: () => {},
  t: translations.da,
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('da')

  useEffect(() => {
    const stored = localStorage.getItem('klup-locale') as Locale | null
    if (stored === 'da' || stored === 'en') setLocaleState(stored)
  }, [])

  function setLocale(newLocale: Locale) {
    setLocaleState(newLocale)
    localStorage.setItem('klup-locale', newLocale)
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: translations[locale] }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}
