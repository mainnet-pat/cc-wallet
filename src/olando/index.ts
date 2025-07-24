import { NATIVE_BCH_TOKEN_ID } from "cashlab";
import { Contract, type Utxo, type ElectrumNetworkProvider } from "cashscript";
import { hexToBin } from "mainnet-js";
import { MaxTokenSupply, replaceArtifactPlaceholders, vmToBigInt } from "olando";
import Multisig_2of3Artifact from "olando/artifacts/Multisig_2of3.artifact";
import { proposeTrade, type ActivePoolsResult } from "src/utils/cauldron";

export interface ElectrumUtxo {
  tx_pos: number;
  value: number;
  tx_hash: string;
  height: number;
  token_data?: {
    amount: string;
    category: string;
    nft?: {
      capability: 'none' | 'mutable' | 'minting';
      commitment: string;
    };
  };
}

export interface RostrumUtxo {
  tx_pos: number;
  value: number;
  tx_hash: string;
  height: number;
  has_token: boolean;
  token_id?: string;
  token_amount?: number;
  commitment?: string;
}

export const olandoCategory = "d4c0b80d9ea541b8671b266c4b02abd4379b490378ffdd96bbcc18990032faf7";
export const olandoName = "IncredibleTestToken"
export const olandoSymbol = "ITT2"
export const olandoDecimals = 2

export const adminPubkeys = [
  "02b574c8c162bfbc60741e54e9c534afe2b299bd368f284f0d4191650b5b0ce812", // olando_master
  "03633edb35f6552ecc3138c01c7219ddb278e1ae17304b60b2fd2aa8a1f20d0aaf", // olando_twp_user (seed "strategy")
  "02850d0e2caebe80ca036555fe602ebd6725267fee9f8f04bf252882a72b89d2ed", // olando_twp_multi_1 (seed "remain")
].sort().reverse(); // sort pubkeys to match the ElectronCash order

export const getAdminMultisig2of3Contract = (provider: ElectrumNetworkProvider, pubkeys: Uint8Array[]) => {
  const artifact = replaceArtifactPlaceholders(Multisig_2of3Artifact, {
    pubkeyA: pubkeys[0] ?? hexToBin(adminPubkeys[0]!),
    pubkeyB: pubkeys[1] ?? hexToBin(adminPubkeys[1]!),
    pubkeyC: pubkeys[2] ?? hexToBin(adminPubkeys[2]!),
  });

  const contract = new Contract(artifact, [], { provider, ignoreFunctionSelector: true, addressType: 'p2sh20' });
  return contract;
}

export const getCouncilMultisig2of3Contract = (provider: ElectrumNetworkProvider, pubkeys: Uint8Array[]) => {
  const artifact = replaceArtifactPlaceholders(Multisig_2of3Artifact, {
    pubkeyA: pubkeys[0] ?? hexToBin(adminPubkeys[0]!),
    pubkeyB: pubkeys[1] ?? hexToBin(adminPubkeys[1]!),
    pubkeyC: pubkeys[2] ?? hexToBin(adminPubkeys[2]!),
  });

  const contract = new Contract(artifact, [], { provider, ignoreFunctionSelector: true, addressType: 'p2sh20' });
  return contract;
}

export const getContractState = async ({
  issuanceContractUtxo,
  investAmountBch,
  pools,
} : {
  issuanceContractUtxo: Utxo,
  investAmountBch: number,
  pools: ActivePoolsResult,
}) => {
  const deploymentTime = vmToBigInt(issuanceContractUtxo.token!.nft!.commitment.slice(0, 8));
  const lastInteractionTime = vmToBigInt(issuanceContractUtxo.token!.nft!.commitment.slice(8, 16));

  let cauldronTradeAdjustedTokenAmount = 0n;

  const bchInvestmentSatoshis = BigInt(Math.floor(Number(investAmountBch) * 10 ** 8));

  if (bchInvestmentSatoshis > 0n) {
    const tradeResult = await proposeTrade({
      supplyTokenId: NATIVE_BCH_TOKEN_ID,
      demandTokenId: olandoCategory,
      supplyAmount: bchInvestmentSatoshis,
      activePools: pools,
    });

    cauldronTradeAdjustedTokenAmount = 95n * tradeResult.summary.demand / 100n; // 95% of the cauldron pool token-buy output
  }

  const currentTime = BigInt(Math.floor(Date.now() / 1000) - 2 * 60 * 60); // Current time in seconds since epoch - 2h

  const intialSupply = MaxTokenSupply; // with 2 decimals
  const issued = intialSupply - issuanceContractUtxo.token!.amount;

  const SCALE = 1_000_000_000n; // 1e9 for scaling
  const t = currentTime - deploymentTime; // time in seconds since startTime

  const k = 3n; // 3E-9 scaled by 1e9
  const denom = SCALE + k * t; // (1 + 3E-9 * t) * 1e9
  const denomSquared = denom * denom / SCALE; // (1 + 3E-9 * t)^2 * 1e9
  const currentEmissionCap = intialSupply * (SCALE - SCALE * SCALE / denomSquared) / SCALE;


  // use inputs.length to find the cauldron token-buy output, since last ouput could be a bch change
  const tokensBought = 100n * cauldronTradeAdjustedTokenAmount / 95n;
  const issue = tokensBought * 9n / 10n; // 90% of tokens bought

  // require(issue <= currentEmissionCap - issued, "Issue amount exceeds current emission cap");

  let maxBchInvestmentSat = undefined;
  try {
    const backwardsTradeResult = await proposeTrade({
      supplyTokenId: olandoCategory,
      demandTokenId: NATIVE_BCH_TOKEN_ID,
      supplyAmount: currentEmissionCap - issued,
      activePools: pools,
    });

    maxBchInvestmentSat = backwardsTradeResult.summary.supply;
  } catch {;}

  return {
    deploymentTime: deploymentTime,
    lastInteractionTime: lastInteractionTime,
    contractLifteime: currentTime - deploymentTime,
    currentEmissionCap: currentEmissionCap,
    currentSupply: issuanceContractUtxo.token!.amount,
    issued: issued,
    issue: issue,
    cauldronTradeAdjustedTokenAmount: cauldronTradeAdjustedTokenAmount,
    exceeds: issue > currentEmissionCap - issued,
    maxBchInvestmentSat: maxBchInvestmentSat,
  };
}
