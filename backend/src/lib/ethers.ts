import { ethers } from 'ethers'
import { config } from './config'
import { record } from './metrics'

// ERC-20 最小 ABI：只需要 transfer 和 balanceOf
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
]

// HSPSimulator ABI（事件 + 函数）
const HSP_SIMULATOR_ABI = [
  'event PaymentRequested(bytes32 indexed streamId, address indexed sender, address indexed receiver, uint256 amount, string currency)',
  'event Confirmed(bytes32 indexed streamId, address indexed sender, address indexed receiver, uint256 amount)',
  'event Receipt(bytes32 indexed streamId, bytes32 txHash, uint64 timestamp)',
  'function requestPayment(bytes32 streamId, address receiver, uint256 amount, string calldata currency) external',
  'function confirmPayment(bytes32 streamId, bytes32 txHash) external',
]

// ── 多 RPC 端点（优先级排序）──────────────────────────────────────────
// 注意：drpc.org 免费层限制 eth_call / eth_sendRawTransaction，仅保留可写节点
const RPC_URLS = [
  'https://testnet.hsk.xyz',            // 官方节点（主节点）
  'https://133.rpc.thirdweb.com',       // 备选：thirdweb 公共节点
]

let _provider: ethers.JsonRpcProvider | null = null
let _activeRpcIndex = 0

/**
 * 创建 provider，优先使用当前活跃 RPC，失败自动切换下一个
 */
async function createProviderWithFailover(): Promise<ethers.JsonRpcProvider> {
  const startIndex = _activeRpcIndex
  for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
    const idx = (startIndex + attempt) % RPC_URLS.length
    const url = RPC_URLS[idx]
    try {
      const p = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true })
      // 用 eth_chainId 做健康检查（比 getBlockNumber 更准确，drpc 免费层不限此方法）
      await Promise.race([
        p.send('eth_chainId', []),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000),
        ),
      ])
      _activeRpcIndex = idx
      if (attempt > 0) {
        record({ type: 'rpc_failover' })
        console.log(`[RPC] failover: 切换到 ${url} (尝试第 ${attempt + 1} 个节点)`)
      } else {
        record({ type: 'rpc_primary_ok' })
      }
      return p
    } catch (err) {
      console.warn(`[RPC] ${url} 不可用: ${(err as Error).message}`)
    }
  }
  throw new Error('所有 RPC 节点均不可用')
}

/**
 * 验证 provider 是否真正可用（eth_call 层面，不只是 blockNumber）
 */
async function isProviderFunctional(p: ethers.JsonRpcProvider): Promise<boolean> {
  try {
    // 用 eth_chainId 做健康检查（drpc 免费层限制 eth_call，但不限 eth_chainId）
    await Promise.race([
      p.send('eth_chainId', []),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 3000),
      ),
    ])
    return true
  } catch {
    return false
  }
}

/**
 * 获取 provider 单例，懒初始化，首次失败时自动 failover
 */
export async function getProviderAsync(): Promise<ethers.JsonRpcProvider> {
  if (_provider) {
    const ok = await isProviderFunctional(_provider)
    if (ok) return _provider
    console.warn('[RPC] 当前 provider 失联，尝试 failover...')
    _provider = null
  }
  _provider = await createProviderWithFailover()
  return _provider
}

/**
 * 强制重置 provider 缓存，下次调用时重新选择节点
 * 用于在调用失败后触发 failover
 */
export function resetProvider() {
  _provider = null
}

/**
 * 同步版本（向后兼容）：直接使用活跃 RPC URL，不做 await 健康检查
 * 用于不需要 await 的场景；建议新代码用 getProviderAsync()
 */
export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(RPC_URLS[_activeRpcIndex], undefined, { staticNetwork: true })
  }
  return _provider
}

export function getUsdcContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    config.usdcContract,
    ERC20_ABI,
    signerOrProvider ?? getProvider(),
  )
}

/**
 * 获取 HSPSimulator 合约实例
 * contractAddress：已部署的 HSPSimulator 地址（来自环境变量或手动传入）
 */
export function getHspSimulatorContract(
  contractAddress: string,
  signerOrProvider?: ethers.Signer | ethers.Provider,
) {
  return new ethers.Contract(
    contractAddress,
    HSP_SIMULATOR_ABI,
    signerOrProvider ?? getProvider(),
  )
}

// 构造无签名的 ERC-20 transfer tx payload，返回给前端让 MetaMask 签名
export async function buildTransferPayload(params: {
  from: string
  to: string
  amountUsdc: number  // 人类可读金额，如 50.0
}): Promise<{
  to: string
  data: string
  value: string
  chainId: number
  from: string
}> {
  const iface = new ethers.Interface(ERC20_ABI)

  // USDC = 6 decimals
  const amountRaw = BigInt(Math.round(params.amountUsdc * 1_000_000))
  const data = iface.encodeFunctionData('transfer', [params.to, amountRaw])

  return {
    from: params.from,
    to: config.usdcContract,
    data,
    value: '0x0',
    chainId: 133, // HashKey testnet
  }
}

// 查询 USDC 余额（返回人类可读浮点数）
export async function getUsdcBalance(address: string): Promise<number> {
  // 最多重试 RPC_URLS.length 次，每次失败后 failover 到下一节点
  for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
    try {
      const provider = await getProviderAsync()
      const contract = getUsdcContract(provider)
      const raw: bigint = await contract.balanceOf(address)
      return Number(raw) / 1_000_000 // 6 decimals
    } catch (err) {
      const msg = (err as Error).message ?? ''
      // drpc 免费层限制 eth_call / eth_getLogs：强制 failover
      if (msg.includes('SERVER_ERROR') || msg.includes('400') || msg.includes('freetier')) {
        console.warn(`[RPC] getUsdcBalance 失败 (attempt ${attempt + 1}), 重置 provider 重试...`)
        resetProvider()
        _activeRpcIndex = (_activeRpcIndex + 1) % RPC_URLS.length
      } else {
        throw err
      }
    }
  }
  throw new Error('所有 RPC 节点均无法查询余额')
}

// 后端直接用私钥签名并广播 USDC transfer（绕过钱包 gas 估算问题）
// 串行锁：防止多规则同时广播时 nonce 冲突
let _sendLock = Promise.resolve()

export async function sendTransfer(params: {
  to: string
  amountUsdc: number
}): Promise<string> {
  if (!config.demoPrivateKey) {
    throw new Error('DEMO_PRIVATE_KEY 未配置')
  }
  // 链式串行：等上一笔完成再发下一笔，避免 nonce 冲突
  const result = _sendLock.then(async () => {
    const provider = await getProviderAsync()
    const wallet = new ethers.Wallet(config.demoPrivateKey!, provider)
    const contract = getUsdcContract(wallet)
    const amountRaw = BigInt(Math.round(params.amountUsdc * 1_000_000))
    const normalizedTo = ethers.getAddress(params.to.toLowerCase())
    const tx = await (contract.transfer as (to: string, amount: bigint) => Promise<ethers.TransactionResponse>)(
      normalizedTo,
      amountRaw,
    )
    record({ type: 'tx_sent' })
    return tx.hash
  })
  _sendLock = result.then(() => {}, () => {})
  return result
}

// ── HSPSimulator 合约调用 ───────────────────────────────────────────────

/**
 * 在链上触发 PaymentRequested 事件
 * 用于演示：将 HSP 支付意图写入链上日志
 */
export async function requestPayment(params: {
  contractAddress: string
  streamId: string      // bytes32 hex 字符串，如 stream_id
  receiver: string      // 0x... 地址
  amountUsdc: number    // 人类可读
  currency: string      // e.g. "USDC"
}): Promise<string> {
  if (!config.demoPrivateKey) {
    throw new Error('DEMO_PRIVATE_KEY 未配置')
  }
  const result = _sendLock.then(async () => {
    // streamId 转 bytes32（预先计算，不依赖 provider）
    const streamIdBytes = ethers.zeroPadBytes(
      ethers.toUtf8Bytes(params.streamId).slice(0, 32),
      32,
    )
    const amountRaw = BigInt(Math.round(params.amountUsdc * 1_000_000))

    // 最多重试 RPC_URLS.length 次，每次失败后 failover
    for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
      try {
        const provider = await getProviderAsync()
        const wallet = new ethers.Wallet(config.demoPrivateKey!, provider)
        const contract = getHspSimulatorContract(params.contractAddress, wallet)
        const normalizedReceiver = ethers.getAddress(params.receiver.toLowerCase())
        const tx = await (contract.requestPayment as (
          streamId: string, receiver: string, amount: bigint, currency: string,
        ) => Promise<ethers.TransactionResponse>)(
          ethers.hexlify(streamIdBytes),
          normalizedReceiver,
          amountRaw,
          params.currency,
        )
        return tx.hash
      } catch (err) {
        const msg = (err as Error).message ?? ''
        if (msg.includes('SERVER_ERROR') || msg.includes('400') || msg.includes('freetier')) {
          console.warn(`[HSPSim] requestPayment RPC 失败 (attempt ${attempt + 1}), failover...`)
          resetProvider()
          _activeRpcIndex = (_activeRpcIndex + 1) % RPC_URLS.length
        } else {
          throw err
        }
      }
    }
    throw new Error('[HSPSim] requestPayment: 所有 RPC 节点均失败')
  })
  _sendLock = result.then(() => {}, () => {})
  return result
}

/**
 * 在链上触发 Confirmed + Receipt 事件
 * 用于演示：将 USDC transfer txHash 确认写入链上
 */
export async function confirmPayment(params: {
  contractAddress: string
  streamId: string   // bytes32
  txHash: string     // 已广播的 USDC transfer txHash
}): Promise<string> {
  if (!config.demoPrivateKey) {
    throw new Error('DEMO_PRIVATE_KEY 未配置')
  }
  const result = _sendLock.then(async () => {
    const streamIdBytes = ethers.zeroPadBytes(
      ethers.toUtf8Bytes(params.streamId).slice(0, 32),
      32,
    )
    const txHashBytes = params.txHash.startsWith('0x')
      ? params.txHash
      : `0x${params.txHash}`

    for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
      try {
        const provider = await getProviderAsync()
        const wallet = new ethers.Wallet(config.demoPrivateKey!, provider)
        const contract = getHspSimulatorContract(params.contractAddress, wallet)
        const tx = await (contract.confirmPayment as (
          streamId: string, txHash: string,
        ) => Promise<ethers.TransactionResponse>)(
          ethers.hexlify(streamIdBytes),
          txHashBytes,
        )
        return tx.hash
      } catch (err) {
        const msg = (err as Error).message ?? ''
        if (msg.includes('SERVER_ERROR') || msg.includes('400') || msg.includes('freetier')) {
          console.warn(`[HSPSim] confirmPayment RPC 失败 (attempt ${attempt + 1}), failover...`)
          resetProvider()
          _activeRpcIndex = (_activeRpcIndex + 1) % RPC_URLS.length
        } else {
          throw err
        }
      }
    }
    throw new Error('[HSPSim] confirmPayment: 所有 RPC 节点均失败')
  })
  _sendLock = result.then(() => {}, () => {})
  return result
}

// ── RPC 性能测试 ────────────────────────────────────────────────────────

/**
 * 测试所有 RPC 节点的延迟，返回排序结果
 * 用法：import { benchmarkRpc } from './ethers'; await benchmarkRpc()
 */
export async function benchmarkRpc(): Promise<Array<{
  url: string
  latencyMs: number | null
  blockNumber: number | null
  status: 'ok' | 'timeout' | 'error'
  error?: string
}>> {
  console.log('[RPC Benchmark] 开始测试所有节点...')
  const results = await Promise.all(
    RPC_URLS.map(async (url) => {
      const start = Date.now()
      try {
        const p = new ethers.JsonRpcProvider(url)
        const blockNumber = await Promise.race([
          p.getBlockNumber(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 5000),
          ),
        ])
        const latencyMs = Date.now() - start
        console.log(`[RPC Benchmark] ✓ ${url} — ${latencyMs}ms, block #${blockNumber}`)
        return { url, latencyMs, blockNumber, status: 'ok' as const }
      } catch (err) {
        const latencyMs = Date.now() - start
        const isTimeout = (err as Error).message === 'timeout'
        console.log(`[RPC Benchmark] ✗ ${url} — ${isTimeout ? 'TIMEOUT' : (err as Error).message}`)
        return {
          url,
          latencyMs: isTimeout ? null : latencyMs,
          blockNumber: null,
          status: isTimeout ? 'timeout' as const : 'error' as const,
          error: (err as Error).message,
        }
      }
    }),
  )
  // 按延迟升序排列（null 排最后）
  results.sort((a, b) => {
    if (a.latencyMs === null) return 1
    if (b.latencyMs === null) return -1
    return a.latencyMs - b.latencyMs
  })
  console.log('[RPC Benchmark] 完成。推荐节点:', results[0]?.url ?? '无可用节点')
  return results
}
