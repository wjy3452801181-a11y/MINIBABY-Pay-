import crypto from 'crypto'
import type { ToolResult } from '../lib/claude'
import { record } from '../lib/metrics'

// 多币种配置
const CURRENCY_CONFIG: Record<string, {
  coingeckoVs: string     // CoinGecko vs_currencies 参数
  fallback: number        // 1 [currency] = fallback USDC
  riskLimit: number       // 单笔上限 USDC（超出触发 risk_level: high）
}> = {
  HKD: { coingeckoVs: 'hkd', fallback: 0.128, riskLimit: 50000 },
  CNY: { coingeckoVs: 'cny', fallback: 0.138, riskLimit: 50000 },
  EUR: { coingeckoVs: 'eur', fallback: 1.08,  riskLimit: 100000 },
}

// 汇率缓存，key = currency (HKD/CNY/EUR)
const rateCaches: Record<string, { rate: number; expiry: number }> = {}

async function getToUsdcRate(currency: string): Promise<{ rate: number; source: 'coingecko' | 'fallback' }> {
  const cfg = CURRENCY_CONFIG[currency.toUpperCase()]
  if (!cfg) {
    // 未知币种，直接返回 1（已是 USDC）
    return { rate: 1, source: 'fallback' }
  }

  const now = Date.now()
  const cached = rateCaches[currency]
  if (cached && now < cached.expiry) {
    return { rate: cached.rate, source: 'coingecko' }
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=${cfg.coingeckoVs}`,
      { signal: AbortSignal.timeout(3000) },
    )
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
    const data = await res.json() as { 'usd-coin': Record<string, number> }
    const foreignPerUsdc = data['usd-coin'][cfg.coingeckoVs]  // e.g. HKD per USDC
    const rate = 1 / foreignPerUsdc  // USDC per 1 foreign unit
    rateCaches[currency] = { rate, expiry: now + 5 * 60 * 1000 }
    return { rate, source: 'coingecko' }
  } catch {
    return { rate: cfg.fallback, source: 'fallback' }
  }
}

// 风险警告规则
const RISK_WARNINGS: {
  check: (recipient: string, amtUsdc: number, currency: string) => boolean
  level: 'medium' | 'high'
  message: string
}[] = [
  {
    check: (_r, amtUsdc) => amtUsdc > 10000,
    level: 'medium',
    message: '大额转账，请确认收款方',
  },
  {
    check: (_r, amtUsdc, currency) => amtUsdc > (CURRENCY_CONFIG[currency.toUpperCase()]?.riskLimit ?? 100000),
    level: 'high',
    message: '超过单笔限额，合规团队将审核',
  },
  {
    check: (r) => r === '0x0000000000000000000000000000000000000000',
    level: 'high',
    message: '检测到零地址，拒绝转账',
  },
  {
    check: (r) => r.toLowerCase() === '0x000000000000000000000000000000000000dead',
    level: 'high',
    message: '检测到销毁地址，拒绝转账',
  },
]

// 跨境关键词 → 对应币种，用于 POST /api/intent 收到请求时预热汇率缓存
const CROSS_BORDER_KEYWORDS: Array<{ pattern: RegExp; currency: string }> = [
  { pattern: /人民币|CNY|RMB|元/i, currency: 'CNY' },
  { pattern: /港币|港元|HKD/i,     currency: 'HKD' },
  { pattern: /欧元|EUR/i,          currency: 'EUR' },
]

/**
 * 根据用户原始消息预热汇率缓存（fire-and-forget）
 * 在 parse_intent 执行期间并行完成 CoinGecko 请求，check_compliance 调用时命中缓存
 */
export function warmupRateIfNeeded(message: string): void {
  for (const { pattern, currency } of CROSS_BORDER_KEYWORDS) {
    if (pattern.test(message)) {
      getToUsdcRate(currency).catch(() => {}) // fire-and-forget，失败无影响
      break // 一条消息最多一种跨境币种
    }
  }
}

export async function checkCompliance(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const { recipient, amount, currency } = input as {
      recipient: string
      amount: number
      currency: string
    }

    if (!recipient || !amount || !currency) {
      return { error: true, message: '缺少必要字段：recipient, amount, currency' }
    }

    const currencyUpper = currency.toUpperCase()
    const isCrossBorder = currencyUpper in CURRENCY_CONFIG

    // 换算为 USDC 金额
    let convertedAmountUsdc: number
    let exchangeRate: number | null = null
    let exchangeRateSource: 'coingecko' | 'fallback' | null = null
    let originalAmount: number | null = null
    let originalCurrency: string | null = null

    if (isCrossBorder) {
      const { rate, source } = await getToUsdcRate(currencyUpper)
      exchangeRate = rate
      exchangeRateSource = source
      originalAmount = amount
      originalCurrency = currencyUpper
      convertedAmountUsdc = parseFloat((amount * rate).toFixed(6))
    } else {
      // USDC 或其他，直接视为 USDC
      convertedAmountUsdc = amount
    }

    // 风险警告检查
    const warnings: string[] = []
    let maxRiskLevel: 'low' | 'medium' | 'high' = 'low'

    for (const rule of RISK_WARNINGS) {
      if (rule.check(recipient, convertedAmountUsdc, currencyUpper)) {
        warnings.push(rule.message)
        if (rule.level === 'high') {
          maxRiskLevel = 'high'
        } else if (rule.level === 'medium' && maxRiskLevel === 'low') {
          maxRiskLevel = 'medium'
        }
      }
    }

    // high 风险：阻断流水线
    if (maxRiskLevel === 'high') {
      record({ type: 'compliance', risk_level: 'high', cross_border: isCrossBorder, blocked: true })
      return {
        error: true,
        message: `合规检查未通过: ${warnings.join('; ')}`,
      }
    }

    record({ type: 'compliance', risk_level: maxRiskLevel, cross_border: isCrossBorder, blocked: false })

    // 生成确定性 ZKID proof tag
    const hash = crypto
      .createHash('sha256')
      .update(`${recipient}${amount}${currency}`)
      .digest('hex')
      .slice(0, 8)

    const proof = `ZKID-MOCK-VERIFIED-${hash.toUpperCase()}`

    return {
      success: true,
      verified: true,
      kyc_status: 'verified',
      aml_score: 0.02,
      risk_level: maxRiskLevel,
      risk_warnings: warnings,
      compliance_proof: proof,
      ...(isCrossBorder && exchangeRate !== null && {
        original_amount: originalAmount,
        original_currency: originalCurrency,
        converted_amount_usdc: convertedAmountUsdc,
        exchange_rate: exchangeRate,
        exchange_rate_source: exchangeRateSource,
      }),
    }
  } catch (err) {
    return { error: true, message: `check_compliance 内部错误: ${String(err)}` }
  }
}
