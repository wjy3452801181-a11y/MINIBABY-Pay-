import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseIntent } from '../tools/parseIntent'
import { checkCompliance } from '../tools/checkCompliance'
import { buildHspMessage } from '../tools/buildHspMessage'
import { scheduleRecurring } from '../tools/scheduleRecurring'
import { buildTransferPayload } from '../lib/ethers'

// Mock SQLite（测试不需要真实数据库）
vi.mock('../lib/db', () => ({
  getDb: () => ({
    prepare: () => ({ run: vi.fn() }),
  }),
}))

// ─── parseIntent ─────────────────────────────────────────────
describe('parseIntent', () => {
  it('有效 recurring 意图 → 返回结构化 JSON', async () => {
    const result = await parseIntent({
      payment_type: 'recurring',
      amount: 50,
      currency: 'USDC',
      recipient: '0x4a2f1234567890abcdef1234567890abcdef1234',
      schedule: { frequency: 'monthly', day_of_month: 10 },
      memo: '瑜伽课程费',
    })
    expect(result).toMatchObject({ success: true })
    expect((result as any).intent.amount).toBe(50)
    expect((result as any).intent.payment_type).toBe('recurring')
  })

  it('recipient 不是 0x 地址 → 返回错误', async () => {
    const result = await parseIntent({
      payment_type: 'one_time',
      amount: 50,
      currency: 'USDC',
      recipient: '我的瑜伽教练',
    })
    expect(result).toMatchObject({ error: true })
    expect((result as any).message).toContain('钱包地址')
  })

  it('金额为 0 → 返回错误', async () => {
    const result = await parseIntent({
      payment_type: 'one_time',
      amount: 0,
      currency: 'USDC',
      recipient: '0x4a2f1234567890abcdef1234567890abcdef1234',
    })
    expect(result).toMatchObject({ error: true })
  })

  it('缺少必要字段 → 返回错误', async () => {
    const result = await parseIntent({ amount: 50 })
    expect(result).toMatchObject({ error: true })
  })
})

// ─── checkCompliance ─────────────────────────────────────────
describe('checkCompliance', () => {
  it('返回合规通过 + ZKID proof 标签', async () => {
    const result = await checkCompliance({
      recipient: '0x4a2f1234567890abcdef1234567890abcdef1234',
      amount: 50,
      currency: 'USDC',
    })
    expect(result).toMatchObject({ success: true, verified: true })
    expect((result as any).compliance_proof).toMatch(/^ZKID-MOCK-VERIFIED-/)
  })

  it('相同输入 → 相同 proof（确定性）', async () => {
    const input = { recipient: '0xabc', amount: 100, currency: 'USDC' }
    const r1 = await checkCompliance(input)
    const r2 = await checkCompliance(input)
    expect((r1 as any).compliance_proof).toBe((r2 as any).compliance_proof)
  })
})

// ─── buildHspMessage ─────────────────────────────────────────
describe('buildHspMessage', () => {
  it('生成含 UUID stream_id 的 PaymentRequested 信封', async () => {
    const result = await buildHspMessage({
      intent: {
        payment_type: 'one_time',
        amount: 50,
        currency: 'USDC',
        recipient: '0x4a2f1234567890abcdef1234567890abcdef1234',
      },
      compliance_proof: 'ZKID-MOCK-VERIFIED-ABCD1234',
    })
    expect(result).toMatchObject({ success: true })
    const msg = (result as any).hsp_message
    expect(msg.msg_type).toBe('PaymentRequested')
    expect(msg.chain_id).toBe(133)
    expect(msg.stream_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })
})

// ─── scheduleRecurring ────────────────────────────────────────
describe('scheduleRecurring', () => {
  it('有效 cron → 写入 SQLite，返回 next_run_at', async () => {
    const result = await scheduleRecurring({
      intent: {
        payment_type: 'recurring',
        amount: 50,
        currency: 'USDC',
        recipient: '0x4a2f1234567890abcdef1234567890abcdef1234',
        stream_id: 'test-stream-id',
      },
      cron_expression: '0 0 10 * *',
    })
    expect(result).toMatchObject({ success: true })
    expect((result as any).next_run_at).toBeDefined()
  })

  it('无效 cron 字符串 → 返回错误', async () => {
    const result = await scheduleRecurring({
      intent: { payment_type: 'recurring', amount: 50, currency: 'USDC', recipient: '0xabc' },
      cron_expression: 'not-a-cron',
    })
    expect(result).toMatchObject({ error: true })
    expect((result as any).message).toContain('cron')
  })
})

// ─── buildTransferPayload (calldata 编码) ─────────────────────
describe('buildTransferPayload', () => {
  it('50 USDC → calldata 包含 50_000_000（6位小数）', async () => {
    const payload = await buildTransferPayload({
      from: '0xef724df77c65affc8c3a67ae0db0add344f607b3',
      to: '0x4a2f1234567890abcdef1234567890abcdef1234',
      amountUsdc: 50,
    })
    // 50 * 1e6 = 50_000_000 = 0x2FAF080
    expect(payload.data).toContain('2faf080')
    expect(payload.chainId).toBe(133)
    expect(payload.value).toBe('0x0')
  })

  it('0.01 USDC → calldata 包含 10000（边界值）', async () => {
    const payload = await buildTransferPayload({
      from: '0xef724df77c65affc8c3a67ae0db0add344f607b3',
      to: '0x4a2f1234567890abcdef1234567890abcdef1234',
      amountUsdc: 0.01,
    })
    // 0.01 * 1e6 = 10000 = 0x2710
    expect(payload.data).toContain('2710')
  })
})
