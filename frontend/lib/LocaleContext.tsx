import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { translations, type Locale } from './i18n'

interface LocaleContextType {
  locale: Locale
  t: (key: keyof typeof translations.zh) => string
  toggleLocale: () => void
}

const LocaleContext = createContext<LocaleContextType | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('zh')

  const t = useCallback((key: keyof typeof translations.zh): string => {
    return translations[locale][key] as string
  }, [locale])

  const toggleLocale = useCallback(() => {
    setLocale(prev => prev === 'zh' ? 'en' : 'zh')
  }, [])

  return (
    <LocaleContext.Provider value={{ locale, t, toggleLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}
