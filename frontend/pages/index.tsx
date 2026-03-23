import Head from 'next/head'
import { useState, useRef, useEffect } from 'react'
import WalletButton from '../components/WalletButton'
import ChatInput from '../components/ChatInput'
import Pipeline from '../components/Pipeline'
import ConfirmCard from '../components/ConfirmCard'
import Dashboard from '../components/Dashboard'
import { useIntentFlow } from '../lib/useIntentFlow'
import { useLocale } from '../lib/LocaleContext'
import type { ToolEvent } from '../lib/types'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// 移动端 Tab 类型
type MobileTab = 'chat' | 'pipeline' | 'dashboard'

export default function Home() {
  const { t, locale, toggleLocale } = useLocale()
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: 'welcome', role: 'system', content: '', timestamp: Date.now() },
  ])
  const [dashRefresh, setDashRefresh] = useState(0)
  // 桌面端：右栏 pipeline vs dashboard
  const [showDashboard, setShowDashboard] = useState(false)
  // 移动端：底部 Tab
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { state, run, reset } = useIntentFlow()
  const welcomeInitialized = useRef(false)

  useEffect(() => {
    if (!welcomeInitialized.current) {
      setMessages([{ id: 'welcome', role: 'system', content: t('welcomeMessage'), timestamp: Date.now() }])
      welcomeInitialized.current = true
    }
  }, [t])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, state.pipeline])

  const lastEventCount = useRef(0)
  useEffect(() => {
    const newEvents = state.events.slice(lastEventCount.current)
    lastEventCount.current = state.events.length
    newEvents.forEach((event: ToolEvent) => {
      if (event.type === 'message' && event.message) addAssistantMessage(event.message)
    })
    if (state.error) addAssistantMessage(`❌ ${state.error}`)
  }, [state.events, state.error])

  useEffect(() => {
    if (state.isComplete) {
      setDashRefresh(n => n + 1)
      // 移动端：流程完成后自动切到 Chat 显示 ConfirmCard
      setMobileTab('chat')
    }
  }, [state.isComplete])

  // 移动端运行时自动切到 pipeline 看进度
  useEffect(() => {
    if (state.isRunning) setMobileTab('pipeline')
  }, [state.isRunning])

  const addAssistantMessage = (content: string) => {
    setMessages(prev => [...prev, {
      id: `msg-${Date.now()}-${Math.random()}`,
      role: 'assistant', content, timestamp: Date.now(),
    }])
  }

  const handleSubmit = async (message: string) => {
    reset()
    lastEventCount.current = 0
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`, role: 'user', content: message, timestamp: Date.now(),
    }])
    await run(message)
  }

  const handleConfirm = () => {
    addAssistantMessage(t('txSentMessage'))
    setDashRefresh(n => n + 1)
  }

  const handleCancel = () => {
    addAssistantMessage(t('txCanceledMessage'))
    reset()
    lastEventCount.current = 0
  }

  // 桌面端同步 Dashboard 按钮与移动端 Tab
  const handleToggleDashboard = () => {
    setShowDashboard(s => !s)
  }

  const chatContent = (
    <>
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
        {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
        {state.isComplete && state.intent && state.hspMessage && (
          <div className="max-w-md mx-auto sm:mx-0">
            <ConfirmCard
              intent={state.intent}
              hspMessage={state.hspMessage}
              complianceProof={state.complianceProof}
              cronExpression={state.cronExpression}
              walletAddress={walletAddress}
              intentStreamId={state.streamId ?? ''}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="px-4 sm:px-6 pb-4 sm:pb-5 pt-3 border-t border-hsk-border bg-hsk-dark/50 flex-shrink-0">
        <ChatInput onSubmit={handleSubmit} disabled={state.isRunning} />
      </div>
    </>
  )

  return (
    <>
      <Head>
        <title>{t('pageTitle')}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="h-screen flex flex-col bg-hsk-dark text-hsk-text overflow-hidden">
        {/* ── 顶栏 ── */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-3.5 border-b border-hsk-border bg-hsk-surface/50 backdrop-blur flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-hsk-blue/20 flex items-center justify-center text-base flex-shrink-0">
              ⚡
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{t('appTitle')}</div>
              <div className="text-xs text-hsk-muted hidden sm:block">{t('appSubtitle')}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* 语言切换 */}
            <button
              onClick={toggleLocale}
              className="text-xs px-2 py-1 sm:px-2.5 rounded-lg border border-hsk-border text-hsk-muted hover:text-hsk-text hover:border-hsk-blue/50 transition-colors font-mono"
              title={locale === 'zh' ? 'Switch to English' : '切换中文'}
            >
              {locale === 'zh' ? 'EN' : '中'}
            </button>

            {/* 桌面端：Dashboard 切换按钮 */}
            <button
              onClick={handleToggleDashboard}
              className={`hidden sm:block text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                showDashboard
                  ? 'border-hsk-blue text-hsk-blue bg-hsk-blue/10'
                  : 'border-hsk-border text-hsk-muted hover:text-hsk-text'
              }`}
            >
              {t('navDashboard')}
            </button>

            <WalletButton address={walletAddress} onConnect={setWalletAddress} />
          </div>
        </header>

        {/* ── 桌面端双栏布局 (sm+) ── */}
        <div className="hidden sm:flex flex-1 overflow-hidden">
          {/* 左栏：Chat */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {chatContent}
          </div>

          {/* 右栏：Pipeline / Dashboard */}
          <div className="w-80 flex-shrink-0 border-l border-hsk-border bg-hsk-surface/30 overflow-y-auto">
            {showDashboard ? (
              <div className="p-4">
                <Dashboard walletAddress={walletAddress} refreshTrigger={dashRefresh} />
              </div>
            ) : (
              <Pipeline steps={state.pipeline} isRunning={state.isRunning} hspReqTx={state.hspReqTx} hspConfTx={state.hspConfTx} />
            )}
          </div>
        </div>

        {/* ── 移动端单栏 + 底部 Tab Bar ── */}
        <div className="flex sm:hidden flex-1 flex-col overflow-hidden">
          {/* 内容区域 */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {mobileTab === 'chat' && chatContent}
            {mobileTab === 'pipeline' && (
              <div className="flex-1 overflow-y-auto">
                <Pipeline steps={state.pipeline} isRunning={state.isRunning} hspReqTx={state.hspReqTx} hspConfTx={state.hspConfTx} />
              </div>
            )}
            {mobileTab === 'dashboard' && (
              <div className="flex-1 overflow-y-auto p-4">
                <Dashboard walletAddress={walletAddress} refreshTrigger={dashRefresh} />
              </div>
            )}
          </div>

          {/* 底部 Tab Bar */}
          <div className="flex-shrink-0 flex border-t border-hsk-border bg-hsk-surface/80 backdrop-blur">
            <MobileTabBtn
              active={mobileTab === 'chat'}
              onClick={() => setMobileTab('chat')}
              icon="💬"
              label={locale === 'zh' ? '对话' : 'Chat'}
              badge={state.isRunning ? undefined : undefined}
            />
            <MobileTabBtn
              active={mobileTab === 'pipeline'}
              onClick={() => setMobileTab('pipeline')}
              icon="⚙️"
              label={locale === 'zh' ? '流水线' : 'Pipeline'}
              dot={state.isRunning}
            />
            <MobileTabBtn
              active={mobileTab === 'dashboard'}
              onClick={() => setMobileTab('dashboard')}
              icon="📊"
              label={locale === 'zh' ? '仪表盘' : 'Dashboard'}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function MobileTabBtn({
  active, onClick, icon, label, dot,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
  dot?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors relative ${
        active ? 'text-hsk-blue' : 'text-hsk-muted'
      }`}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
      {dot && (
        <span className="absolute top-2 right-1/4 w-2 h-2 rounded-full bg-hsk-blue animate-pulse-dot" />
      )}
    </button>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="max-w-lg w-full bg-hsk-surface/60 border border-hsk-border rounded-xl px-4 sm:px-5 py-3 sm:py-4 text-sm text-hsk-muted whitespace-pre-line">
          {message.content}
        </div>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-sm bg-hsk-blue text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="flex gap-2 sm:gap-3 max-w-[90%] sm:max-w-lg">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-hsk-blue/20 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
          ⚡
        </div>
        <div className="bg-hsk-surface border border-hsk-border rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-hsk-text whitespace-pre-line">
          {message.content}
        </div>
      </div>
    </div>
  )
}
