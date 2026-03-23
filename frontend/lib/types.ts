// HSP 工具事件类型（SSE 推送）
export type ToolEventType =
  | 'tool_start'
  | 'tool_done'
  | 'error'
  | 'complete'
  | 'message'
  | 'hsp_requested'
  | 'hsp_confirmed'
  | 'hsp_error'

export interface ToolEvent {
  type: ToolEventType
  tool?: string
  message?: string
  result?: Record<string, unknown>
  timestamp?: number
  // HSP 链上事件
  req_tx?: string
  conf_tx?: string
  explorer_url?: string
}

// 4个工具的名称
export type ToolName =
  | 'parse_intent'
  | 'check_compliance'
  | 'build_hsp_message'
  | 'schedule_recurring'

// Pipeline 步骤状态
export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export interface PipelineStep {
  tool: ToolName
  label: string
  status: StepStatus
  result?: Record<string, unknown>
}

// 解析后的意图
export interface ParsedIntent {
  payment_type: 'one_time' | 'recurring'
  amount: number
  currency: string
  recipient: string
  memo?: string
  schedule?: {
    frequency: string
    day_of_month?: number
    day_of_week?: number
  }
}

// HSP 消息信封
export interface HspMessage {
  msg_type: 'PaymentRequested'
  chain_id: number
  stream_id: string
  receiver: string
  amount: string
  currency: string
  memo?: string
  compliance_proof?: string
  timestamp: string
  // 跨境换算字段（cross_border 类型时由 checkCompliance 填入）
  original_currency?: string
  original_amount?: number
  exchange_rate?: number
  exchange_rate_source?: 'coingecko' | 'fallback'
}

// 无签名 tx payload（传给 MetaMask）
export interface TxPayload {
  from: string
  to: string
  data: string
  value: string
  chainId: number
}

// 支付历史记录
export interface PaymentRecord {
  streamId: string
  status: 'pending' | 'confirmed' | 'failed'
  txHash: string | null
  reqTx: string | null
  confTx: string | null
  hspMessage: HspMessage | null
  createdAt: string
}

// 定期规则
export interface RecurringRule {
  id: number
  stream_id: string
  recipient: string
  amount: number
  currency: string
  cron_expression: string
  memo: string | null
  active: number
  created_at: number
  next_run_at: number | null
}

// 全局 MetaMask 类型扩展
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      isMetaMask?: boolean
    }
  }
}
