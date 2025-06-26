import { Contract, type ElectrumNetworkProvider } from "cashscript";
import { hexToBin } from "mainnet-js";
import { replaceArtifactPlaceholders } from "olando";
import Multisig_2of3Artifact from "olando/artifacts/Multisig_2of3.artifact";

export const olandoCategory = "c1b511d524edbe14b419cbe092a6756f6255b288eee08b196af9c45c9baae61e";

export const adminPubkeys = [
  "02b319ee4a546a4524f45856c213112adbb336844f7c880fb8e1314df433533e28",
  "03633edb35f6552ecc3138c01c7219ddb278e1ae17304b60b2fd2aa8a1f20d0aaf",
  "02b319ee4a546a4524f45856c213112adbb336844f7c880fb8e1314df433533e28",
]

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
