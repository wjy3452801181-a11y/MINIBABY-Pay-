/**
 * deploy-hsp-simulator.ts
 * 编译 HSPSimulator.sol 并部署到 HashKey Chain Testnet
 * 用法：npx tsx scripts/deploy-hsp-simulator.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { ethers } from 'ethers'
import solc from 'solc'
import * as dotenv from 'dotenv'

dotenv.config({ path: path.resolve(__dirname, '../.env') })

const RPC_URLS = [
  'https://hashkey-testnet.drpc.org',
  'https://133.rpc.thirdweb.com',
  'https://testnet.hsk.xyz',
]

async function getWorkingProvider(): Promise<ethers.JsonRpcProvider> {
  for (const url of RPC_URLS) {
    try {
      const p = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true })
      await Promise.race([
        p.getBlockNumber(),
        new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
      ])
      console.log(`✓ RPC 连接成功: ${url}`)
      return p
    } catch {
      console.log(`✗ RPC 失败: ${url}`)
    }
  }
  throw new Error('所有 RPC 均不可用')
}

function compileSolidity(sourcePath: string): { abi: object[]; bytecode: string } {
  const source = fs.readFileSync(sourcePath, 'utf8')
  const contractName = path.basename(sourcePath, '.sol')

  const input = {
    language: 'Solidity',
    sources: {
      [contractName + '.sol']: { content: source },
    },
    settings: {
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object'] },
      },
      optimizer: { enabled: true, runs: 200 },
    },
  }

  console.log(`\n🔨 编译 ${contractName}.sol ...`)
  const output = JSON.parse(solc.compile(JSON.stringify(input)))

  if (output.errors) {
    const errors = output.errors.filter((e: { severity: string }) => e.severity === 'error')
    if (errors.length > 0) {
      console.error('编译错误:')
      errors.forEach((e: { formattedMessage: string }) => console.error(e.formattedMessage))
      process.exit(1)
    }
    // 只有 warning，打印出来
    output.errors.forEach((e: { formattedMessage: string; severity: string }) => {
      if (e.severity === 'warning') console.warn('  ⚠', e.formattedMessage.split('\n')[0])
    })
  }

  const contract = output.contracts[contractName + '.sol'][contractName]
  const bytecode = '0x' + contract.evm.bytecode.object
  const abi = contract.abi

  console.log(`✓ 编译成功 | ABI 函数数: ${abi.filter((x: {type: string}) => x.type === 'function').length} | Bytecode: ${bytecode.length / 2 - 1} bytes`)
  return { abi, bytecode }
}

async function deploy() {
  const privateKey = process.env.DEMO_PRIVATE_KEY
  if (!privateKey) {
    console.error('❌ DEMO_PRIVATE_KEY 未在 .env 中配置')
    process.exit(1)
  }

  // 1. 连接 RPC
  const provider = await getWorkingProvider()
  const wallet = new ethers.Wallet(privateKey, provider)
  console.log(`\n📬 部署账户: ${wallet.address}`)

  // 查余额
  const balance = await provider.getBalance(wallet.address)
  console.log(`   HSK 余额: ${ethers.formatEther(balance)} HSK`)
  if (balance === 0n) {
    console.error('❌ 账户 HSK 余额为 0，无法支付 gas')
    process.exit(1)
  }

  // 2. 编译合约
  const solPath = path.resolve(__dirname, '../../contracts/HSPSimulator.sol')
  const { abi, bytecode } = compileSolidity(solPath)

  // 3. 估算 gas
  console.log('\n⛽ 估算 gas ...')
  const factory = new ethers.ContractFactory(abi, bytecode, wallet)
  let gasEstimate: bigint
  try {
    const deployTx = await factory.getDeployTransaction()
    gasEstimate = await provider.estimateGas({ ...deployTx, from: wallet.address })
    const feeData = await provider.getFeeData()
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits('1', 'gwei')
    const estimatedCost = gasEstimate * gasPrice
    console.log(`   估算 gas: ${gasEstimate.toLocaleString()} | 费用约 ${ethers.formatEther(estimatedCost)} HSK`)
  } catch (e) {
    console.warn(`   gas 估算失败 (${(e as Error).message})，继续部署...`)
  }

  // 4. 部署
  console.log('\n🚀 广播部署交易...')
  const contract = await factory.deploy()
  const deployTx = contract.deploymentTransaction()
  console.log(`   TX Hash: ${deployTx?.hash}`)
  console.log('   等待上链确认...')

  await contract.waitForDeployment()
  const address = await contract.getAddress()

  console.log(`\n✅ 部署成功！`)
  console.log(`   合约地址: ${address}`)
  console.log(`   浏览器:   https://testnet-explorer.hsk.xyz/address/${address}`)
  console.log(`   TX:       https://testnet-explorer.hsk.xyz/tx/${deployTx?.hash}`)

  // 5. 写入 .env（追加 HSP_SIMULATOR_ADDRESS）
  const envPath = path.resolve(__dirname, '../.env')
  let envContent = fs.readFileSync(envPath, 'utf8')
  if (envContent.includes('HSP_SIMULATOR_ADDRESS=')) {
    envContent = envContent.replace(/HSP_SIMULATOR_ADDRESS=.*/, `HSP_SIMULATOR_ADDRESS=${address}`)
  } else {
    envContent += `\nHSP_SIMULATOR_ADDRESS=${address}\n`
  }
  fs.writeFileSync(envPath, envContent)
  console.log(`\n📝 已写入 .env: HSP_SIMULATOR_ADDRESS=${address}`)

  // 6. 验证：调用 getPayment（空 streamId 应返回零值不报错）
  console.log('\n🔍 验证合约可调用性...')
  const deployed = new ethers.Contract(address, abi, provider)
  try {
    const zeroId = ethers.ZeroHash
    await deployed.getPayment(zeroId)
    console.log('   ✓ getPayment() 调用成功')
  } catch (e) {
    console.warn('   ⚠ getPayment() 调用异常:', (e as Error).message)
  }

  console.log('\n🎉 全部完成。')
  process.exit(0)
}

deploy().catch(err => {
  console.error('\n❌ 部署失败:', err.message)
  process.exit(1)
})
