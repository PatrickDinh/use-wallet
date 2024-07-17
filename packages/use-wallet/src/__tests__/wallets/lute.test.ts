import { Store } from '@tanstack/store'
import algosdk from 'algosdk'
import { StorageAdapter } from 'src/storage'
import { LOCAL_STORAGE_KEY, State, WalletState, defaultState } from 'src/store'
import { byteArrayToBase64 } from 'src/utils'
import { LuteWallet } from 'src/wallets/lute'
import { SignTxnsError, WalletId } from 'src/wallets/types'

// Mock storage adapter
vi.mock('src/storage', () => ({
  StorageAdapter: {
    getItem: vi.fn(),
    setItem: vi.fn()
  }
}))

// Spy/suppress console output
vi.spyOn(console, 'info').mockImplementation(() => {}) // @todo: remove when debug logger is implemented
vi.spyOn(console, 'warn').mockImplementation(() => {})

const mockLuteConnect = {
  connect: vi.fn(),
  signTxns: vi.fn()
}

vi.mock('lute-connect', async (importOriginal) => {
  const module = await importOriginal<typeof import('lute-connect')>()
  return {
    ...module,
    default: vi.fn(() => mockLuteConnect)
  }
})

function createWalletWithStore(store: Store<State>): LuteWallet {
  return new LuteWallet({
    id: WalletId.LUTE,
    options: {
      siteName: 'Mock Site Name'
    },
    metadata: {},
    getAlgodClient: () =>
      ({
        genesis: () => ({
          do: () => Promise.resolve({ id: 'mockGenesisID', network: 'mockGenesisNetwork' })
        })
      }) as any,
    store,
    subscribe: vi.fn()
  })
}

describe('LuteWallet', () => {
  let wallet: LuteWallet
  let store: Store<State>
  let mockInitialState: State | null = null

  const account1 = {
    name: 'Lute Account 1',
    address: 'mockAddress1'
  }
  const account2 = {
    name: 'Lute Account 2',
    address: 'mockAddress2'
  }

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(StorageAdapter.getItem).mockImplementation((key: string) => {
      if (key === LOCAL_STORAGE_KEY && mockInitialState !== null) {
        return JSON.stringify(mockInitialState)
      }
      return null
    })

    vi.mocked(StorageAdapter.setItem).mockImplementation((key: string, value: string) => {
      if (key === LOCAL_STORAGE_KEY) {
        mockInitialState = JSON.parse(value)
      }
    })

    store = new Store<State>(defaultState)
    wallet = createWalletWithStore(store)
  })

  afterEach(async () => {
    await wallet.disconnect()
    mockInitialState = null
  })

  describe('connect', () => {
    it('should initialize client, return accounts, and update store', async () => {
      mockLuteConnect.connect.mockResolvedValueOnce([account1.address, account2.address])

      const accounts = await wallet.connect()

      expect(wallet.isConnected).toBe(true)
      expect(accounts).toEqual([account1, account2])
      expect(store.state.wallets[WalletId.LUTE]).toEqual({
        accounts: [account1, account2],
        activeAccount: account1
      })
    })

    it('should throw an error if connection fails', async () => {
      mockLuteConnect.connect.mockRejectedValueOnce(new Error('Auth error'))

      await expect(wallet.connect()).rejects.toThrow('Auth error')
      expect(store.state.wallets[WalletId.LUTE]).toBeUndefined()
      expect(wallet.isConnected).toBe(false)
    })

    it('should throw an error if an empty array is returned', async () => {
      mockLuteConnect.connect.mockImplementation(() => Promise.resolve([]))

      await expect(wallet.connect()).rejects.toThrow('No accounts found!')
      expect(store.state.wallets[WalletId.LUTE]).toBeUndefined()
      expect(wallet.isConnected).toBe(false)
    })
  })

  describe('disconnect', () => {
    it('should disconnect client and remove wallet from store', async () => {
      mockLuteConnect.connect.mockResolvedValueOnce(['mockAddress'])

      await wallet.connect()
      await wallet.disconnect()

      expect(wallet.isConnected).toBe(false)
      expect(store.state.wallets[WalletId.DEFLY]).toBeUndefined()
    })
  })

  describe('resumeSession', () => {
    it('should do nothing if no session is found', async () => {
      await wallet.resumeSession()

      expect(wallet.isConnected).toBe(false)
    })

    it('should resume session if session is found', async () => {
      const walletState: WalletState = {
        accounts: [account1],
        activeAccount: account1
      }

      store = new Store<State>({
        ...defaultState,
        wallets: {
          [WalletId.LUTE]: walletState
        }
      })

      wallet = createWalletWithStore(store)

      await wallet.resumeSession()

      expect(wallet.isConnected).toBe(true)
      expect(store.state.wallets[WalletId.LUTE]).toEqual(walletState)
    })
  })

  describe('signing transactions', () => {
    // Connected accounts
    const connectedAcct1 = '7ZUECA7HFLZTXENRV24SHLU4AVPUTMTTDUFUBNBD64C73F3UHRTHAIOF6Q'
    const connectedAcct2 = 'GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A'

    // Not connected account
    const notConnectedAcct = 'EW64GC6F24M7NDSC5R3ES4YUVE3ZXXNMARJHDCCCLIHZU6TBEOC7XRSBG4'

    const txnParams = {
      from: connectedAcct1,
      to: connectedAcct2,
      fee: 10,
      firstRound: 51,
      lastRound: 61,
      genesisHash: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
      genesisID: 'mainnet-v1.0'
    }

    // Transactions used in tests
    const txn1 = new algosdk.Transaction({ ...txnParams, amount: 1000 })
    const txn2 = new algosdk.Transaction({ ...txnParams, amount: 2000 })
    const txn3 = new algosdk.Transaction({ ...txnParams, amount: 3000 })
    const txn4 = new algosdk.Transaction({ ...txnParams, amount: 4000 })

    beforeEach(async () => {
      // Mock two connected accounts
      mockLuteConnect.connect.mockResolvedValueOnce([connectedAcct1, connectedAcct2])

      const mockSignedTxn = new Uint8Array(0)
      mockLuteConnect.signTxns.mockResolvedValue([mockSignedTxn])

      await wallet.connect()
    })

    describe('signTransactions', () => {
      it('should re-throw SignTxnsError to the consuming application', async () => {
        const signTxnsError = {
          message: 'User Rejected Request',
          code: 4001
        }

        mockLuteConnect.signTxns.mockRejectedValueOnce(signTxnsError)
        await expect(wallet.signTransactions([txn1])).rejects.toThrow(
          new SignTxnsError(signTxnsError.message, signTxnsError.code)
        )
      })

      it('should process and sign a single algosdk.Transaction', async () => {
        await wallet.signTransactions([txn1])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(txn1.toByte()) }
        ])
      })

      it('should process and sign a single algosdk.Transaction group', async () => {
        const [gtxn1, gtxn2, gtxn3] = algosdk.assignGroupID([txn1, txn2, txn3])
        await wallet.signTransactions([gtxn1, gtxn2, gtxn3])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(gtxn1.toByte()) },
          { txn: byteArrayToBase64(gtxn2.toByte()) },
          { txn: byteArrayToBase64(gtxn3.toByte()) }
        ])
      })

      it('should process and sign multiple algosdk.Transaction groups', async () => {
        const [g1txn1, g1txn2] = algosdk.assignGroupID([txn1, txn2])
        const [g2txn1, g2txn2] = algosdk.assignGroupID([txn3, txn4])

        await wallet.signTransactions([
          [g1txn1, g1txn2],
          [g2txn1, g2txn2]
        ])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(g1txn1.toByte()) },
          { txn: byteArrayToBase64(g1txn2.toByte()) },
          { txn: byteArrayToBase64(g2txn1.toByte()) },
          { txn: byteArrayToBase64(g2txn2.toByte()) }
        ])
      })

      it('should process and sign a single encoded transaction', async () => {
        const encodedTxn = txn1.toByte()
        await wallet.signTransactions([encodedTxn])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(txn1.toByte()) }
        ])
      })

      it('should process and sign a single encoded transaction group', async () => {
        const txnGroup = algosdk.assignGroupID([txn1, txn2, txn3])
        const [gtxn1, gtxn2, gtxn3] = txnGroup.map((txn) => txn.toByte())

        await wallet.signTransactions([gtxn1, gtxn2, gtxn3])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(gtxn1) },
          { txn: byteArrayToBase64(gtxn2) },
          { txn: byteArrayToBase64(gtxn3) }
        ])
      })

      it('should process and sign multiple encoded transaction groups', async () => {
        const txnGroup1 = algosdk.assignGroupID([txn1, txn2])
        const [g1txn1, g1txn2] = txnGroup1.map((txn) => txn.toByte())

        const txnGroup2 = algosdk.assignGroupID([txn3, txn4])
        const [g2txn1, g2txn2] = txnGroup2.map((txn) => txn.toByte())

        await wallet.signTransactions([
          [g1txn1, g1txn2],
          [g2txn1, g2txn2]
        ])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(g1txn1) },
          { txn: byteArrayToBase64(g1txn2) },
          { txn: byteArrayToBase64(g2txn1) },
          { txn: byteArrayToBase64(g2txn2) }
        ])
      })

      it('should determine which transactions to sign based on indexesToSign', async () => {
        const [gtxn1, gtxn2, gtxn3, gtxn4] = algosdk.assignGroupID([txn1, txn2, txn3, txn4])
        const txnGroup = [gtxn1, gtxn2, gtxn3, gtxn4]
        const indexesToSign = [0, 1, 3]

        // Mock signTxns to return "signed" (not really) encoded transactions or null
        mockLuteConnect.signTxns.mockResolvedValueOnce([
          gtxn1.toByte(),
          gtxn2.toByte(),
          null,
          gtxn4.toByte()
        ])

        await expect(wallet.signTransactions(txnGroup, indexesToSign)).resolves.toEqual([
          gtxn1.toByte(),
          gtxn2.toByte(),
          null,
          gtxn4.toByte()
        ])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(gtxn1.toByte()) },
          { txn: byteArrayToBase64(gtxn2.toByte()) },
          { txn: byteArrayToBase64(gtxn3.toByte()), signers: [] },
          { txn: byteArrayToBase64(gtxn4.toByte()) }
        ])
      })

      it('should only send transactions with connected signers for signature', async () => {
        const canSignTxn1 = new algosdk.Transaction({
          ...txnParams,
          from: connectedAcct1,
          amount: 1000
        })

        const cannotSignTxn2 = new algosdk.Transaction({
          ...txnParams,
          from: notConnectedAcct,
          amount: 2000
        })

        const canSignTxn3 = new algosdk.Transaction({
          ...txnParams,
          from: connectedAcct2,
          amount: 3000
        })

        // Signer for gtxn2 is not a connected account
        const [gtxn1, gtxn2, gtxn3] = algosdk.assignGroupID([
          canSignTxn1,
          cannotSignTxn2, // Should not be signed
          canSignTxn3
        ])

        await wallet.signTransactions([gtxn1, gtxn2, gtxn3])

        expect(mockLuteConnect.signTxns).toHaveBeenCalledWith([
          { txn: byteArrayToBase64(gtxn1.toByte()) },
          { txn: byteArrayToBase64(gtxn2.toByte()), signers: [] },
          { txn: byteArrayToBase64(gtxn3.toByte()) }
        ])
      })
    })

    describe('transactionSigner', () => {
      it('should call signTransactions with the correct arguments', async () => {
        const txnGroup = algosdk.assignGroupID([txn1, txn2])
        const indexesToSign = [1]

        const signTransactionsSpy = vi.spyOn(wallet, 'signTransactions')

        await wallet.transactionSigner(txnGroup, indexesToSign)

        expect(signTransactionsSpy).toHaveBeenCalledWith(txnGroup, indexesToSign)
      })
    })
  })
})
