import * as dotenv from 'dotenv'
import path from 'path'
const result = dotenv.config({ path: path.resolve(__dirname, '../../.env') })
console.log('dotenv result:', result.parsed ? Object.keys(result.parsed) : result.error?.message)
console.log('DEMO_PRIVATE_KEY present:', !!process.env.DEMO_PRIVATE_KEY)
console.log('HSP_SIMULATOR_ADDRESS:', process.env.HSP_SIMULATOR_ADDRESS)

import { requestPayment, confirmPayment } from '../lib/ethers'

async function main() {
  const contractAddress = process.env.HSP_SIMULATOR_ADDRESS!
  
  try {
    console.log('\n[1] requestPayment...')
    const reqTx = await requestPayment({
      contractAddress,
      streamId: 'direct-test-004',
      receiver: '0x742d35cC6634c0532925a3B8d4c9C6E7e3B4e1F2',
      amountUsdc: 0.01,
      currency: 'USDC',
    })
    console.log('[1] PaymentRequested tx:', reqTx)

    console.log('\n[2] confirmPayment...')
    const confTx = await confirmPayment({
      contractAddress,
      streamId: 'direct-test-004',
      txHash: '0x0e070fc2886c12d097cc4b1886ee13baaa3f2e3468bafa0c6d80df0ed4dc9d99',
    })
    console.log('[2] Confirmed+Receipt tx:', confTx)
    console.log('\n✅ HSPSim 链路测试成功！')
  } catch (err) {
    console.error('Error:', (err as Error).message)
  }
  process.exit(0)
}

main()
