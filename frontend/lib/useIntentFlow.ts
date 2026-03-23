import { useCallback, useRef, useState } from 'react'
import type { ToolEvent, PipelineStep, ToolName, HspMessage, ParsedIntent } from './types'

const TOOL_LABELS: Record<ToolName, string> = {
  parse_intent: '解析意图',
  check_compliance: '合规检查',
  build_hsp_message: '构建 HSP 消息',
  schedule_recurring: '设置定期规则',
}

export interface IntentFlowState {
  streamId: string | null
  events: ToolEvent[]
  pipeline: PipelineStep[]
  intent: ParsedIntent | null
  hspMessage: HspMessage | null
  complianceProof: string | null
  cronExpression: string | null
  isRunning: boolean
  isComplete: boolean
  error: string | null
  hspReqTx: string | null
  hspConfTx: string | null
}

export function useIntentFlow() {
  const [state, setState] = useState<IntentFlowState>({
    streamId: null,
    events: [],
    pipeline: [],
    intent: null,
    hspMessage: null,
    complianceProof: null,
    cronExpression: null,
    isRunning: false,
    isComplete: false,
    error: null,
    hspReqTx: null,
    hspConfTx: null,
  })

  const esRef = useRef<EventSource | null>(null)

  const reset = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setState({
      streamId: null,
      events: [],
      pipeline: [],
      intent: null,
      hspMessage: null,
      complianceProof: null,
      cronExpression: null,
      isRunning: false,
      isComplete: false,
      error: null,
      hspReqTx: null,
      hspConfTx: null,
    })
  }, [])

  const run = useCallback(async (userMessage: string) => {
    // 重置
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    setState(s => ({
      ...s,
      events: [],
      pipeline: [],
      intent: null,
      hspMessage: null,
      complianceProof: null,
      cronExpression: null,
      isRunning: true,
      isComplete: false,
      error: null,
    }))

    // Step 1: POST 启动，获取 streamId
    let streamId: string
    try {
      const res = await fetch('/api/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })
      const data = await res.json()
      if (!res.ok || !data.streamId) {
        throw new Error(data.error || '启动失败')
      }
      streamId = data.streamId
      setState(s => ({ ...s, streamId }))
    } catch (err) {
      setState(s => ({
        ...s,
        isRunning: false,
        error: `启动失败: ${String(err)}`,
      }))
      return
    }

    // Step 2: GET SSE 流
    const es = new EventSource(`/api/intent/stream/${streamId}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const event: ToolEvent = JSON.parse(e.data)

        setState(s => {
          const newEvents = [...s.events, event]
          let newPipeline = [...s.pipeline]
          let newIntent = s.intent
          let newHsp = s.hspMessage
          let newProof = s.complianceProof
          let newCron = s.cronExpression
          let newRunning = s.isRunning
          let newComplete = s.isComplete
          let newError = s.error

          if (event.type === 'hsp_requested') {
            return { ...s, events: newEvents, hspReqTx: event.req_tx ?? null }
          }

          if (event.type === 'hsp_confirmed') {
            return { ...s, events: newEvents, hspConfTx: event.conf_tx ?? null }
          }

          if (event.type === 'tool_start' && event.tool) {
            const toolName = event.tool as ToolName
            const exists = newPipeline.find(p => p.tool === toolName)
            if (!exists) {
              newPipeline = [
                ...newPipeline,
                {
                  tool: toolName,
                  label: TOOL_LABELS[toolName] || toolName,
                  status: 'running',
                },
              ]
            } else {
              newPipeline = newPipeline.map(p =>
                p.tool === toolName ? { ...p, status: 'running' } : p
              )
            }
          }

          if (event.type === 'tool_done' && event.tool) {
            const toolName = event.tool as ToolName
            newPipeline = newPipeline.map(p =>
              p.tool === toolName
                ? { ...p, status: 'done', result: event.result }
                : p
            )

            // 提取关键结果
            if (toolName === 'parse_intent' && event.result?.intent) {
              newIntent = event.result.intent as ParsedIntent
            }
            if (toolName === 'check_compliance' && event.result?.compliance_proof) {
              newProof = event.result.compliance_proof as string
            }
            if (toolName === 'build_hsp_message' && event.result?.hsp_message) {
              newHsp = event.result.hsp_message as HspMessage
            }
            if (toolName === 'schedule_recurring' && event.result?.cron_expression) {
              newCron = event.result.cron_expression as string
            }
          }

          if (event.type === 'error') {
            // 标记当前运行中的步骤为 error
            newPipeline = newPipeline.map(p =>
              p.status === 'running' ? { ...p, status: 'error' } : p
            )
            newError = event.message || '工具执行失败'
            newRunning = false
          }

          if (event.type === 'complete') {
            newRunning = false
            newComplete = true
            es.close()
            esRef.current = null
          }

          return {
            ...s,
            events: newEvents,
            pipeline: newPipeline,
            intent: newIntent,
            hspMessage: newHsp,
            complianceProof: newProof,
            cronExpression: newCron,
            isRunning: newRunning,
            isComplete: newComplete,
            error: newError,
          }
        })
      } catch {
        // ignore parse error
      }
    }

    es.onerror = () => {
      setState(s => ({
        ...s,
        isRunning: false,
        error: s.isComplete ? s.error : 'SSE 连接断开',
      }))
      es.close()
      esRef.current = null
    }
  }, [])

  return { state, run, reset }
}
