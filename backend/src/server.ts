import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { validateEnv, config } from './lib/config'
import { intentRouter } from './routes/intent'
import { executeRouter } from './routes/execute'
import { startCronWorker } from './lib/cronWorker'
import { snapshot } from './lib/metrics'
import { benchmarkRpc } from './lib/ethers'
import { warmupClaude } from './lib/claude'

// 启动时验证环境变量
validateEnv()

const app = express()

app.use(cors({ origin: 'http://localhost:3000' }))
app.use(express.json())

// 路由
app.use('/api/intent', intentRouter)
app.use('/api/execute', executeRouter)

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ ok: true, chain: 'HashKey Testnet #133' })
})

// 监控指标
app.get('/api/metrics', (_req, res) => {
  res.json(snapshot())
})

// 手动触发热身（前端可在应用加载时调用）
app.post('/api/warmup', async (_req, res) => {
  const [rpc, claude] = await Promise.all([
    benchmarkRpc(),
    warmupClaude(),
  ])
  res.json({
    rpc: rpc.map(r => ({ url: r.url, latencyMs: r.latencyMs, status: r.status })),
    claude: claude,
  })
})

app.listen(config.port, () => {
  console.log(`✅ HSP-Agent Hub backend running on :${config.port}`)
  console.log(`   USDC: ${config.usdcContract}`)
  console.log(`   RPC:  ${config.rpcUrl}`)

  // 启动定期支付 cron worker
  startCronWorker()

  // 启动热身：并行跑 RPC benchmark + Claude 连接预热（fire-and-forget）
  Promise.all([benchmarkRpc(), warmupClaude()]).catch(() => {})
})
