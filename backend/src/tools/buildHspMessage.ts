import { v4 as uuidv4 } from 'uuid'
import type { ToolResult } from '../lib/claude'
import type { ParsedIntent } from './parseIntent'

export interface HspMessage {
  msg_type: 'PaymentRequested'
  stream_id: string
  sender: string        // 由前端传入，注入到 intent 里
  receiver: string
  amount: string
  currency: string
  chain_id: 133
  compliance_proof: string
  memo: string | null
  schedule: ParsedIntent['schedule'] | null
  timestamp_utc: string
  // 跨境换算字段（cross_border 类型时透传）
  original_currency?: string
  original_amount?: number
  exchange_rate?: number
  exchange_rate_source?: string
}

export async function buildHspMessage(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const { intent, compliance_proof } = input as {
      intent: ParsedIntent & { sender?: string }
      compliance_proof: string
    }

    if (!intent || !compliance_proof) {
      return { error: true, message: '缺少必要字段：intent, compliance_proof' }
    }

    const convertedAmountUsdc = input.converted_amount_usdc as number | undefined
    const originalCurrency = input.original_currency as string | undefined
    const originalAmount = input.original_amount as number | undefined
    const exchangeRate = input.exchange_rate as number | undefined
    const exchangeRateSource = input.exchange_rate_source as string | undefined

    const hspMessage: HspMessage = {
      msg_type: 'PaymentRequested',
      stream_id: uuidv4(),
      sender: intent.sender ?? 'unknown',
      receiver: intent.recipient,
      // 跨境场景：用换算后的 USDC 金额
      amount: convertedAmountUsdc?.toString() ?? intent.amount.toString(),
      currency: convertedAmountUsdc != null ? 'USDC' : (intent.currency ?? 'USDC'),
      chain_id: 133,
      compliance_proof,
      memo: intent.memo ?? null,
      schedule: intent.schedule ?? null,
      timestamp_utc: new Date().toISOString(),
      // 透传跨境换算元数据
      ...(originalCurrency && {
        original_currency: originalCurrency,
        original_amount: originalAmount,
        exchange_rate: exchangeRate,
        exchange_rate_source: exchangeRateSource,
      }),
    }

    return { success: true, hsp_message: hspMessage }
  } catch (err) {
    return { error: true, message: `build_hsp_message 内部错误: ${String(err)}` }
  }
}

