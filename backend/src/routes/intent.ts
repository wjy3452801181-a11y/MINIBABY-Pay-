import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import Anthropic from '@anthropic-ai/sdk'
import { runIntentLoop } from '../lib/claude'
import { getDb } from '../lib/db'
import { parseIntent } from '../tools/parseIntent'
import { checkCompliance } from '../tools/checkCompliance'
import { buildHspMessage } from '../tools/buildHspMessage'
import { scheduleRecurring } from '../tools/scheduleRecurring'
import { record } from '../lib/metrics'

export const intentRouter = Router()

// 工具定义（Claude tool_use 格式）
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'parse_intent',
    description: '解析自然语言支付指令为结构化意图。Claude 解析 NL 后调用此工具，将提取的字段作为参数传入。',
    input_schema: {
      type: 'object' as const,
      properties: {
        payment_type: { type: 'string', enum: ['one_time', 'recurring', 'streaming', 'cross_border'] },
        amount: { type: 'number' },
        currency: { type: 'string' },
        recipient: { type: 'string', description: 'MVP 要求必须是 0x 开头的以太坊钱包地址' },
        schedule: {
          type: 'object',
          description: '仅 recurring/streaming 时填写',
          properties: {
            frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
            day_of_month: { type: 'integer', description: '1-31，月付时使用' },
            time_utc: { type: 'string', description: 'HH:MM UTC，可选' },
          },
        },
        memo: { type: 'string' },
      },
      required: ['payment_type', 'amount', 'currency', 'recipient'],
    },
  },
  {
    name: 'check_compliance',
    description: '合规检查：KYC/AML 验证，返回 ZKID 证明标签。',
    input_schema: {
      type: 'object' as const,
      properties: {
        recipient: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string' },
      },
      required: ['recipient', 'amount', 'currency'],
    },
  },
  {
    name: 'build_hsp_message',
    description: '生成 HSP PaymentRequested 信封。intent 是 parse_intent 的完整输出加上 compliance_proof。cross_border 类型时必须把 check_compliance 返回的 converted_amount_usdc / original_amount / original_currency / exchange_rate / exchange_rate_source 一并传入。',
    input_schema: {
      type: 'object' as const,
      properties: {
        intent: { type: 'object' },
        compliance_proof: { type: 'string' },
        converted_amount_usdc: { type: 'number', description: 'cross_border 时必填，check_compliance 返回的换算后 USDC 金额' },
        original_amount: { type: 'number', description: '原始外币金额' },
        original_currency: { type: 'string', description: '原始外币币种，如 CNY / HKD / EUR' },
        exchange_rate: { type: 'number', description: '汇率：1 外币 = ? USDC' },
        exchange_rate_source: { type: 'string', description: 'coingecko 或 fallback' },
      },
      required: ['intent', 'compliance_proof'],
    },
  },
  {
    name: 'schedule_recurring',
    description: '持久化定期支付规则到 SQLite。只在 recurring/streaming 类型时调用，one_time 跳过。后端验证 cron 字符串。',
    input_schema: {
      type: 'object' as const,
      properties: {
        intent: { type: 'object' },
        cron_expression: { type: 'string', description: '5字段 cron，例如每月10日 = "0 0 10 * *"' },
        hsp_stream_id: { type: 'string', description: 'build_hsp_message 返回的 hsp_message.stream_id，用于关联链上支付记录' },
      },
      required: ['intent', 'cron_expression'],
    },
  },
]

// 工具调度器
async function executeTool(name: string, input: Record<string, unknown>) {
  switch (name) {
    case 'parse_intent':      return parseIntent(input)
    case 'check_compliance':  return checkCompliance(input)
    case 'build_hsp_message': return buildHspMessage(input)
    case 'schedule_recurring': return scheduleRecurring(input)
    default:
      return { error: true as const, message: `未知工具: ${name}` }
  }
}

// POST /api/intent — 启动意图处理，返回 streamId
intentRouter.post('/', (req: Request, res: Response) => {
  const { message, sender } = req.body as { message?: string; sender?: string }

  if (!message?.trim()) {
    res.status(400).json({ error: '请提供支付指令' })
    return
  }

  const streamId = uuidv4()
  const sseStartTs = Date.now()
  record({ type: 'sse_start' })

  // 写入 payments 表
  const db = getDb()
  db.prepare(
    'INSERT INTO payments (stream_id, status) VALUES (?, ?)'
  ).run(streamId, 'processing')

  res.json({ streamId })

  // 启动 Claude 循环（后台运行，结果通过 SSE 推送）
  // 把 sender 注入到每个需要它的工具调用
  const enrichedMessage = sender
    ? `${message}\n[sender_address: ${sender}]`
    : message

  // 存储事件队列供 SSE 端点消费
  getEventQueue(streamId)  // 初始化队列
  let firstEventRecorded = false

  const TIMEOUT_MS = 30_000
  Promise.race([
    runIntentLoop(enrichedMessage, TOOLS, executeTool, (event) => {
      // 记录首个事件延迟（SSE 性能指标）
      if (!firstEventRecorded) {
        firstEventRecorded = true
        record({ type: 'sse_first_event', latencyMs: Date.now() - sseStartTs })
      }
      pushEvent(streamId, event)
      // 完成或出错时更新 DB
      const e = event as { type: string; result?: { hsp_message?: object } }
      if (e.type === 'complete') {
        db.prepare('UPDATE payments SET status=? WHERE stream_id=?').run('complete', streamId)
      }
      if (e.type === 'error') {
        db.prepare('UPDATE payments SET status=? WHERE stream_id=?').run('error', streamId)
      }
    }),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Claude API 超时（30s）')), TIMEOUT_MS)
    ),
  ]).catch((err: Error) => {
    record({ type: 'sse_error' })
    pushEvent(streamId, { type: 'error', name: 'timeout', message: err.message })
    db.prepare('UPDATE payments SET status=? WHERE stream_id=?').run('error', streamId)
  })
})

// GET /api/intent/stream/:streamId — SSE 长连接，推送工具事件
intentRouter.get('/stream/:streamId', (req: Request, res: Response) => {
  const { streamId } = req.params

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const queue = getEventQueue(streamId)

  // 把已积压的事件立即 flush（SSE 连接可能在事件产生之后才建立）
  for (const event of queue.events.splice(0)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
    if (event.type === 'complete' || event.type === 'error') {
      cleanupQueue(streamId)
      res.end()
      return
    }
  }

  // 注册实时 writer：pushEvent 产生时立即写入，不依赖 setInterval
  queue.writer = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
    if (event.type === 'complete' || event.type === 'error') {
      cleanupQueue(streamId)
      res.end()
    }
  }

  req.on('close', () => {
    queue.writer = undefined
  })
})

// 简单的内存事件队列（hackathon 用内存够了）
// events: SSE 连接建立前积压的事件；writer: 连接建立后立即 flush
interface EventQueue {
  events: Array<Record<string, unknown>>
  writer?: (event: Record<string, unknown>) => void
}
const eventQueues = new Map<string, EventQueue>()

function getEventQueue(streamId: string): EventQueue {
  if (!eventQueues.has(streamId)) {
    eventQueues.set(streamId, { events: [] })
    // 10分钟后自动清理
    setTimeout(() => cleanupQueue(streamId), 10 * 60 * 1000)
  }
  return eventQueues.get(streamId)!
}

export function pushEvent(streamId: string, event: object) {
  const queue = eventQueues.get(streamId)
  if (!queue) return
  const e = event as Record<string, unknown>
  if (queue.writer) {
    queue.writer(e)   // SSE 已连接：直接实时写入
  } else {
    queue.events.push(e)  // SSE 尚未连接：先积压，连接建立时 flush
  }
}

function cleanupQueue(streamId: string) {
  eventQueues.delete(streamId)
}
