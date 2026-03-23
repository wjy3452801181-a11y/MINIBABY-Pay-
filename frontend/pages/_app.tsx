import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import '../styles/globals.css'
import { LocaleProvider } from '../lib/LocaleContext'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // 过滤来自浏览器扩展的错误，防止触发 Next.js 错误覆盖层
    const handler = (event: ErrorEvent) => {
      if (event.filename?.startsWith('chrome-extension://')) {
        event.stopImmediatePropagation()
        event.preventDefault()
      }
    }
    window.addEventListener('error', handler, true)
    return () => window.removeEventListener('error', handler, true)
  }, [])

  return (
    <LocaleProvider>
      <Component {...pageProps} />
    </LocaleProvider>
  )
}
