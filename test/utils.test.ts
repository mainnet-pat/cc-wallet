import type { UnwrapRef } from "vue";
import { getRecipientTopupOutputs, parseExtendedJson, recipientTopupSats } from "../src/utils/utils";
import type { WalletType } from "../src/interfaces/interfaces";
import { cashNinjaJsonString0, cashNinjaDecodedObj0, cashNinjaJsonString1, cashNinjaDecodedObj1 } from "./fixtures/wcFixtures";

describe('test parseExtendedJson', () => {
  it('should parse jsonString correctly - cashNinjaJsonString0', () => {
    const parsedObject = parseExtendedJson(cashNinjaJsonString0);
    const expectedResult = cashNinjaDecodedObj0
    expect(parsedObject).toMatchObject(expectedResult);
  })
  it('should parse jsonString correctly - cashNinjaJsonString1', () => {
    const parsedObject = parseExtendedJson(cashNinjaJsonString1);
    const expectedResult = cashNinjaDecodedObj1
    expect(parsedObject).toMatchObject(expectedResult);
  })
})

describe('test getRecipientTopupOutputs', () => {
  const tokenAddr = "bitcoincash:zqqsyqcyq5rqwzqfpg9scrgwpugpzysnzsve2tmffa";
  const cashAddr = "bitcoincash:qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzstne440kw";
  const tokenUtxo = { satoshis: 1000n, token: { category: "00".repeat(32), amount: 100n } };
  const bchUtxo = { satoshis: 5000n };

  // only the provider is used by getRecipientTopupOutputs, so the rest of the wallet is left out
  const walletWith = (getUtxos: () => Promise<unknown>) =>
    ({ provider: { getUtxos } }) as unknown as UnwrapRef<WalletType>;

  it('should add a topup output when the destination only holds token utxos', async () => {
    const wallet = walletWith(() => Promise.resolve([tokenUtxo, tokenUtxo]));
    const outputs = await getRecipientTopupOutputs(wallet, tokenAddr);
    expect(outputs).toEqual([{ cashaddr: tokenAddr, value: recipientTopupSats }]);
  })
  it('should not add a topup output when the destination holds bch', async () => {
    const wallet = walletWith(() => Promise.resolve([tokenUtxo, bchUtxo]));
    const outputs = await getRecipientTopupOutputs(wallet, tokenAddr);
    expect(outputs).toEqual([]);
  })
  it('should query the utxos of the non-token address form', async () => {
    const getUtxos = vi.fn().mockResolvedValue([bchUtxo]);
    await getRecipientTopupOutputs(walletWith(getUtxos), tokenAddr);
    expect(getUtxos).toHaveBeenCalledWith(cashAddr);
  })
  it('should not block the token send when the utxo lookup fails', async () => {
    const wallet = walletWith(() => Promise.reject(new Error("network error")));
    const outputs = await getRecipientTopupOutputs(wallet, tokenAddr);
    expect(outputs).toEqual([]);
  })
})