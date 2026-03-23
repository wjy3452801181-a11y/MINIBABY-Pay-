/**
 * Cron Worker — 定期支付执行器
 *
 * 每分钟扫描 recurring_rules 表，找出 next_run_at <= now 且 active=1 的规则，
 * 调用 sendTransfer 广播，写入 payments 记录，更新 next_run_at。
 */
import cronParser from 'cron-parser'
import { ethers } from 'ethers'
import { getDb } from './db'
import { sendTransfer, getUsdcBalance } from './ethers'
import { record } from './metrics'

interface RecurringRule {
  id: number
  stream_id: string
  recipient: string
  amount: number
  currency: string
  cron_expression: string
  memo: string | null
  next_run_at: number | null
}

async function runDueRules() {
  const db = getDb()
  const now = Math.floor(Date.now() / 1000)

  const due = db.prepare(
    `SELECT * FROM recurring_rules WHERE active=1 AND next_run_at <= ? ORDER BY next_run_at ASC`
  ).all(now) as RecurringRule[]

  if (due.length === 0) return

  // 检查 demo 钱包余额（一次查询，所有规则共用）
  const demoAddress = new ethers.Wallet(process.env.DEMO_PRIVATE_KEY!).address
  const walletBalance = await getUsdcBalance(demoAddress)
  console.log(`[cron] ${new Date().toISOString()} — ${due.length} rule(s) due, balance=${walletBalance.toFixed(2)} USDC`)

  for (const rule of due) {
    const logPrefix = `[cron] rule#${rule.id} (${rule.amount} ${rule.currency} → ${rule.recipient.slice(0, 8)}...)`
    try {
      // 余额检查
      if (walletBalance < rule.amount) {
        console.warn(`${logPrefix} SKIPPED: insufficient balance (${walletBalance.toFixed(2)} < ${rule.amount})`)
        continue
      }

      console.log(`${logPrefix} broadcasting...`)
      const txHash = await sendTransfer({ to: rule.recipient, amountUsdc: rule.amount })

      // 写入支付记录
      const streamId = `cron-${rule.id}-${now}`
      const hspMessage = JSON.stringify({
        receiver: rule.recipient,
        amount: String(rule.amount),
        currency: rule.currency,
        stream_id: rule.stream_id !== 'unknown' ? rule.stream_id : streamId,
        memo: rule.memo ?? undefined,
      })
      db.prepare(
        `INSERT INTO payments (stream_id, status, tx_hash, hsp_message) VALUES (?, 'confirmed', ?, ?)`
      ).run(streamId, txHash, hspMessage)

      // 计算下次执行时间
      let nextRunAt: number | null = null
      try {
        const interval = cronParser.parseExpression(rule.cron_expression)
        nextRunAt = Math.floor(interval.next().toDate().getTime() / 1000)
      } catch {
        console.error(`${logPrefix} invalid cron, deactivating rule`)
        db.prepare(`UPDATE recurring_rules SET active=0 WHERE id=?`).run(rule.id)
        continue
      }

      db.prepare(`UPDATE recurring_rules SET next_run_at=? WHERE id=?`).run(nextRunAt, rule.id)
      record({ type: 'cron_exec', success: true })
      console.log(
        `${logPrefix} ✓ tx=${txHash.slice(0, 12)}... next=${new Date(nextRunAt * 1000).toISOString()}`
      )
    } catch (err) {
      record({ type: 'cron_exec', success: false })
      console.error(`${logPrefix} FAILED:`, err)
      // 失败不停止，继续处理其他规则；下次 next_run_at 不变（下一分钟重试）
    }
  }
}

// 导出供 API 手动触发（测试/仪表盘用）
export { runDueRules }

export function startCronWorker() {
  console.log('[cron] worker started — checking every 60s')

  // 立即执行一次，然后每分钟再执行
  runDueRules().catch(err => console.error('[cron] initial run error:', err))

  setInterval(() => {
    runDueRules().catch(err => console.error('[cron] interval error:', err))
  }, 60_000)
}
