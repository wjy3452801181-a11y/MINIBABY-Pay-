import { useState } from 'react'
import type { ParsedIntent, HspMessage } from '../lib/types'
import { useLocale } from '../lib/LocaleContext'

interface Props {
  intent: ParsedIntent
  hspMessage: HspMessage
  complianceProof: string | null
  cronExpression: string | null
  walletAddress: string | null
  intentStreamId: string   // POST /api/intent 返回的 streamId，用于 DB 更新
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmCard({
  intent,
  hspMessage,
  complianceProof,
  cronExpression,
  walletAddress,
  intentStreamId,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useLocale()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [txError, setTxError] = useState<string | null>(null)
  const [insufficientBalance, setInsufficientBalance] = useState<{ balance: number; required: number } | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)

  const pollReceipt = async (hash: string) => {
    setIsConfirming(true)
    const maxAttempts = 30  // 最多等 60 秒
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const res = await fetch(`/api/execute/receipt/${hash}`)
        const data = await res.json() as { pending?: boolean; status?: string; blockNumber?: string }
        if (!data.pending && data.status === '0x1') {
          setConfirmed(true)
          if (data.blockNumber) setBlockNumber(parseInt(data.blockNumber, 16))
          setIsConfirming(false)
          return
        }
      } catch {
        // 忽略单次查询错误，继续轮询
      }
    }
    setIsConfirming(false)
  }

  const handleConfirm = async () => {
    setIsSubmitting(true)
    setTxError(null)
    setInsufficientBalance(null)

    try {
      const execRes = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId: intentStreamId,
          hspMessage: {
            receiver: hspMessage.receiver,
            amount: hspMessage.amount,
            currency: hspMessage.currency,
            stream_id: hspMessage.stream_id,
          },
        }),
      })
      const execData = await execRes.json()
      if (!execRes.ok) {
        if (execData.error === 'INSUFFICIENT_BALANCE') {
          setInsufficientBalance({ balance: execData.balance, required: execData.required })
        } else {
          throw new Error(execData.message || execData.error || t('txFailed'))
        }
        return
      }

      setTxHash(execData.txHash)
      onConfirm()
      pollReceipt(execData.txHash)
    } catch (err: unknown) {
      const e = err as { message?: string }
      setTxError(e.message || t('txFailed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // 交易已广播（等待确认中 or 已上链）
  if (txHash) {
    return (
      <div className={`bg-hsk-surface border rounded-xl p-6 space-y-4 ${confirmed ? 'border-hsk-green/50' : 'border-hsk-blue/30'}`}>
        <div className="flex items-center gap-3">
          {confirmed ? (
            <div className="w-10 h-10 rounded-full bg-hsk-green/20 flex items-center justify-center text-hsk-green text-xl">
              ✓
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-hsk-blue/10 flex items-center justify-center">
              <span className="inline-block w-5 h-5 border-2 border-hsk-blue/30 border-t-hsk-blue rounded-full animate-spin" />
            </div>
          )}
          <div>
            {confirmed ? (
              <>
                <div className="font-semibold text-hsk-green">{t('txConfirmed')}</div>
                {blockNumber && (
                  <div className="text-xs text-hsk-muted">{t('txBlock')}{blockNumber.toLocaleString()}</div>
                )}
              </>
            ) : isConfirming ? (
              <>
                <div className="font-semibold text-hsk-blue">{t('txWaiting')}</div>
                <div className="text-xs text-hsk-muted">{t('txWaitingDesc')}</div>
              </>
            ) : (
              <>
                <div className="font-semibold text-hsk-text">{t('txBroadcast')}</div>
                <div className="text-xs text-hsk-muted">{t('txChainId')}</div>
              </>
            )}
          </div>
        </div>
        <div className="bg-hsk-dark rounded-lg p-3">
          <div className="text-xs text-hsk-muted mb-1">{t('txHashLabel')}</div>
          <div className="font-mono text-xs text-hsk-blue break-all">{txHash}</div>
        </div>
        <a
          href={`https://testnet-explorer.hsk.xyz/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-hsk-blue hover:underline"
        >
          {t('txViewExplorer')}
        </a>
      </div>
    )
  }

  return (
    <div className="bg-hsk-surface border border-hsk-blue/30 rounded-xl overflow-hidden">
      {/* 头部 */}
      <div className="bg-hsk-blue/10 px-6 py-4 border-b border-hsk-border">
        <div className="flex items-center gap-2">
          <span className="text-lg">📨</span>
          <span className="font-semibold text-hsk-text">{t('hspPaymentTitle')}</span>
          {complianceProof && (
            <span className="ml-auto text-xs bg-hsk-green/20 text-hsk-green px-2 py-0.5 rounded-full font-mono">
              {t('zkidBadge')}
            </span>
          )}
        </div>
        <div className="text-xs text-hsk-muted mt-1 font-mono">
          stream_id: {hspMessage.stream_id.slice(0, 8)}...{hspMessage.stream_id.slice(-4)}
        </div>
      </div>

      {/* 主体 */}
      <div className="px-6 py-5 space-y-4">
        {/* 金额 */}
        <div className="text-center py-3">
          <div className="text-4xl font-bold text-hsk-text">
            {parseFloat(hspMessage.amount).toFixed(2)}
          </div>
          <div className="text-lg text-hsk-muted mt-1">{hspMessage.currency}</div>
          {/* 跨境换算来源行 */}
          {hspMessage.original_currency && hspMessage.original_amount != null && hspMessage.exchange_rate != null && (
            <div className="text-xs text-hsk-muted mt-1.5 bg-hsk-dark rounded-lg px-3 py-1.5 inline-block">
              {hspMessage.original_amount} {hspMessage.original_currency} → {parseFloat(hspMessage.amount).toFixed(2)} USDC
              <span className="mx-1 opacity-50">·</span>
              1 {hspMessage.original_currency} ≈ {hspMessage.exchange_rate.toFixed(4)} USDC
              <span className="mx-1 opacity-50">·</span>
              {hspMessage.exchange_rate_source === 'coingecko' ? 'CoinGecko' : 'fallback'}
            </div>
          )}
        </div>

        {/* 详情 */}
        <div className="space-y-2 text-sm">
          <DetailRow label={t('typeLabel')} value={intent.payment_type === 'recurring' ? t('typeRecurring') : t('typeOnce')} />
          <DetailRow
            label={t('receiverLabel')}
            value={
              <span className="font-mono text-xs">
                {hspMessage.receiver.slice(0, 6)}...{hspMessage.receiver.slice(-4)}
              </span>
            }
          />
          {intent.memo && (
            <DetailRow label={t('memoLabel')} value={intent.memo} />
          )}
          {cronExpression && (
            <DetailRow label={t('frequencyLabel')} value={<span className="font-mono text-xs">{cronExpression}</span>} />
          )}
          <DetailRow label={t('chainLabel')} value={t('chainValue')} />
        </div>

        {/* ZKID proof */}
        {complianceProof && (
          <div className="bg-hsk-green/5 border border-hsk-green/20 rounded-lg p-3">
            <div className="text-xs text-hsk-muted mb-1">{t('complianceLabel')}</div>
            <div className="font-mono text-xs text-hsk-green">{complianceProof}</div>
          </div>
        )}

        {/* 余额不足提示 */}
        {insufficientBalance && (
          <div className="bg-hsk-red/10 border border-hsk-red/30 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-hsk-red font-semibold text-sm">
              <span>⚠️</span>
              <span>{t('insufficientTitle')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-hsk-dark rounded-lg p-2">
                <div className="text-hsk-muted mb-0.5">{t('currentBalance')}</div>
                <div className="text-hsk-red font-mono font-semibold">
                  {insufficientBalance.balance.toFixed(2)} USDC
                </div>
              </div>
              <div className="bg-hsk-dark rounded-lg p-2">
                <div className="text-hsk-muted mb-0.5">{t('requiredAmount')}</div>
                <div className="text-hsk-text font-mono font-semibold">
                  {insufficientBalance.required.toFixed(2)} USDC
                </div>
              </div>
            </div>
            <div className="text-xs text-hsk-muted">
              {t('gap')}<span className="text-hsk-red font-semibold">
                {(insufficientBalance.required - insufficientBalance.balance).toFixed(2)} USDC
              </span>{t('gapSuffix')}
            </div>
          </div>
        )}

        {/* 普通错误提示 */}
        {txError && (
          <div className="bg-hsk-red/10 border border-hsk-red/30 rounded-lg px-3 py-2 text-sm text-hsk-red">
            {txError}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="px-6 pb-5 flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border border-hsk-border text-hsk-muted text-sm hover:border-hsk-red/50 hover:text-hsk-red transition-colors"
        >
          {t('cancelBtn')}
        </button>
        <button
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="flex-1 py-2.5 rounded-lg bg-hsk-blue text-white text-sm font-semibold hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t('broadcastingBtn')}
            </span>
          ) : txError ? (
            t('retryBtn')
          ) : (
            t('confirmBtn')
          )}
        </button>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-hsk-border/50">
      <span className="text-hsk-muted">{label}</span>
      <span className="text-hsk-text text-right">{value}</span>
    </div>
  )
}
