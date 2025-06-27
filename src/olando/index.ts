import { Contract, type ElectrumNetworkProvider } from "cashscript";
import { hexToBin } from "mainnet-js";
import { replaceArtifactPlaceholders } from "olando";
import Multisig_2of3Artifact from "olando/artifacts/Multisig_2of3.artifact";

export const olandoCategory = "c1b511d524edbe14b419cbe092a6756f6255b288eee08b196af9c45c9baae61e";

export const adminPubkeys = [
  // "02b319ee4a546a4524f45856c213112adbb336844f7c880fb8e1314df433533e28",
  // "02b319ee4a546a4524f45856c213112adbb336844f7c880fb8e1314df433533e28",
  "0361758d50d17f38d46fa76123d5827997ab1532eb822575bb8c70e8b28cbf8467",
  "02b319ee4a546a4524f45856c213112adbb336844f7c880fb8e1314df433533e28",
  "021227e4fa946a0a6c01f842fe477463ffe2d5c1f380a7f30053ac5a50c3597dc2",
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
