import type { ToolResult } from '../lib/claude'

export interface ParsedIntent {
  payment_type: 'one_time' | 'recurring' | 'streaming' | 'cross_border'
  amount: number
  currency: string
  recipient: string
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly'
    day_of_month?: number
    time_utc?: string
  }
  memo?: string
}

export async function parseIntent(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const { payment_type, amount, currency, recipient } = input as Partial<ParsedIntent>

    if (!payment_type || !amount || !currency || !recipient) {
      return { error: true, message: '缺少必要字段：payment_type, amount, currency, recipient' }
    }

    // 验证 recipient 必须是 0x 地址
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      return {
        error: true,
        message: `收款方地址格式无效："${recipient}"。请提供 0x 开头的以太坊钱包地址。`,
      }
    }

    if (amount <= 0) {
      return { error: true, message: '金额必须大于 0' }
    }

    const intent: ParsedIntent = {
      payment_type: payment_type as ParsedIntent['payment_type'],
      amount,
      currency,
      recipient,
      schedule: input.schedule as ParsedIntent['schedule'],
      memo: input.memo as string | undefined,
    }

    return { success: true, intent }
  } catch (err) {
    return { error: true, message: `parse_intent 内部错误: ${String(err)}` }
  }
}
