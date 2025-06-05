import { type SpendableCoin } from "cashlab";
import { type TestNetWallet, type TokenI, type UtxoI, type Wallet } from "mainnet-js";
import { binsAreEqual, hexToBin, privateKeyToP2pkhLockingBytecode } from "@bitauth/libauth";

import { bigIntArraySortPolyfill, BurnTokenException, PayoutAmountRuleType, type PayoutRule, SpendableCoinType } from "cashlab/build/common/index.js";
import { ExchangeLab, type GenerateChainedTradeTxResult, type PoolTrade, type PoolV0, type PoolV0Parameters, type TradeResult, type TradeTxResult } from "cashlab/build/cauldron/index.js";

export type RostrumCauldronContractSubscribeResponse = {
  type: string,
  utxos: Array<{
    is_withdrawn: boolean,
    new_utxo_hash: string,
    new_utxo_n: number,
    new_utxo_txid: string,
    pkh: string;
    sats: number,
    spent_utxo_hash: string;
    token_amount: number,
    token_id: string;
  }>;
};

export type ActivePoolEntry = {
  owner_p2pkh_addr: string;
  owner_pkh: string;
  sats: number;
  token_id: string;
  tokens: number;
  tx_pos: number;
  txid: string;
};
export type ActivePoolsResult = {
  active: Array<ActivePoolEntry>;
};

export const NATIVE_BCH_TOKEN_ID = "BCH";
export const DEFAULT_DUST_TOKEN_MIN_IN_BCH = 800n;
export type TokenId = string;

export type TradeProposal = TradeResult & {
  priceImpact: number;
}

/**
 * Proposes a trade between supply and demand tokens.
 *
 * @param {Object} options - The trade options.
 * @param {bigint} [options.txFeePerByte=1n] - The transaction fee per byte.
 * @param {TokenId} options.supplyTokenId - The ID of the supply token.
 * @param {TokenId} options.demandTokenId - The ID of the demand token.
 * @param {bigint} [options.demandAmount] - The amount of demand token.
 * @param {bigint} [options.supplyAmount] - The amount of supply token.
 * @returns {Promise<TradeProposal>} The trade proposal.
 */
export const proposeTrade = async ({
    txFeePerByte = 1n,
    supplyTokenId,
    demandTokenId,
    demandAmount,
    supplyAmount,
    activePools = undefined,
  }: {
    txFeePerByte?: bigint,
    supplyTokenId: TokenId,
    demandTokenId: TokenId,
    demandAmount?: bigint,
    supplyAmount?: bigint,
    noCache?: boolean,
    activePools?: ActivePoolsResult,
  }): Promise<TradeProposal> => {
  const nonNativeTokenId = supplyTokenId === NATIVE_BCH_TOKEN_ID ? demandTokenId : supplyTokenId;

  const exlab = new ExchangeLab();
  let indexedPools = {active: []} as ActivePoolsResult;
  if (activePools === undefined) {
    const indexedPoolsResponse = await fetch(`https://indexer.cauldron.quest/cauldron/pool/active/?token=${nonNativeTokenId}`);
    indexedPools = await indexedPoolsResponse.json() as ActivePoolsResult;
  } else {
    indexedPools = activePools;
  }

  const inputPools: PoolV0[] = [];
  for (const indexedPool of indexedPools.active) {
    const poolParams: PoolV0Parameters = {
      withdraw_pubkey_hash: hexToBin(indexedPool.owner_pkh),
    };
    // reconstruct pool's locking bytecode
    const locking_bytecode = exlab.generatePoolV0LockingBytecode(poolParams);
    const pool: PoolV0 = {
      version: '0',
      parameters: poolParams,
      outpoint: {
        index: indexedPool.tx_pos,
        txhash: hexToBin(indexedPool.txid),
      },
      output: {
        locking_bytecode,
        token: {
          amount: BigInt(indexedPool.tokens),
          token_id: indexedPool.token_id,
        },
        amount: BigInt(indexedPool.sats),
      },
    };
    inputPools.push(pool);
  }

  let tradeProposal: TradeResult;
  if (demandAmount !== undefined) {
    tradeProposal = exlab.constructTradeBestRateForTargetDemand(supplyTokenId, demandTokenId, demandAmount, inputPools, txFeePerByte);
  } else {
    if (supplyAmount === undefined) {
      throw new Error('supplyAmount is required when demandAmount is defined');
    }
    tradeProposal = exlab.constructTradeBestRateForTargetSupply(supplyTokenId, demandTokenId, supplyAmount, inputPools, txFeePerByte);
  }

  const globalWavgRate = inputPools.reduce((acc, pool) => acc + pool.output.amount * pool.output.token.amount * exlab._rate_denominator, 0n) /
    inputPools.reduce((acc, pool) => acc + pool.output.token.amount * exlab._rate_denominator, 0n);
  const outputPools = structuredClone(inputPools);
  for (const pool of outputPools) {
    const matchedEntry = tradeProposal.entries.find(entry => entry.pool.outpoint.index === pool.outpoint.index && binsAreEqual(entry.pool.outpoint.txhash, pool.outpoint.txhash));
    if (matchedEntry !== undefined) {
      if (matchedEntry.demand_token_id === NATIVE_BCH_TOKEN_ID) {
        // selling token into pool
        pool.output.amount -= matchedEntry.demand;
        pool.output.token.amount += matchedEntry.supply;
      } else {
        // selling bch into pool
        pool.output.amount += matchedEntry.supply;
        pool.output.token.amount -= matchedEntry.demand;
      }
    }
  }
  const globalWavgRateAfter = outputPools.reduce((acc, pool) => acc + pool.output.amount * pool.output.token.amount * exlab._rate_denominator, 0n) /
    outputPools.reduce((acc, pool) => acc + pool.output.token.amount * exlab._rate_denominator, 0n);

  const impact = Number(globalWavgRateAfter - globalWavgRate) / Number(globalWavgRate);
  const result = tradeProposal as TradeProposal;
  result.priceImpact = impact;

  return result;
};

/**
 * Funds a proposed trade by selecting input coins from a wallet and generating trade transactions.
 *
 * @param {Object} options - The options for funding the trade.
 * @param {Wallet | TestNetWallet} options.wallet - The wallet to use for funding the trade.
 * @param {TradeResult} options.tradeProposal - The trade proposal containing the trade entries.
 * @param {bigint} [options.txFeePerByte=1n] - The transaction fee per byte.
 * @param {boolean} [options.burnDustTokens=true] - Whether to burn dust tokens.
 *
 * @returns {Promise<TradeTxResult[]>} A promise that resolves to an array of trade transaction results.
 */
export const fundProposedTrade = async ({
    wallet,
    tradeProposal,
    txFeePerByte = 1n,
    burnDustTokens = true,
  } : {
    wallet: Wallet | TestNetWallet,
    tradeProposal: TradeProposal,
    txFeePerByte?: bigint,
    burnDustTokens?: boolean,
  }): Promise<TradeTxResult[]> => {
  const exlab = new ExchangeLab();

  const tokenBalances: Array<{ tokenId: TokenId, value: bigint }> = [
    { tokenId: NATIVE_BCH_TOKEN_ID, value: 0n }
  ];
  const tradeSumList: Array<{
    supplyTokenId: TokenId, demandTokenId: TokenId,
    supply: bigint, demand: bigint
  }> = [];

  for (const entry of tradeProposal.entries) {
    let tradeSumEntry = tradeSumList.find((a) => a.supplyTokenId === entry.supply_token_id && a.demandTokenId === entry.demand_token_id);
    if (tradeSumEntry === undefined) {
      tradeSumEntry = {
        supplyTokenId: entry.supply_token_id, demandTokenId: entry.demand_token_id,
        supply: 0n, demand: 0n,
      };
      tradeSumList.push(tradeSumEntry);
    }
    tradeSumEntry.supply += entry.supply;
    tradeSumEntry.demand += entry.demand;
    { // verify entries there's no other opposite trade
      let otherTradeSumEntry = tradeSumList.find((a) => a.supplyTokenId === entry.demand_token_id);
      if (otherTradeSumEntry === undefined) {
        otherTradeSumEntry = tradeSumList.find((a) => a.demandTokenId === entry.supply_token_id);
      }
      if (otherTradeSumEntry !== undefined) {
        throw new Error(`The trade may not contain opposed entries!`);
      }
    }
    { // add demand from balance as surplus
      let tokenBalance = tokenBalances.find((a) => a.tokenId === entry.demand_token_id);
      if (tokenBalance === undefined) {
        tokenBalance = { tokenId: entry.demand_token_id, value: 0n };
        tokenBalances.push(tokenBalance);
      }
      tokenBalance.value += entry.demand;
    }
    { // deduct supply from balance as deficit
      let tokenBalance = tokenBalances.find((a) => a.tokenId === entry.supply_token_id);
      if (tokenBalance === undefined) {
        tokenBalance = { tokenId: entry.supply_token_id, value: 0n };
        tokenBalances.push(tokenBalance);
      }
      tokenBalance.value -= entry.supply;
    }
  }

  // find a set of utxo that will fund the supply side
  // The current impl uses mainnet-js, And mainnet's wallets mainly use p2pkh addresses
  // to lock the coins, Having that, The following uses pkh & its cashaddr from the wallet
  // to construct the locking_bytecode & then retrieves the utxos associated with the addr
  const walletPrivateKey = wallet.privateKey as Uint8Array;
  const utxoList: UtxoI[] = await wallet.getAddressUtxos(wallet.cashaddr);
  const inputCoins: SpendableCoin[] = [];
  const walletLockingBytecode = privateKeyToP2pkhLockingBytecode({ privateKey: walletPrivateKey, throwErrors: true })
  // txfee reserve
  // TODO:: have an estimate of txfee reserve
  const txfeeReserve: bigint = BigInt(200 * tradeProposal.entries.length + 1000);
  const nativeTokenBalance = tokenBalances.find((a) => a.tokenId === NATIVE_BCH_TOKEN_ID);
  if (nativeTokenBalance === undefined) {
    throw new Error('InvalidProgramState!');
  }
  // deduct txfee_reserve from bch balance
  nativeTokenBalance.value -= txfeeReserve;

  // supply input coins for tokens with negative balance
  const includedUtxoList: UtxoI[] = [];
  for (const tokenBalance of tokenBalances) {
    while (tokenBalance.value < 0n) {
      // select from utxo_list
      let subUtxoList
      if (tokenBalance.tokenId === NATIVE_BCH_TOKEN_ID) {
        subUtxoList = utxoList.filter((a) => includedUtxoList.find((b) => a === b) === undefined && a.satoshis > 0);
        subUtxoList.sort((a, b) => b.satoshis - a.satoshis);
      } else {
        subUtxoList = utxoList.filter((a) => includedUtxoList.find((b) => a === b) === undefined && a.token?.tokenId === tokenBalance.tokenId && a.token?.capability === undefined && a.token?.commitment === undefined && a.token.amount > 0n);
        bigIntArraySortPolyfill(subUtxoList, (a: UtxoI, b: UtxoI) => (b.token as TokenI).amount - (a.token as TokenI).amount);
      }
      const utxo = subUtxoList.shift();
      if (utxo === undefined) {
        throw new Error(`Insufficient funds, wallet: ${wallet.name}`);
      }
      includedUtxoList.push(utxo);
      nativeTokenBalance.value += BigInt(utxo.satoshis);
      if (tokenBalance.tokenId !== NATIVE_BCH_TOKEN_ID) {
        tokenBalance.value += (utxo.token as TokenI).amount;
      }
      inputCoins.push({
        type: SpendableCoinType.P2PKH,
        // @ts-ignore
        output: {
          locking_bytecode: walletLockingBytecode,
          token: utxo.token !== undefined ? {
            amount: utxo.token.amount,
            token_id: utxo.token.tokenId,
          } : undefined,
          amount: BigInt(utxo.satoshis),
        },
        outpoint: {
          index: utxo.vout,
          txhash: hexToBin(utxo.txid),
        },
        key: walletPrivateKey,
      });
    }
  }

  const mkPrepareShouldBurnCall = (callable: (tokenId: TokenId, amount: bigint, value_in_bch: bigint) => void): ((tokenId: TokenId, amount: bigint) => void) => {
    const rate_cache: { [tokenId: string]: bigint }  = {};
    const rateDenominator = exlab.getRateDenominator();
    const _getRate = (tokenId: TokenId): bigint => {
      if (tokenId === NATIVE_BCH_TOKEN_ID) {
        throw new Error(`should never occur!`);
      }
      if (typeof rate_cache[tokenId] === 'bigint') {
        return rate_cache[tokenId];
      }
      let rate: bigint | undefined;
      { // when it supplies the tokenId
        const tradeSumEntry = tradeSumList.find((a) => a.supplyTokenId === tokenId);
        if (tradeSumEntry !== undefined) {
          rate = tradeSumEntry.demand * rateDenominator / tradeSumEntry.supply;
        }
      }
      { // when it demands the tokenId
        const tradeSumEntry = tradeSumList.find((a) => a.demandTokenId === tokenId);
        if (tradeSumEntry !== undefined) {
          rate = tradeSumEntry.supply * rateDenominator / tradeSumEntry.demand;
        }
      }
      if (typeof rate === 'bigint') {
        return rate_cache[tokenId] = rate;
      }
      throw new Error('Unknown token!!, tokenId: ' + tokenId);
    };
    return (tokenId: TokenId, amount: bigint): void => {
      if (tokenId === NATIVE_BCH_TOKEN_ID) {
        callable(tokenId, amount, amount);
      } else {
        const rate = _getRate(tokenId)
        callable(tokenId, amount, amount * rate / rateDenominator);
      }
    };
  };

  if (txFeePerByte < 0n) {
    throw new Error('txfee-per-byte should be a positive integer');
  }

  const payoutRules: PayoutRule[] = [
    {
      type: PayoutAmountRuleType.CHANGE,
      allow_mixing_native_and_token: false,
      locking_bytecode: walletLockingBytecode,
      spending_parameters: {
        type: SpendableCoinType.P2PKH,
        key: walletPrivateKey,
      },
      shouldBurn: mkPrepareShouldBurnCall((tokenId: TokenId, amount: bigint, valueInBch: bigint): void => {
        if (tokenId !== NATIVE_BCH_TOKEN_ID && burnDustTokens && valueInBch < DEFAULT_DUST_TOKEN_MIN_IN_BCH) {
          throw new BurnTokenException();
        }
      }),
    },
  ];

  let selectedInputCoins: SpendableCoin[] = [];
  const writeTxController = {
    // eslint-disable-next-line
    async generateMiddleware (result: GenerateChainedTradeTxResult, groupedEntries: Array<{ supply_token_id: TokenId, demand_token_id: TokenId, list: PoolTrade[] }>, input_coins: SpendableCoin[]): Promise<GenerateChainedTradeTxResult> {
      selectedInputCoins = [ ...selectedInputCoins, ...result.input_coins ];
      return result;
    },
  };

  const tradeTxList: TradeTxResult[] = await exlab.writeChainedTradeTx(tradeProposal.entries, inputCoins, payoutRules, null, txFeePerByte, writeTxController);
  for (const trade_tx of tradeTxList) {
    exlab.verifyTradeTx(trade_tx);
  }

  return tradeTxList;
}

/**
 * Broadcasts a list of trade transactions using the provided wallet.
 * @param wallet - The wallet used to submit the transactions.
 * @param tradeTxList - The list of trade transactions to be broadcasted.
 * @returns A promise that resolves to an array of transaction IDs for the submitted transactions.
 */
export const broadcastTrade = async (wallet: Wallet | TestNetWallet, tradeTxList: TradeTxResult[]) => {
  const txIds: string[] = [];
  for (const tradeTx of tradeTxList) {
    const txid = await wallet.submitTransaction(tradeTx.txbin, true);
    txIds.push(txid);
  }

  return txIds;
}
