/**
 * Helpful resources:
 * https://github.com/randlabs/myalgo-connect
 */
import BaseWallet from "./base";
import MyAlgoConnect from "@randlabs/myalgo-connect";
import { algosdk } from "../algod";
import { PROVIDER_ID } from "../constants";
import { providers } from "../providers";
import type { WalletProvider } from "../types";
import { TransactionsArray } from "../types";
import { DecodedTransaction, DecodedSignedTransaction } from "../types";

const myAlgo = new MyAlgoConnect({ disableLedgerNano: false });

type InitWallet = {
  id: PROVIDER_ID;
  client: MyAlgoConnect;
  providers: typeof providers;
};

class MyAlgoWalletClient extends BaseWallet {
  #client: MyAlgoConnect;
  id: PROVIDER_ID;
  provider: WalletProvider;

  constructor(initWallet: InitWallet) {
    super();
    this.#client = initWallet.client;
    this.id = initWallet.id;
    this.provider = initWallet.providers[this.id];
  }

  static async init() {
    const initWallet: InitWallet = {
      id: PROVIDER_ID.MYALGO_WALLET,
      client: myAlgo,
      providers: providers,
    };

    return new MyAlgoWalletClient(initWallet);
  }

  async connect() {
    const accounts = await this.#client.connect();

    if (accounts.length === 0) {
      throw new Error(`No accounts found for ${this.provider}`);
    }

    const mappedAccounts = accounts.map((account) => ({
      ...account,
      providerId: this.provider.id,
    }));

    return {
      ...this.provider,
      accounts: mappedAccounts,
    };
  }

  async reconnect() {
    return null;
  }

  async disconnect() {
    return;
  }

  async signTransactions(activeAdress: string, transactions: Uint8Array[]) {
    // Decode the transactions to access their properties.
    const decodedTxns = transactions.map((txn) => {
      return algosdk.decodeObj(txn);
    }) as Array<DecodedTransaction | DecodedSignedTransaction>;

    // Get the unsigned transactions.
    const txnsToSign = decodedTxns.reduce<Uint8Array[]>((acc, txn, i) => {
      // If the transaction isn't already signed and is to be sent from a connected account,
      // add it to the arrays of transactions to be signed.
      if (
        !("txn" in txn) &&
        algosdk.encodeAddress(txn["snd"]) === activeAdress
      ) {
        acc.push(transactions[i]);
      }

      return acc;
    }, []);

    // Sign them with the client.
    const result = await this.#client.signTransaction(txnsToSign);

    // Join the newly signed transactions with the original group of transactions.
    const signedTxns = decodedTxns.reduce<Uint8Array[]>((acc, txn, i) => {
      if (!("txn" in txn)) {
        const signedByUser = result.shift()?.blob;
        signedByUser && acc.push(signedByUser);
      } else {
        acc.push(transactions[i]);
      }

      return acc;
    }, []);

    return signedTxns;
  }

  async signEncodedTransactions(transactions: TransactionsArray) {
    const transactionsToSign: string[] = [];
    const signedRawTransactions: Uint8Array[] = [];

    for (const [type, txn] of transactions) {
      if (type === "u") {
        transactionsToSign.push(txn);
      }
    }

    const result = await this.#client.signTransaction(transactionsToSign);

    if (!result) {
      throw new Error("Signing failed.");
    }

    let resultIndex = 0;

    for (const [type, txn] of transactions) {
      if (type === "u") {
        signedRawTransactions.push(result[resultIndex].blob);
        resultIndex++;
      } else {
        signedRawTransactions.push(new Uint8Array(Buffer.from(txn, "base64")));
      }
    }

    return signedRawTransactions;
  }
}

export default MyAlgoWalletClient;
