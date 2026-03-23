import { useEffect, useState, useCallback } from 'react'
import type { PaymentRecord, RecurringRule } from '../lib/types'
import { useLocale } from '../lib/LocaleContext'

interface MetricsSnapshot {
  sse: { total: number; avgLatencyMs: number; p95LatencyMs: number; errors: number }
  rpc: { primary_ok: number; failover_count: number; errors: number }
  tx: { total: number; confirmed: number; failed: number; avg_confirm_ms: number }
  compliance: { total: number; high_risk_blocked: number; medium_risk_warned: number; cross_border: number }
  cron: { executions: number; success: number; failed: number }
  uptime_seconds: number
  started_at: string
}

interface DashboardProps {
  walletAddress: string | null
  refreshTrigger?: number
}

export default function Dashboard({ walletAddress, refreshTrigger }: DashboardProps) {
  const { t, locale } = useLocale()
  const [userBalance, setUserBalance] = useState<string | null>(null)
  const [demoBalance, setDemoBalance] = useState<number | null>(null)
  const [demoAddress, setDemoAddress] = useState<string | null>(null)
  const [history, setHistory] = useState<PaymentRecord[]>([])
  const [rules, setRules] = useState<RecurringRule[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'history' | 'rules' | 'monitor'>('history')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [histRes, rulesRes, demoRes] = await Promise.all([
        fetch('/api/execute/history'),
        fetch('/api/execute/rules'),
        fetch('/api/execute/demo-balance'),
      ])
      if (histRes.ok) setHistory((await histRes.json()).history || [])
      if (rulesRes.ok) setRules((await rulesRes.json()).rules || [])
      if (demoRes.ok) {
        const d = await demoRes.json()
        setDemoBalance(d.balance)
        setDemoAddress(d.address)
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  const fetchUserBalance = useCallback(async () => {
    if (!walletAddress) return
    try {
      const res = await fetch(`/api/execute/balance/${walletAddress}`)
      if (res.ok) setUserBalance((await res.json()).balance)
    } catch { /* ignore */ }
  }, [walletAddress])

  useEffect(() => { fetchAll() }, [fetchAll, refreshTrigger])
  useEffect(() => { fetchUserBalance() }, [fetchUserBalance, refreshTrigger])

  return (
    <div className="flex flex-col gap-4">
      {/* 余额卡片 */}
      <div className="bg-hsk-surface border border-hsk-border rounded-xl p-5 space-y-3">
        <div className="text-xs text-hsk-muted uppercase tracking-widest">{t('balanceTitle')}</div>

        {/* Demo 钱包（始终显示） */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-hsk-text">
              {demoBalance !== null ? (
                <>
                  <span className={demoBalance < 10 ? 'text-hsk-red' : ''}>{demoBalance.toFixed(2)}</span>
                  <span className="text-base text-hsk-muted ml-2">USDC</span>
                </>
              ) : (
                <span className="text-hsk-muted text-base">{t('loadingBalance')}</span>
              )}
            </div>
            <div className="text-xs text-hsk-muted mt-1 font-mono">
              {t('demoWallet')}
              {demoAddress && <> · {demoAddress.slice(0, 6)}...{demoAddress.slice(-4)}</>}
            </div>
          </div>
          {demoBalance !== null && demoBalance < 10 && (
            <span className="text-xs bg-hsk-red/10 text-hsk-red border border-hsk-red/30 px-2 py-1 rounded-lg">
              {t('balanceLow')}
            </span>
          )}
        </div>

        {/* 已连接用户钱包 */}
        {walletAddress && (
          <div className="pt-2 border-t border-hsk-border/50 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-hsk-text">
                {userBalance !== null ? `${parseFloat(userBalance).toFixed(2)} USDC` : t('loadingBalance')}
              </div>
              <div className="text-xs text-hsk-muted font-mono mt-0.5">
                {t('connected')} · {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </div>
            </div>
            <div className="w-2 h-2 rounded-full bg-hsk-green animate-pulse-dot" />
          </div>
        )}
      </div>

      {/* 历史 / 规则 */}
      <div className="bg-hsk-surface border border-hsk-border rounded-xl overflow-hidden">
        <div className="flex border-b border-hsk-border">
          <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} count={history.length}>
            {t('tabHistory')}
          </TabButton>
          <TabButton active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} count={rules.length}>
            {t('tabRules')}
          </TabButton>
          <TabButton active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} count={0}>
            {t('tabMonitor')}
          </TabButton>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="ml-auto px-4 text-hsk-muted hover:text-hsk-text transition-colors text-xs"
          >
            {loading ? t('refreshing') : t('refresh')}
          </button>
        </div>

        {activeTab === 'history' ? (
          <HistoryList records={history} locale={locale} />
        ) : activeTab === 'rules' ? (
          <RulesList rules={rules} onRun={fetchAll} locale={locale} />
        ) : (
          <MonitorTab />
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children, count }: {
  active: boolean; onClick: () => void; children: React.ReactNode; count: number
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
        active ? 'border-hsk-blue text-hsk-blue' : 'border-transparent text-hsk-muted hover:text-hsk-text'
      }`}
    >
      {children}
      {count > 0 && (
        <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
          active ? 'bg-hsk-blue/20 text-hsk-blue' : 'bg-hsk-border text-hsk-muted'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

function HistoryList({ records, locale }: { records: PaymentRecord[]; locale: string }) {
  const { t } = useLocale()

  if (records.length === 0) {
    return <div className="p-6 text-center text-hsk-muted text-sm">{t('noHistory')}</div>
  }

  return (
    <div className="divide-y divide-hsk-border">
      {records.map(r => (
        <div key={r.streamId} className="px-4 py-3 flex items-start gap-3">
          <StatusBadge status={r.status} />
          <div className="flex-1 min-w-0">
            {r.hspMessage ? (
              <>
                <div className="text-sm font-semibold text-hsk-text">
                  {parseFloat(r.hspMessage.amount).toFixed(2)}{' '}
                  <span className="font-normal text-hsk-muted">{r.hspMessage.currency}</span>
                </div>
                <div className="text-xs text-hsk-muted font-mono mt-0.5">
                  → {r.hspMessage.receiver.slice(0, 6)}...{r.hspMessage.receiver.slice(-4)}
                </div>
                {r.hspMessage.memo && (
                  <div className="text-xs text-hsk-muted mt-0.5 truncate">{t('memo')} {r.hspMessage.memo}</div>
                )}
              </>
            ) : (
              <div className="text-xs text-hsk-muted font-mono">{r.streamId.slice(0, 12)}...</div>
            )}
            {/* HSP 链上事件 tx */}
            <div className="mt-1 space-y-0.5">
              {r.reqTx && (
                <a href={`https://testnet-explorer.hsk.xyz/tx/${r.reqTx}`} target="_blank" rel="noopener noreferrer"
                  className="block text-xs font-mono text-hsk-blue/70 hover:text-hsk-blue hover:underline truncate">
                  ⬡ PaymentRequested ↗
                </a>
              )}
              {r.confTx && (
                <a href={`https://testnet-explorer.hsk.xyz/tx/${r.confTx}`} target="_blank" rel="noopener noreferrer"
                  className="block text-xs font-mono text-hsk-green/70 hover:text-hsk-green hover:underline truncate">
                  ✓ Confirmed+Receipt ↗
                </a>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0 space-y-0.5">
            <div className="text-xs text-hsk-muted">
              {new Date(r.createdAt).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US')}
            </div>
            {r.txHash ? (
              <a
                href={`https://testnet-explorer.hsk.xyz/tx/${r.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-hsk-blue hover:underline font-mono"
                title={r.txHash}
              >
                {r.txHash.slice(0, 8)}...{r.txHash.slice(-4)} ↗
              </a>
            ) : (
              <div className="text-xs text-hsk-muted font-mono">—</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function RulesList({ rules, onRun, locale }: { rules: RecurringRule[]; onRun: () => void; locale: string }) {
  const { t } = useLocale()
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [chainStatus, setChainStatus] = useState<Record<string, {
    loading: boolean
    confirmed?: boolean
    txHash?: string
    confTx?: string
    reqTx?: string
    error?: string
  }>>({})

  const triggerNow = async () => {
    setRunning(true)
    setRunMsg(null)
    try {
      const res = await fetch('/api/execute/cron/trigger', { method: 'POST' })
      const d = await res.json()
      setRunMsg(d.message || t('triggered'))
      onRun()
    } catch {
      setRunMsg(t('triggerFailed'))
    } finally {
      setRunning(false)
    }
  }

  const deleteRule = async (id: number) => {
    if (!confirm(t('confirmDeactivate'))) return
    setDeleting(id)
    try {
      await fetch(`/api/execute/rules/${id}`, { method: 'DELETE' })
      onRun()
    } finally {
      setDeleting(null)
    }
  }

  const queryChainStatus = async (streamId: string) => {
    setChainStatus(s => ({ ...s, [streamId]: { loading: true } }))
    try {
      const res = await fetch(`/api/execute/payment-status/${streamId}`)
      const data = await res.json()
      const db = data.db as { status?: string; tx_hash?: string; req_tx?: string; conf_tx?: string } | null
      const onChain = data.onChain as { confirmed?: boolean; txHash?: string } | null
      setChainStatus(s => ({
        ...s,
        [streamId]: {
          loading: false,
          confirmed: onChain?.confirmed ?? (db?.status === 'confirmed' ? true : undefined),
          txHash: db?.tx_hash ?? undefined,
          reqTx: db?.req_tx ?? undefined,
          confTx: db?.conf_tx ?? undefined,
        },
      }))
    } catch {
      setChainStatus(s => ({ ...s, [streamId]: { loading: false, error: t('queryChainFailed') } }))
    }
  }

  if (rules.length === 0) {
    return <div className="p-6 text-center text-hsk-muted text-sm">{t('noRules')}</div>
  }

  return (
    <div>
      <div className="divide-y divide-hsk-border">
        {rules.map(r => {
          const cs = chainStatus[r.stream_id]
          return (
            <div key={r.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🔁</span>
                    <span className="text-sm font-semibold text-hsk-text">
                      {r.amount.toFixed(2)} <span className="font-normal text-hsk-muted">{r.currency}</span>
                    </span>
                    <span className="font-mono text-xs text-hsk-muted bg-hsk-border/50 px-1.5 py-0.5 rounded">
                      {r.cron_expression}
                    </span>
                  </div>
                  <div className="text-xs text-hsk-muted mt-1 font-mono">
                    → {r.recipient.slice(0, 6)}...{r.recipient.slice(-4)}
                  </div>
                  {r.memo && (
                    <div className="text-xs text-hsk-muted mt-0.5 truncate">{t('memo')} {r.memo}</div>
                  )}
                  {r.next_run_at && (
                    <div className="text-xs text-hsk-yellow/80 mt-1">
                      {t('nextRun')} {new Date(r.next_run_at * 1000).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}
                    </div>
                  )}

                  {/* 链上状态展开区 */}
                  <div className="mt-1.5">
                    {!cs ? (
                      <button
                        onClick={() => queryChainStatus(r.stream_id)}
                        className="text-xs text-hsk-blue/70 hover:text-hsk-blue underline-offset-2 hover:underline"
                      >
                        {t('queryChainStatus')}
                      </button>
                    ) : cs.loading ? (
                      <span className="text-xs text-hsk-muted italic">{t('queryingChain')}</span>
                    ) : cs.error ? (
                      <span className="text-xs text-hsk-red">{cs.error}</span>
                    ) : (
                      <div className="space-y-0.5">
                        <div className={`text-xs font-semibold ${cs.confirmed ? 'text-hsk-green' : 'text-hsk-muted'}`}>
                          {cs.confirmed ? t('chainConfirmed') : t('chainUnconfirmed')}
                        </div>
                        {cs.reqTx && (
                          <a href={`https://testnet-explorer.hsk.xyz/tx/${cs.reqTx}`} target="_blank" rel="noopener noreferrer"
                            className="block text-xs font-mono text-hsk-blue/70 hover:text-hsk-blue hover:underline truncate">
                            ⬡ PaymentRequested ↗
                          </a>
                        )}
                        {cs.confTx && (
                          <a href={`https://testnet-explorer.hsk.xyz/tx/${cs.confTx}`} target="_blank" rel="noopener noreferrer"
                            className="block text-xs font-mono text-hsk-green/70 hover:text-hsk-green hover:underline truncate">
                            ✓ Confirmed+Receipt ↗
                          </a>
                        )}
                        {!cs.reqTx && !cs.confTx && cs.txHash && (
                          <a href={`https://testnet-explorer.hsk.xyz/tx/${cs.txHash}`} target="_blank" rel="noopener noreferrer"
                            className="block text-xs font-mono text-hsk-green/70 hover:text-hsk-green hover:underline truncate">
                            ✓ USDC Transfer ↗
                          </a>
                        )}
                        <button
                          onClick={() => queryChainStatus(r.stream_id)}
                          className="text-xs text-hsk-muted hover:text-hsk-text underline-offset-2 hover:underline"
                        >
                          {t('refresh')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteRule(r.id)}
                  disabled={deleting === r.id}
                  title={t('deactivateRule')}
                  className="flex-shrink-0 text-hsk-muted hover:text-hsk-red transition-colors text-sm disabled:opacity-40 mt-0.5"
                >
                  {deleting === r.id ? '...' : '✕'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-4 py-3 border-t border-hsk-border flex items-center gap-3">
        <button
          onClick={triggerNow}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-lg bg-hsk-blue/10 text-hsk-blue border border-hsk-blue/30 hover:bg-hsk-blue/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? t('triggering') : t('triggerNow')}
        </button>
        {runMsg && <span className="text-xs text-hsk-green">{runMsg}</span>}
      </div>
    </div>
  )
}

function MonitorTab() {
  const { t } = useLocale()
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/metrics')
      if (res.ok) setMetrics(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 30_000)
    return () => clearInterval(interval)
  }, [fetchMetrics])

  const fmtUptime = (secs: number) => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  if (!metrics) {
    return (
      <div className="p-6 text-center text-hsk-muted text-sm">
        {loading ? t('monitorRefreshing') : '—'}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {/* SSE */}
      <MetricCard title={t('monitorSse')}>
        <MetricRow label="总请求" value={String(metrics.sse.total)} />
        <MetricRow label="平均延迟" value={`${metrics.sse.avgLatencyMs}ms`} />
        <MetricRow label="P95" value={`${metrics.sse.p95LatencyMs}ms`} />
        <MetricRow label="错误" value={String(metrics.sse.errors)} warn={metrics.sse.errors > 0} />
      </MetricCard>

      {/* TX */}
      <MetricCard title={t('monitorTx')}>
        <MetricRow label="总计" value={String(metrics.tx.total)} />
        <MetricRow label="✅ 已确认" value={String(metrics.tx.confirmed)} />
        <MetricRow label="❌ 失败" value={String(metrics.tx.failed)} warn={metrics.tx.failed > 0} />
        <MetricRow label="平均确认" value={metrics.tx.avg_confirm_ms > 0 ? `${(metrics.tx.avg_confirm_ms / 1000).toFixed(1)}s` : '—'} />
      </MetricCard>

      {/* RPC */}
      <MetricCard title={t('monitorRpc')}>
        <MetricRow label="主节点 OK" value={String(metrics.rpc.primary_ok)} />
        <MetricRow label="Failover" value={String(metrics.rpc.failover_count)} warn={metrics.rpc.failover_count > 0} />
        <MetricRow label="错误" value={String(metrics.rpc.errors)} warn={metrics.rpc.errors > 0} />
      </MetricCard>

      {/* Compliance */}
      <MetricCard title={t('monitorCompliance')}>
        <MetricRow label="总计" value={String(metrics.compliance.total)} />
        <MetricRow label="高风险拦截" value={String(metrics.compliance.high_risk_blocked)} warn={metrics.compliance.high_risk_blocked > 0} />
        <MetricRow label="中风险警告" value={String(metrics.compliance.medium_risk_warned)} />
        <MetricRow label="跨境换汇" value={String(metrics.compliance.cross_border)} />
      </MetricCard>

      {/* System */}
      <MetricCard title={t('monitorUptime')}>
        <MetricRow label="运行时间" value={fmtUptime(metrics.uptime_seconds)} />
        <MetricRow label="Cron 执行" value={String(metrics.cron.executions)} />
        <MetricRow label="Cron 失败" value={String(metrics.cron.failed)} warn={metrics.cron.failed > 0} />
        <MetricRow
          label="启动时间"
          value={new Date(metrics.started_at).toLocaleTimeString()}
        />
      </MetricCard>

      <div className="text-xs text-hsk-muted text-right">
        {loading ? t('monitorRefreshing') : '自动刷新 · 30s'}
      </div>
    </div>
  )
}

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-hsk-border rounded-lg p-3">
      <div className="text-xs font-semibold text-hsk-muted uppercase tracking-wider mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">{children}</div>
    </div>
  )
}

function MetricRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <span className="text-xs text-hsk-muted">{label}</span>
      <span className={`text-xs font-mono font-semibold text-right ${warn ? 'text-hsk-red' : 'text-hsk-text'}`}>
        {value}
      </span>
    </>
  )
}

function StatusBadge({ status }: { status: PaymentRecord['status'] }) {
  const { t } = useLocale()
  const styles = {
    confirmed: 'bg-hsk-green/15 text-hsk-green',
    pending: 'bg-hsk-yellow/15 text-hsk-yellow',
    failed: 'bg-hsk-red/15 text-hsk-red',
  }
  const labels = {
    confirmed: t('statusConfirmed'),
    pending: t('statusPending'),
    failed: t('statusFailed'),
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}
