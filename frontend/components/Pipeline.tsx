import type { PipelineStep } from '../lib/types'
import { useLocale } from '../lib/LocaleContext'

interface Props {
  steps: PipelineStep[]
  isRunning: boolean
  hspReqTx?: string | null
  hspConfTx?: string | null
}

const TOOL_ICONS: Record<string, string> = {
  parse_intent: '🔍',
  check_compliance: '🛡',
  build_hsp_message: '📨',
  schedule_recurring: '🔁',
}

const EXPLORER = 'https://testnet-explorer.hsk.xyz/tx/'

function StepIcon({ status }: { status: PipelineStep['status'] }) {
  if (status === 'pending') {
    return (
      <div className="w-8 h-8 rounded-full border-2 border-hsk-border flex items-center justify-center text-hsk-muted text-sm">
        ○
      </div>
    )
  }
  if (status === 'running') {
    return (
      <div className="w-8 h-8 rounded-full border-2 border-hsk-blue flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-hsk-blue animate-pulse-dot" />
      </div>
    )
  }
  if (status === 'done') {
    return (
      <div className="w-8 h-8 rounded-full border-2 border-hsk-green bg-hsk-green/10 flex items-center justify-center text-hsk-green text-sm font-bold">
        ✓
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-full border-2 border-hsk-red bg-hsk-red/10 flex items-center justify-center text-hsk-red text-sm font-bold">
      ✗
    </div>
  )
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a
      href={`${EXPLORER}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-mono text-hsk-blue hover:underline truncate max-w-full"
      title={hash}
    >
      {label}: {hash.slice(0, 10)}...{hash.slice(-6)} ↗
    </a>
  )
}

export default function Pipeline({ steps, isRunning, hspReqTx, hspConfTx }: Props) {
  const { t, locale } = useLocale()

  const TOOL_DESC: Record<string, string> = {
    parse_intent: t('toolParseIntent'),
    check_compliance: t('toolCompliance'),
    build_hsp_message: t('toolBuildHsp'),
    schedule_recurring: t('toolCron'),
  }

  const allTools = ['parse_intent', 'check_compliance', 'build_hsp_message', 'schedule_recurring']
  const shownTools = steps.map(s => s.tool)
  const pendingTools = isRunning
    ? allTools.filter(t => !shownTools.includes(t as PipelineStep['tool']))
    : []

  const displaySteps: Array<PipelineStep> = [
    ...steps,
    ...pendingTools.map(tool => ({
      tool: tool as PipelineStep['tool'],
      label: tool.replace(/_/g, ' '),
      status: 'pending' as const,
    })),
  ]

  if (displaySteps.length === 0 && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-hsk-muted text-sm text-center p-4">
        <div className="text-3xl mb-3 opacity-30">⟳</div>
        <div>{t('toolPipelineTitle')}</div>
        <div className="text-xs mt-1 opacity-60">{t('toolPipelineEmpty')}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0 p-4">
      <div className="text-xs text-hsk-muted uppercase tracking-widest mb-4 font-mono">
        Agent Pipeline
      </div>

      {displaySteps.map((step, i) => (
        <div key={step.tool} className="flex gap-3">
          {/* 左侧：图标 + 竖线 */}
          <div className="flex flex-col items-center">
            <StepIcon status={step.status} />
            {i < displaySteps.length - 1 && (
              <div className="w-0.5 flex-1 min-h-[24px] bg-hsk-border my-1" />
            )}
          </div>

          {/* 右侧：工具信息 */}
          <div className="pb-5 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm">
                {TOOL_ICONS[step.tool] || '🔧'}
              </span>
              <span
                className={`text-sm font-medium ${
                  step.status === 'done'
                    ? 'text-hsk-green'
                    : step.status === 'running'
                    ? 'text-hsk-blue'
                    : step.status === 'error'
                    ? 'text-hsk-red'
                    : 'text-hsk-muted'
                }`}
              >
                {step.label}
              </span>
              {step.status === 'running' && (
                <span className="text-xs text-hsk-blue animate-pulse">{t('toolRunning')}</span>
              )}
            </div>

            <div className="text-xs text-hsk-muted mt-0.5">
              {TOOL_DESC[step.tool]}
            </div>

            {step.status === 'done' && step.result && (
              <ResultSummary tool={step.tool} result={step.result} locale={locale} nextLabel={t('nextRun')} />
            )}

            {/* HSP 链上事件链接：挂在 build_hsp_message 步骤下 */}
            {step.tool === 'build_hsp_message' && step.status === 'done' && (
              <div className="mt-1.5 space-y-1">
                {hspReqTx ? (
                  <div className="bg-hsk-blue/5 border border-hsk-blue/20 rounded px-2 py-1 truncate">
                    <TxLink hash={hspReqTx} label="PaymentRequested" />
                  </div>
                ) : (
                  <div className="text-xs text-hsk-muted/60 italic">
                    {t('hspRequestPending')}
                  </div>
                )}
                {hspConfTx && (
                  <div className="bg-hsk-green/5 border border-hsk-green/20 rounded px-2 py-1 truncate">
                    <TxLink hash={hspConfTx} label="Confirmed+Receipt" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function ResultSummary({
  tool,
  result,
  locale,
  nextLabel,
}: {
  tool: string
  result: Record<string, unknown>
  locale: string
  nextLabel: string
}) {
  if (tool === 'parse_intent') {
    const intent = result.intent as Record<string, unknown> | undefined
    if (!intent) return null
    return (
      <div className="mt-1 text-xs font-mono text-hsk-text/70 bg-hsk-border/30 rounded px-2 py-1">
        {String(intent.payment_type)} · {String(intent.amount)} {String(intent.currency)}
      </div>
    )
  }

  if (tool === 'check_compliance') {
    const proof = result.compliance_proof as string | undefined
    if (!proof) return null
    return (
      <div className="mt-1 text-xs font-mono text-hsk-green/80 bg-hsk-green/10 rounded px-2 py-1">
        {proof}
      </div>
    )
  }

  if (tool === 'build_hsp_message') {
    const msg = result.hsp_message as Record<string, unknown> | undefined
    if (!msg) return null
    return (
      <div className="mt-1 text-xs font-mono text-hsk-blue/80 bg-hsk-blue/10 rounded px-2 py-1 truncate">
        stream_id: {String(msg.stream_id).slice(0, 8)}...{String(msg.stream_id).slice(-4)}
      </div>
    )
  }

  if (tool === 'schedule_recurring') {
    const next = result.next_run_at as string | undefined
    if (!next) return null
    return (
      <div className="mt-1 text-xs font-mono text-hsk-yellow/80 bg-hsk-yellow/10 rounded px-2 py-1">
        {nextLabel} {new Date(next).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US')}
      </div>
    )
  }

  return null
}
