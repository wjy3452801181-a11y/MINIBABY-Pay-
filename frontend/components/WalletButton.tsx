import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '../lib/LocaleContext'

interface Props {
  address: string | null
  onConnect: (address: string) => void
}

const HSK_CHAIN_ID = 133

const HSK_CHAIN = {
  chainId: '0x85',
  chainName: 'HashKey Chain Testnet',
  nativeCurrency: { name: 'HSK', symbol: 'HSK', decimals: 18 },
  rpcUrls: ['https://testnet.hsk.xyz'],
  blockExplorerUrls: ['https://testnet-explorer.hsk.xyz'],
}

type EthProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  isMetaMask?: boolean
  isBitKeep?: boolean
  isBitget?: boolean
  isCoinbaseWallet?: boolean
  isBinance?: boolean
}

declare global {
  interface Window {
    ethereum?: EthProvider
    okxwallet?: EthProvider
    bitkeep?: { ethereum?: EthProvider }
    bitget?: { ethereum?: EthProvider }
    coinbaseWalletExtension?: EthProvider
  }
}

interface WalletOption {
  id: string
  name: string
  logo: string
  getProvider: () => EthProvider | null
}

function getWalletOptions(): WalletOption[] {
  if (typeof window === 'undefined') return []
  return [
    {
      id: 'metamask',
      name: 'MetaMask',
      logo: '/wallets/metamask.svg',
      getProvider: () => window.ethereum?.isMetaMask ? window.ethereum : null,
    },
    {
      id: 'coinbase',
      name: 'Coinbase Wallet',
      logo: '/wallets/coinbase.png',
      getProvider: () => window.coinbaseWalletExtension ?? (window.ethereum?.isCoinbaseWallet ? window.ethereum : null),
    },
    {
      id: 'bitget',
      name: 'Bitget Wallet',
      logo: '/wallets/bitget.svg',
      getProvider: () => window.bitkeep?.ethereum ?? window.bitget?.ethereum ?? (window.ethereum?.isBitKeep || window.ethereum?.isBitget ? window.ethereum : null),
    },
    {
      id: 'walletconnect',
      name: 'WalletConnect',
      logo: '/wallets/walletconnect.png',
      getProvider: () => null,
    },
  ]
}

async function switchToHsk(provider: EthProvider) {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HSK_CHAIN.chainId }] })
  } catch (err: unknown) {
    const e = err as { code?: number }
    if (e.code === 4902) {
      await provider.request({ method: 'wallet_addEthereumChain', params: [HSK_CHAIN] })
    } else {
      throw err
    }
  }
}

export default function WalletButton({ address, onConnect }: Props) {
  const { t } = useLocale()
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([])

  useEffect(() => {
    setWalletOptions(getWalletOptions())
  }, [])

  useEffect(() => {
    if (!address) return
    const fetchBalance = () => {
      fetch(`/api/execute/balance/${address}`)
        .then(r => r.json())
        .then(d => setBalance(d.balance))
        .catch(() => {})
    }
    fetchBalance()
    const timer = setInterval(fetchBalance, 15000)
    return () => clearInterval(timer)
  }, [address])

  const connectWallet = async (wallet: WalletOption) => {
    setLoading(wallet.id)
    setError(null)

    try {
      if (wallet.id === 'walletconnect') {
        const { EthereumProvider } = await import('@walletconnect/ethereum-provider')
        const provider = await EthereumProvider.init({
          projectId: '0e3e8d8c5bc03602d9d2529a137e53aa',
          chains: [HSK_CHAIN_ID],
          optionalChains: [1],
          showQrModal: true,
          metadata: {
            name: 'HSP Agent Hub',
            description: 'Intent-driven Web3 payment engine',
            url: 'http://localhost:3000',
            icons: [],
          },
        })
        await provider.connect()
        const accounts = provider.accounts
        if (!accounts.length) throw new Error(t('noAccountFound'))
        onConnect(accounts[0])
        setShowModal(false)
        return
      }

      const provider = wallet.getProvider()
      if (!provider) {
        setError(t('noWalletInstalled').replace('{wallet}', wallet.name))
        setLoading(null)
        return
      }

      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[]
      if (!accounts.length) throw new Error(t('noAccountFound'))
      await switchToHsk(provider)
      onConnect(accounts[0])
      setShowModal(false)
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string }
      if (e.code === 4001) {
        setError(t('userCanceled'))
      } else {
        setError(e.message || t('connectFailed'))
      }
    } finally {
      setLoading(null)
    }
  }

  if (address) {
    return (
      <div className="flex items-center gap-1.5 sm:gap-2">
        <div className="flex items-center gap-1.5 bg-hsk-surface border border-hsk-border rounded-lg px-2 sm:px-3 py-1.5">
          <div className="w-2 h-2 rounded-full bg-hsk-green animate-pulse-dot flex-shrink-0" />
          <span className="text-xs font-mono text-hsk-text">
            {address.slice(0, 4)}..{address.slice(-3)}
          </span>
          {balance !== null && (
            <span className="hidden sm:inline text-xs text-hsk-green font-semibold ml-1">
              {balance.toFixed(2)}
            </span>
          )}
        </div>
        <div className="text-xs text-hsk-muted hidden sm:block">{t('walletChainName')}</div>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => { setShowModal(true); setError(null) }}
        className="flex items-center gap-2 bg-hsk-blue hover:bg-blue-500 text-white text-sm font-semibold px-3 sm:px-4 py-2 rounded-lg transition-colors"
      >
        <span className="hidden sm:inline">{t('connectWallet')}</span>
        <span className="sm:hidden">
          {t('connectWallet').split(' ')[0]}
        </span>
      </button>

      {showModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="bg-hsk-surface border border-hsk-border rounded-2xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-hsk-text">{t('selectWallet')}</h2>
              <button onClick={() => setShowModal(false)} className="text-hsk-muted hover:text-hsk-text text-lg leading-none">×</button>
            </div>

            <div className="space-y-2">
              {walletOptions.map(wallet => (
                <button
                  key={wallet.id}
                  onClick={() => connectWallet(wallet)}
                  disabled={loading !== null}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-hsk-border hover:border-hsk-blue hover:bg-hsk-blue/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <img src={wallet.logo} alt={wallet.name} className="w-8 h-8 rounded-lg object-contain" />
                  <span className="text-sm text-hsk-text">{wallet.name}</span>
                  {loading === wallet.id && (
                    <span className="ml-auto inline-block w-4 h-4 border-2 border-hsk-blue/30 border-t-hsk-blue rounded-full animate-spin" />
                  )}
                </button>
              ))}
            </div>

            {error && (
              <div className="mt-3 text-xs text-hsk-red text-center">{error}</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
