// 启动时验证必要环境变量，缺一个就崩溃并给出清晰提示
const REQUIRED = [
  'ANTHROPIC_API_KEY',
  'USDC_CONTRACT',
  'RPC_URL',
  'PORT',
] as const

export function validateEnv() {
  const missing = REQUIRED.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('❌ 缺少必要环境变量:')
    missing.forEach(k => console.error(`   ${k}`))
    console.error('请复制 .env.example 为 .env 并填写所有字段')
    process.exit(1)
  }
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  usdcContract: process.env.USDC_CONTRACT!,
  rpcUrl: process.env.RPC_URL!,
  demoPrivateKey: process.env.DEMO_PRIVATE_KEY, // 可选，demo fallback
  port: parseInt(process.env.PORT || '3001', 10),
  // HSPSimulator 合约地址（可选，未配置时跳过链上事件）
  hspSimulatorAddress: process.env.HSP_SIMULATOR_ADDRESS,
}
