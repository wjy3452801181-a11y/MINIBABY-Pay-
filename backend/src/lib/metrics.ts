/**
 * Lightweight in-memory metrics module.
 * Counters reset on process restart (no persistence needed for demo).
 */

export interface MetricsSnapshot {
  sse: {
    total: number
    avgLatencyMs: number
    p95LatencyMs: number
    errors: number
  }
  rpc: {
    primary_ok: number
    failover_count: number
    errors: number
  }
  tx: {
    total: number
    confirmed: number
    failed: number
    avg_confirm_ms: number
  }
  compliance: {
    total: number
    high_risk_blocked: number
    medium_risk_warned: number
    cross_border: number
  }
  cron: {
    executions: number
    success: number
    failed: number
  }
  uptime_seconds: number
  started_at: string
}

// ── Internal state ──────────────────────────────────────────────────────────

const startedAt = new Date()

let sseTotal = 0
const sseLatencies: number[] = []
let sseErrors = 0

let rpcPrimaryOk = 0
let rpcFailoverCount = 0
let rpcErrors = 0

let txTotal = 0
let txConfirmed = 0
let txFailed = 0
const txConfirmMs: number[] = []

let complianceTotal = 0
let complianceHighRiskBlocked = 0
let complianceMediumRiskWarned = 0
let complianceCrossBorder = 0

let cronExecutions = 0
let cronSuccess = 0
let cronFailed = 0

// ── Event types ─────────────────────────────────────────────────────────────

export type MetricEvent =
  | { type: 'sse_start' }
  | { type: 'sse_first_event'; latencyMs: number }
  | { type: 'sse_error' }
  | { type: 'rpc_primary_ok' }
  | { type: 'rpc_failover' }
  | { type: 'rpc_error' }
  | { type: 'tx_sent' }
  | { type: 'tx_confirmed'; confirmMs: number }
  | { type: 'tx_failed' }
  | { type: 'compliance'; risk_level: 'low' | 'medium' | 'high'; cross_border: boolean; blocked: boolean }
  | { type: 'cron_exec'; success: boolean }

// ── record() — call from various modules ────────────────────────────────────

export function record(event: MetricEvent): void {
  switch (event.type) {
    case 'sse_start':
      sseTotal++
      break
    case 'sse_first_event':
      sseLatencies.push(event.latencyMs)
      break
    case 'sse_error':
      sseErrors++
      break
    case 'rpc_primary_ok':
      rpcPrimaryOk++
      break
    case 'rpc_failover':
      rpcFailoverCount++
      break
    case 'rpc_error':
      rpcErrors++
      break
    case 'tx_sent':
      txTotal++
      break
    case 'tx_confirmed':
      txConfirmed++
      txConfirmMs.push(event.confirmMs)
      break
    case 'tx_failed':
      txFailed++
      break
    case 'compliance':
      complianceTotal++
      if (event.blocked) complianceHighRiskBlocked++
      else if (event.risk_level === 'medium') complianceMediumRiskWarned++
      if (event.cross_border) complianceCrossBorder++
      break
    case 'cron_exec':
      cronExecutions++
      if (event.success) cronSuccess++
      else cronFailed++
      break
  }
}

// ── snapshot() ──────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
}

function p95(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.ceil(sorted.length * 0.95) - 1
  return sorted[Math.max(0, idx)]
}

export function snapshot(): MetricsSnapshot {
  return {
    sse: {
      total: sseTotal,
      avgLatencyMs: avg(sseLatencies),
      p95LatencyMs: p95(sseLatencies),
      errors: sseErrors,
    },
    rpc: {
      primary_ok: rpcPrimaryOk,
      failover_count: rpcFailoverCount,
      errors: rpcErrors,
    },
    tx: {
      total: txTotal,
      confirmed: txConfirmed,
      failed: txFailed,
      avg_confirm_ms: avg(txConfirmMs),
    },
    compliance: {
      total: complianceTotal,
      high_risk_blocked: complianceHighRiskBlocked,
      medium_risk_warned: complianceMediumRiskWarned,
      cross_border: complianceCrossBorder,
    },
    cron: {
      executions: cronExecutions,
      success: cronSuccess,
      failed: cronFailed,
    },
    uptime_seconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    started_at: startedAt.toISOString(),
  }
}
