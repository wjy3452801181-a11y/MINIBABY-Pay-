import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { validateEnv, config } from './lib/config'
import { intentRouter } from './routes/intent'
import { executeRouter } from './routes/execute'
import { startCronWorker } from './lib/cronWorker'
import { snapshot } from './lib/metrics'

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

app.listen(config.port, () => {
  console.log(`✅ HSP-Agent Hub backend running on :${config.port}`)
  console.log(`   USDC: ${config.usdcContract}`)
  console.log(`   RPC:  ${config.rpcUrl}`)

  // 启动定期支付 cron worker
  startCronWorker()
})
