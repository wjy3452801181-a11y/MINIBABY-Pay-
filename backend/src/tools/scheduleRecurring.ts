import cronParser from 'cron-parser'
import { getDb } from '../lib/db'
import type { ToolResult } from '../lib/claude'
import type { ParsedIntent } from './parseIntent'

export async function scheduleRecurring(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const { intent, cron_expression, hsp_stream_id } = input as {
      intent: ParsedIntent & { stream_id?: string }
      cron_expression: string
      hsp_stream_id?: string
    }

    if (!intent || !cron_expression) {
      return { error: true, message: '缺少必要字段：intent, cron_expression' }
    }

    // 验证 cron 表达式
    let nextRunAt: number
    try {
      const interval = cronParser.parseExpression(cron_expression)
      nextRunAt = Math.floor(interval.next().toDate().getTime() / 1000)
    } catch {
      return {
        error: true,
        message: `无效的 cron 表达式："${cron_expression}"。示例：每月10日 = "0 0 10 * *"`,
      }
    }

    // SQLite 写入（try/catch 防止磁盘满等意外）
    try {
      const db = getDb()
      // node:sqlite 使用 prepare + run with positional params
      const stmt = db.prepare(`
        INSERT INTO recurring_rules
          (stream_id, recipient, amount, currency, cron_expression, memo, next_run_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      stmt.run(
        hsp_stream_id ?? intent.stream_id ?? 'unknown',
        intent.recipient,
        intent.amount,
        intent.currency ?? 'USDC',
        cron_expression,
        intent.memo ?? null,
        nextRunAt,
      )
    } catch (dbErr) {
      return {
        error: true,
        message: `规则保存失败: ${String(dbErr)}`,
      }
    }

    return {
      success: true,
      cron_expression,
      next_run_at: new Date(nextRunAt * 1000).toISOString(),
      message: `定期规则已创建，下次执行：${new Date(nextRunAt * 1000).toLocaleDateString('zh-CN')}`,
    }
  } catch (err) {
    return { error: true, message: `schedule_recurring 内部错误: ${String(err)}` }
  }
}
