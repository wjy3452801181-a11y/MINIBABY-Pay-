import { benchmarkRpc } from '../src/lib/ethers'

async function run() {
  const results: Array<Array<{
    url: string; latencyMs: number | null; blockNumber: number | null; status: string; error?: string
  }>> = []

  for (let i = 1; i <= 3; i++) {
    console.log(`\n=== RPC Benchmark — Round ${i} ===`)
    const r = await benchmarkRpc()
    r.forEach(n => {
      const lat = n.latencyMs !== null ? `${n.latencyMs}ms` : 'N/A'
      const blk = n.blockNumber ?? 'N/A'
      console.log(`  ${n.status === 'ok' ? '✓' : '✗'} ${n.url.padEnd(40)} latency=${lat.padStart(7)}  block=${blk}`)
    })
    results.push(r)
    if (i < 3) await new Promise(res => setTimeout(res, 800))
  }

  const urls = results[0].map(n => n.url)
  console.log('\n=== 三轮汇总 ===')
  console.log('NODE'.padEnd(40), 'AVG'.padStart(8), 'MIN'.padStart(8), 'MAX'.padStart(8), ' STATUS')
  for (const url of urls) {
    const lats = results
      .flatMap(run => run.filter(n => n.url === url && n.latencyMs !== null).map(n => n.latencyMs as number))
    const errors = results.flatMap(run => run.filter(n => n.url === url && n.status !== 'ok'))
    if (lats.length === 0) {
      console.log(url.padEnd(40), '      N/A      N/A      N/A  ALL FAILED')
      continue
    }
    const avg = Math.round(lats.reduce((a, b) => a + b, 0) / lats.length)
    const min = Math.min(...lats)
    const max = Math.max(...lats)
    const ok = results.length - errors.length
    console.log(
      url.padEnd(40),
      `${avg}ms`.padStart(8),
      `${min}ms`.padStart(8),
      `${max}ms`.padStart(8),
      `  ${ok}/${results.length} ok`,
    )
  }

  // 端到端延迟模型：RPC 健康检查延迟 + Claude API（本地~1.5s，VPN~2.0s） + balance check
  console.log('\n=== 端到端延迟估算 ===')
  const bestRpc = Math.min(...results[0].filter(n => n.latencyMs !== null).map(n => n.latencyMs as number))
  const claudeLocal = 1500  // Claude API RTT（ms）本地
  const claudeVpn   = 2000  // Claude API RTT（ms）VPN
  const balance     = bestRpc  // balance check = 1 RPC call
  console.log(`  最快 RPC 节点:      ${bestRpc}ms`)
  console.log(`  balance check:      ${balance}ms（1× RPC call）`)
  console.log(`  Claude API（本地）: ~${claudeLocal}ms`)
  console.log(`  Claude API（VPN）:  ~${claudeVpn}ms`)
  console.log(`  ── 端到端估算 ──`)
  console.log(`  香港本地（SSE首事件）: ~${bestRpc + clauseLocale(claudeLocal)}ms`)
  console.log(`  大陆VPN（SSE首事件）:  ~${bestRpc + clauseLocale(claudeVpn)}ms`)
  function clauseLocale(api: number) { return api }  // first event ≈ parse_intent RTT ≈ Claude API
}

run().catch(console.error)
