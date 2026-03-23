import { Router, Request, Response } from 'express'
import { sendTransfer, getUsdcBalance, requestPayment, confirmPayment, getHspSimulatorContract, getProviderAsync } from '../lib/ethers'
import { getDb } from '../lib/db'
import { runDueRules } from '../lib/cronWorker'
import { config } from '../lib/config'
import { pushEvent } from './intent'
import { record } from '../lib/metrics'

export const executeRouter = Router()

// demo 钱包余额缓存（5s TTL）— 避免 ConfirmCard 每次点击都打 eth_call
const _balanceCache: Record<string, { balance: number; expiry: number }> = {}

async function getCachedBalance(address: string): Promise<number> {
  const now = Date.now()
  const cached = _balanceCache[address.toLowerCase()]
  if (cached && now < cached.expiry) return cached.balance
  const balance = await getUsdcBalance(address)
  _balanceCache[address.toLowerCase()] = { balance, expiry: now + 5_000 }
  return balance
}

// POST /api/execute — 后端直接用私钥签名广播，返回 tx hash
executeRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { streamId, hspMessage } = req.body as {
      streamId: string
      hspMessage: {
        receiver: string
        amount: string
        currency: string
        stream_id: string
      }
    }

    if (!streamId || !hspMessage) {
      res.status(400).json({ error: '缺少必要参数：streamId, hspMessage' })
      return
    }

    const amountUsdc = parseFloat(hspMessage.amount)
    if (isNaN(amountUsdc) || amountUsdc <= 0) {
      res.status(400).json({ error: '无效金额' })
      return
    }

    // 广播前检查 demo 钱包余额（带 5s 缓存，ConfirmCard 重试时不重复打链）
    const demoAddress = new (await import('ethers')).ethers.Wallet(
      process.env.DEMO_PRIVATE_KEY!
    ).address
    const balance = await getCachedBalance(demoAddress)
    if (balance < amountUsdc) {
      res.status(402).json({
        error: 'INSUFFICIENT_BALANCE',
        message: `余额不足：当前 ${balance.toFixed(2)} USDC，需要 ${amountUsdc.toFixed(2)} USDC`,
        balance,
        required: amountUsdc,
      })
      return
    }

    // 后端直接签名广播
    const txSentAt = Date.now()
    const txHash = await sendTransfer({
      to: hspMessage.receiver,
      amountUsdc,
    })

    // 链上记录：PaymentRequested + Confirmed + Receipt（fire-and-forget，不阻塞响应）
    if (config.hspSimulatorAddress && config.demoPrivateKey) {
      const simAddr = config.hspSimulatorAddress
      const capturedTxHash = txHash
      const capturedStreamId = streamId
      const capturedHspStreamId = hspMessage.stream_id
      const capturedTxSentAt = txSentAt
      requestPayment({
        contractAddress: simAddr,
        streamId: hspMessage.stream_id,
        receiver: hspMessage.receiver,
        amountUsdc,
        currency: hspMessage.currency,
      })
        .then(async (reqTx) => {
          console.log(`[HSPSim] PaymentRequested tx: ${reqTx}`)
          // SSE 推送 requestPayment tx
          pushEvent(capturedStreamId, {
            type: 'hsp_requested',
            req_tx: reqTx,
            explorer_url: `https://testnet-explorer.hsk.xyz/tx/${reqTx}`,
          })
          const provider = await getProviderAsync()
          const receipt = await provider.waitForTransaction(reqTx, 1, 30_000)
          if (!receipt || receipt.status !== 1) {
            throw new Error(`requestPayment tx failed: ${reqTx}`)
          }
          return confirmPayment({
            contractAddress: simAddr,
            streamId: capturedHspStreamId,
            txHash: capturedTxHash,
          })
        })
        .then(confTx => {
          console.log(`[HSPSim] Confirmed+Receipt tx: ${confTx}`)
          record({ type: 'tx_confirmed', confirmMs: Date.now() - capturedTxSentAt })
          // SSE 推送 confirmPayment tx
          pushEvent(capturedStreamId, {
            type: 'hsp_confirmed',
            conf_tx: confTx,
            explorer_url: `https://testnet-explorer.hsk.xyz/tx/${confTx}`,
          })
          // DB 记录两条 tx
          getDb().prepare(
            'UPDATE payments SET req_tx=?, conf_tx=? WHERE stream_id=?'
          ).run(capturedStreamId, confTx, capturedStreamId)
        })
        .catch(err => {
          record({ type: 'tx_failed' })
          console.warn(`[HSPSim] 链上事件写入失败 (stream: ${hspMessage.stream_id}):`, err.message)
          pushEvent(capturedStreamId, {
            type: 'hsp_error',
            message: err.message,
          })
        })
    }

    // 更新 DB
    const db = getDb()
    db.prepare('UPDATE payments SET hsp_message=?, status=?, tx_hash=? WHERE stream_id=?').run(
      JSON.stringify(hspMessage), 'confirmed', txHash, streamId
    )

    res.json({ txHash, streamId })
  } catch (err) {
    console.error('execute error:', err)
    res.status(500).json({ error: `交易失败: ${String(err)}` })
  }
})

// POST /api/execute/confirm — 前端签名后传回 tx hash，更新状态
executeRouter.post('/confirm', (req: Request, res: Response) => {
  try {
    const { streamId, txHash } = req.body as { streamId: string; txHash: string }

    if (!streamId || !txHash) {
      res.status(400).json({ error: '缺少 streamId 或 txHash' })
      return
    }

    const db = getDb()
    db.prepare(
      'UPDATE payments SET status=?, tx_hash=? WHERE stream_id=?'
    ).run('confirmed', txHash, streamId)

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/execute/balance/:address — 查询 USDC 余额
executeRouter.get('/balance/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params
    const balance = await getUsdcBalance(address)
    res.json({ address, balance, currency: 'USDC' })
  } catch (err) {
    res.status(500).json({ error: `余额查询失败: ${String(err)}` })
  }
})

// GET /api/execute/demo-balance — 查询 demo 钱包余额（无需前端钱包连接）
executeRouter.get('/demo-balance', async (_req: Request, res: Response) => {
  try {
    const { ethers } = await import('ethers')
    const address = new ethers.Wallet(process.env.DEMO_PRIVATE_KEY!).address
    const balance = await getUsdcBalance(address)
    res.json({ address, balance, currency: 'USDC' })
  } catch (err) {
    res.status(500).json({ error: `余额查询失败: ${String(err)}` })
  }
})

// GET /api/execute/payment-status/:streamId — 查合约链上状态 + DB tx 记录
executeRouter.get('/payment-status/:streamId', async (req: Request, res: Response) => {
  try {
    const { streamId } = req.params

    // DB 记录：先按 intent stream_id 找，再按 hsp_message.stream_id 找
    const db = getDb()
    let row = db.prepare(
      'SELECT status, tx_hash, req_tx, conf_tx FROM payments WHERE stream_id=?'
    ).get(streamId) as { status: string; tx_hash: string | null; req_tx: string | null; conf_tx: string | null } | undefined

    if (!row) {
      row = db.prepare(
        "SELECT status, tx_hash, req_tx, conf_tx FROM payments WHERE json_extract(hsp_message, '$.stream_id')=?"
      ).get(streamId) as typeof row
    }

    // 合约链上状态（用 hsp_message 里的 stream_id 查）
    let onChain: {
      confirmed: boolean
      sender: string
      receiver: string
      amount: string
      currency: string
      txHash: string
    } | null = null

    if (config.hspSimulatorAddress) {
      try {
        const provider = await getProviderAsync()
        const contract = getHspSimulatorContract(config.hspSimulatorAddress, provider)
        const { ethers } = await import('ethers')
        const streamIdBytes = ethers.zeroPadBytes(ethers.toUtf8Bytes(streamId).slice(0, 32), 32)
        const result = await (contract.getPayment as (s: string) => Promise<[string, string, bigint, string, boolean, string]>)(
          ethers.hexlify(streamIdBytes)
        )
        if (result[0] !== '0x0000000000000000000000000000000000000000') {
          onChain = {
            sender: result[0],
            receiver: result[1],
            amount: (Number(result[2]) / 1_000_000).toFixed(6),
            currency: result[3],
            confirmed: result[4],
            txHash: result[5],
          }
        }
      } catch {
        // 合约查询失败不影响返回
      }
    }

    res.json({
      streamId,
      db: row ?? null,
      onChain,
      explorerBase: 'https://testnet-explorer.hsk.xyz/tx/',
    })
  } catch (err) {
    res.status(500).json({ error: `状态查询失败: ${String(err)}` })
  }
})

// GET /api/status/:streamId — WebSocket 断线降级轮询
executeRouter.get('/status/:streamId', (req: Request, res: Response) => {
  try {
    const { streamId } = req.params
    const db = getDb()
    const row = db.prepare(
      'SELECT status, tx_hash FROM payments WHERE stream_id=?'
    ).get(streamId) as { status: string; tx_hash: string | null } | undefined

    if (!row) {
      res.status(404).json({ error: '未找到该 streamId' })
      return
    }

    res.json({ streamId, status: row.status, tx_hash: row.tx_hash })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/execute/receipt/:txHash — 查询交易收据（上链确认）
executeRouter.get('/receipt/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params
    const rpcUrl = process.env.RPC_URL || 'https://testnet.hsk.xyz'
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1,
      }),
    })
    const data = await response.json() as { result: { status: string; blockNumber: string; blockHash: string } | null }
    if (!data.result) {
      res.json({ pending: true })
      return
    }
    res.json({
      pending: false,
      status: data.result.status,
      blockNumber: data.result.blockNumber,
      blockHash: data.result.blockHash,
    })
  } catch (err) {
    res.status(500).json({ error: `收据查询失败: ${String(err)}` })
  }
})

// GET /api/execute/rules — 获取所有定期规则（仪表盘用）
executeRouter.get('/rules', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const rules = db.prepare(
      'SELECT * FROM recurring_rules WHERE active=1 ORDER BY created_at DESC'
    ).all()
    res.json({ rules })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/execute/history — 获取支付历史（仪表盘用）
executeRouter.get('/history', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT stream_id, status, tx_hash, hsp_message, req_tx, conf_tx, created_at
       FROM payments ORDER BY created_at DESC LIMIT 20`
    ).all() as Array<{
      stream_id: string
      status: string
      tx_hash: string | null
      hsp_message: string | null
      req_tx: string | null
      conf_tx: string | null
      created_at: number
    }>

    const history = rows.map(r => ({
      streamId: r.stream_id,
      status: r.status,
      txHash: r.tx_hash,
      reqTx: r.req_tx,
      confTx: r.conf_tx,
      hspMessage: r.hsp_message ? JSON.parse(r.hsp_message) : null,
      createdAt: new Date(r.created_at * 1000).toISOString(),
    }))

    res.json({ history })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})


executeRouter.post('/cron/trigger', async (_req: Request, res: Response) => {
  try {
    await runDueRules()
    res.json({ ok: true, message: '已扫描并执行到期规则' })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// DELETE /api/execute/rules/:id — 停用定期规则
executeRouter.delete('/rules/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id)
    if (isNaN(id)) { res.status(400).json({ error: '无效 id' }); return }
    const db = getDb()
    db.prepare('UPDATE recurring_rules SET active=0 WHERE id=?').run(id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
