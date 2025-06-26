
<script setup lang="ts">
  import { decodeCashAddress } from '@bitauth/libauth'
  import { ElectrumNetworkProvider, HashType, Network, SignatureAlgorithm, SignatureTemplate } from 'cashscript'
  import { binToHex } from 'mainnet-js'
  import { deployContractFromAuthGuard, dissolveIssuanceFund, investInIssuanceFund, getIssuanceContract, addMultisigSignature, donate, migrate } from 'olando'
  import { Notify } from 'quasar'
  import { adminPubkeys, getAdminMultisig2of3Contract, getCouncilMultisig2of3Contract, olandoCategory } from 'src/olando'
  import { useStore } from 'src/stores/store'
  import { caughtErrorToString } from 'src/utils/errorHandling'
  import { ref } from 'vue'
  const store = useStore()
  const investAmountBch = ref("0");
  const investButtonDisabled = ref(false);
  const investStatusMessage = ref(" ");

  const donateAmountOla = ref("0");
  const donateButtonDisabled = ref(false);
  const donateStatusMessage = ref(" ");
  const newAdminMultisigContractAddress = ref<string>("");
  const newIssuanceFundContractAddress = ref<string>("");

  const dissolveExpanded = ref(false);
  const migrateExpanded = ref(false);
  const contractDeployed = ref<boolean | undefined>(undefined);
  const dissolvePartialTxHex = ref<string | undefined>(undefined);
  const showSignRawTxHex = ref(false);
  const showRawTxHex = ref<boolean>(false);
  const rawTxHex = ref<string | undefined>();
  const signRawTxHex = ref<undefined | (() => Promise<void>)>(undefined);
  const disabled = ref(false);

  const pubkey = store.wallet!.publicKeyCompressed!
  const privKey = store.wallet!.privateKey!
  const address = store.wallet!.address!

  const isAdmin = adminPubkeys.includes(binToHex(pubkey));

  const provider = new ElectrumNetworkProvider(Network.MAINNET, {
    manualConnectionManagement: false,
  })
  const adminMultisigContract = getAdminMultisig2of3Contract(provider, [])
  const councilMultisigContract = getCouncilMultisig2of3Contract(provider, [])

  const issuanceContract = getIssuanceContract({
    provider,
    councilMultisigContract,
    adminMultisigContract,
  });
  newAdminMultisigContractAddress.value = adminMultisigContract.address;
  newIssuanceFundContractAddress.value = issuanceContract.address;

  function copyToClipboard(copyText: string|undefined){
    if(!copyText) return
    navigator.clipboard.writeText(copyText);
    Notify.create({
      message: "Copied!",
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }

  const checkContractDeployed = async () => {
    try {
      const utxos = await issuanceContract.getUtxos();
      contractDeployed.value = utxos.length > 0;
    } catch (e) {
      Notify.create({
        message: `Failed to check if contract is deployed: ${caughtErrorToString(e)}`,
        icon: 'warning',
        color: "red"
      });
    }
  };
  checkContractDeployed();

  const deployContract = async () => {
    await deployContractFromAuthGuard({
      provider: provider,
      adminContract: adminMultisigContract,
      councilContract: councilMultisigContract,
      deployerAddress: address,
      deployerPriv: privKey,
      olandoCategory: olandoCategory,
    });

    checkContractDeployed();
  };

  const initiateDissolveContract = async () => {
    disabled.value = true;
    try {
      const sigTemplate = new SignatureTemplate(store.wallet!.privateKey!, HashType.SIGHASH_ALL, SignatureAlgorithm.ECDSA);
      dissolvePartialTxHex.value = await dissolveIssuanceFund({
        address: address,
        privKey: privKey,
        provider: provider,
        councilMultisigContract,
        adminMultisigContract,
        olandoCategory: olandoCategory,
        signatures: [sigTemplate, Uint8Array.from(Array(71))],
        send: false,
      });
      // console.log("Partial transaction hex:", dissolvePartialTxHex.value);
      showRawTxHex.value = true;
      rawTxHex.value = dissolvePartialTxHex.value;
    } catch (e) {
      const errorMessage = `Failed to initiate contract dissolution: ${caughtErrorToString(e).split("\n")[0]}`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });
      console.error(e);
    }
    disabled.value = false;
  };

  const addDissolveSignatureAndSend = async () => {
    disabled.value = true;
    try {
      const signedTxHex = await addMultisigSignature({
        provider: provider,
        adminMultisigContract: adminMultisigContract,
        multisigInputIndex: 2,
        partiallySignedTxHex: dissolvePartialTxHex.value!,
        privateKey: privKey,
        send: true,
      });
      // console.log("Signed transaction hex:", signedTxHex);
      showSignRawTxHex.value = false;
      checkContractDeployed();
    } catch (e) {
      const errorMessage = `Failed to add signature and send transaction: ${caughtErrorToString(e).split("\n")[0]}`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });

      console.error(e);
    }
    disabled.value = false;
  };

  const initiateMigration = async () => {
    disabled.value = true;

    if (typeof decodeCashAddress(newAdminMultisigContractAddress.value) === "string") {
      Notify.create({
        message: `Invalid new admin multisig contract address`,
        icon: 'warning',
        color: "red"
      });
      disabled.value = false;
      return;
    }

    if (typeof decodeCashAddress(newIssuanceFundContractAddress.value) === "string") {
      Notify.create({
        message: `Invalid new issuance fund contract address`,
        icon: 'warning',
        color: "red"
      });
      disabled.value = false;
      return;
    }

      try {
      const sigTemplate = new SignatureTemplate(store.wallet!.privateKey!, HashType.SIGHASH_ALL, SignatureAlgorithm.ECDSA);
      dissolvePartialTxHex.value = await migrate({
        address: address,
        privKey: privKey,
        provider: provider,
        councilMultisigContract,
        adminMultisigContract,
        newAdminMultisigContractAddress: newAdminMultisigContractAddress.value,
        newIssuanceFundContractAddress: newIssuanceFundContractAddress.value,
        signatures: [sigTemplate, Uint8Array.from(Array(71))],
        olandoCategory: olandoCategory,
        send: false,
      });
      // console.log("Partial transaction hex:", dissolvePartialTxHex.value);
      showRawTxHex.value = true;
      rawTxHex.value = dissolvePartialTxHex.value;
    } catch (e) {
      const errorMessage = `Failed to initiate contract migration: ${caughtErrorToString(e).split("\n")[0]}`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });
      console.error(e);
    }
    disabled.value = false;
  };

  const addMigrationSignatureAndSend = async () => {
    disabled.value = true;
    try {
      const signedTxHex = await addMultisigSignature({
        provider: provider,
        adminMultisigContract: adminMultisigContract,
        multisigInputIndex: 1,
        partiallySignedTxHex: dissolvePartialTxHex.value!,
        privateKey: privKey,
        send: true,
      });
      // console.log("Signed transaction hex:", signedTxHex);
      showSignRawTxHex.value = false;
      checkContractDeployed();
    } catch (e) {
      const errorMessage = `Failed to add signature and send transaction: ${caughtErrorToString(e).split("\n")[0]}`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });

      console.error(e);
    }
    disabled.value = false;
  };

  const invest = async () => {
    disabled.value = true;

    const investAmountValue = Number(parseFloat(investAmountBch.value).toFixed(8));
    if (investAmountValue <= 0) {
      investStatusMessage.value = `Investment amount too low`;
      disabled.value = false;
      return;
    }

    console.log(investAmountValue);
    try {
      const tokensBought = await investInIssuanceFund({
        address: address,
        privKey: privKey,
        provider: provider,
        investAmountBch: investAmountValue,
        adminMultisigContract: adminMultisigContract,
        councilMultisigContract: councilMultisigContract,
        olandoCategory: olandoCategory,
        // @ts-ignore
        wallet: store.wallet,
      });

      Notify.create({
        message: `Successfuly bought ${Number(tokensBought) / 10**2} OLA. The same amount was also sent to the Community Council Fund`,
        color: "positive",
      });
    } catch (e) {
      const errorMessage = `Failed to create invest transaction: ${caughtErrorToString(e).split("\n")[0]}`;
      investStatusMessage.value = errorMessage;
    }
    disabled.value = false;
  };

  function investMaxClick() {
    const satBalance = store.balance?.sat ?? 0;
    if (satBalance < 50000) {
      return;
    }
    investAmountBch.value = String((satBalance - 50000) / 1e8);
    investAmountChange({ target: { value: String((satBalance - 50000) / 1e8) } } as unknown as Event);
  };

  async function investAmountChange(event: Event) {
    try {
      investButtonDisabled.value = true;
      investStatusMessage.value = ` `;

      const balance = store.balance?.sat ?? 0;

      const investAmountValue = Math.floor(Number((event.target as HTMLInputElement).value) * 10 ** 8);
      if (investAmountValue < 0.001 * 10 ** 8) {
        investStatusMessage.value = `Investment amount too low`;
        return;
      }

      if (investAmountValue > balance - 50000) {
        investMaxClick();
      }

      investButtonDisabled.value = false;
    } catch (e) {
      let message = caughtErrorToString(e);
      if (message === "Nothing available to trade.") {
        message = "No pools for this token on Cauldron";
      }
      investButtonDisabled.value = true;
    }
  };

  const donateToFund = async () => {
    disabled.value = true;
    const olaAmount = Number(parseFloat(donateAmountOla.value).toFixed(2));
    if (olaAmount <= 0) {
      donateStatusMessage.value = `Donation amount too low`;
      disabled.value = false;
      return;
    }

    try {
      await donate({
        address: address,
        privKey: privKey,
        provider: provider,
        donationTokenAmount: BigInt(olaAmount * 10**2), // OLA has 2 decimals
        adminMultisigContract: adminMultisigContract,
        councilMultisigContract: councilMultisigContract,
        olandoCategory: olandoCategory,
        // @ts-ignore
        wallet: store.wallet,
      });

      Notify.create({
        message: `Donation of ${olaAmount} OLA sent to the Community Council Fund`,
        color: "positive",
      });
    } catch (e) {
      console.trace(e);
      const errorMessage = `Failed to create donation transaction: ${caughtErrorToString(e).split("\n")[0]}`;
      donateStatusMessage.value = errorMessage;
    }

    disabled.value = false;
  };

  function donateMaxClick() {
    const utxos = store.walletUtxos?.filter(utxo => utxo.token?.tokenId === olandoCategory);
    const max = utxos?.reduce((acc, utxo) => acc + (utxo.token?.amount ?? 0n), 0n) ?? 0n;
    const decimals = 2;
    const maxAmount = Number(max) / 10**decimals;
    donateAmountOla.value = String(maxAmount);
    donateAmountChange({ target: { value: String(maxAmount) } } as unknown as Event);
  };

  async function donateAmountChange(event: Event) {
    try {
      donateButtonDisabled.value = true;
      donateStatusMessage.value = ` `;

      const utxos = store.walletUtxos?.filter(utxo => utxo.token?.tokenId === olandoCategory);
      const max = utxos?.reduce((acc, utxo) => acc + (utxo.token?.amount ?? 0n), 0n) ?? 0n;
      const decimals = 2;
      const maxAmount = Number(max) / 10**decimals;

      const donateAmountValue = Number((event.target as HTMLInputElement).value);
      console.log(donateAmountValue)

      if (donateAmountValue <= 0) {
        donateStatusMessage.value = `Donation amount too low`;
        donateAmountOla.value = String(0);
        return;
      }

      if (donateAmountValue > maxAmount) {
        donateAmountOla.value = String(maxAmount);
        donateAmountChange({ target: { value: String(maxAmount) } } as unknown as Event);
        return;
      }

      if (donateAmountValue > 0) {
        donateButtonDisabled.value = false;
      }
    } catch (e) {
      donateButtonDisabled.value = true;
    }
  };
</script>

<template>
  <div>
    <div style="margin-bottom: 2rem;">Your public key: {{ binToHex(pubkey) }}</div>
    <div style="margin-bottom: 2rem;">Olando category: {{ olandoCategory }}</div>
    <fieldset style="margin-top: 20px; padding-top: 2rem; max-width: 75rem; margin: auto 10px;">
    <div v-if="contractDeployed === true" style="display: flex; flex-direction: column;">
      <div style="font-size: large;">Invest in OLA</div>
      <div style="">Investing in OLA is beneficial for the community. You buy OLA tokens from Cauldron at a 5% premium and unlock the same amount to be sent to the Community Council Fund which distributes it to help various community projects.</div>
      <div style="display: flex; flex-direction: column; gap: 2rem;">
        <div style="display: flex; flex-direction: row; gap: 2rem; margin-top: 8px;">
          <input :disabled="disabled" v-model="investAmountBch" @input="(event: Event) => investAmountChange(event)" style="width: 100%;" placeholder="Amount BCH" type="number" />
          <input :disabled="disabled" @click="() => investMaxClick()" type="button" class="primaryButton" value="max" style="padding:12px;">
        </div>
        <div style="display: flex; flex-direction: column; align-items: center;">
          <input @click="invest()" type="button" class="primaryButton" value="Invest" :disabled="investButtonDisabled || disabled">
          {{ investStatusMessage }}
        </div>
      </div>
      <hr />
      <div>Already have OLA and want to give it back to issuance fund? Want to help the community grow? Donate today!</div>
      <div style="display: flex; flex-direction: column; gap: 2rem;">
        <div style="display: flex; flex-direction: row; gap: 2rem; margin-top: 8px;">
          <input :disabled="disabled" v-model="donateAmountOla" @input="(event: Event) => donateAmountChange(event)" style="width: 100%;" placeholder="Amount OLA" type="number" />
          <input :disabled="disabled" @click="() => donateMaxClick()" type="button" class="primaryButton" value="max" style="padding:12px;">
        </div>
        <div style="display: flex; flex-direction: column; align-items: center;">
          <input @click="donateToFund()" type="button" class="primaryButton" value="Donate" :disabled="donateButtonDisabled || disabled">
          {{ donateStatusMessage }}
        </div>
      </div>
    </div>
    <div v-else-if="contractDeployed === false" style="display: flex; flex-direction: column;">
      Contract is not deployed yet. Admins should deploy it first.
    </div>
    <div v-else style="text-align: center;">Loading...</div>
    </fieldset>

    <fieldset v-if="isAdmin" style="margin-top: 20px; padding-top: 2rem; max-width: 75rem; margin: auto 10px;">
      <legend>Admin functions</legend>
      <div v-if="contractDeployed === true" style="display: flex; flex-direction: column;">
        <input :disabled="disabled" @click="dissolveExpanded = !dissolveExpanded" type="button" class="primaryButton" value="Dissolve Contract" style="margin-top: 8px;">
        <fieldset v-if="dissolveExpanded" style="display: flex; flex-direction: row; justify-content: center; gap: 2rem; margin-top: 1rem; margin-bottom: 1rem;">
          <input :disabled="disabled" @click="initiateDissolveContract()" type="button" class="primaryButton" value="Initiate dissolve" style="margin-top: 8px;">
          <input :disabled="disabled" @click="() => {signRawTxHex = addDissolveSignatureAndSend; showSignRawTxHex = true;}" type="button" class="primaryButton" value="Add signature" style="margin-top: 8px;">
        </fieldset>

        <input :disabled="disabled" @click="migrateExpanded = !migrateExpanded" type="button" class="primaryButton" value="Migrate Contract" style="margin-top: 8px;">
        <fieldset v-if="migrateExpanded" style="display: flex; flex-direction: column; justify-content: center; margin-top: 1rem; margin-bottom: 1rem; gap: 0.5rem;">
          <label>New issuance fund contract address</label>
          <input :disabled="disabled" v-model="newIssuanceFundContractAddress" style="width: 100%;" placeholder="New issuance fund contract address" />
          <label>New admin multisig contract address</label>
          <input :disabled="disabled" v-model="newAdminMultisigContractAddress" style="width: 100%;" placeholder="New admin multisig contract address" />
          <div style="display: flex; flex-direction: row; justify-content: center; gap: 2rem; margin-top: 1rem; margin-bottom: 1rem;">
            <input :disabled="disabled" @click="initiateMigration()" type="button" class="primaryButton" value="Initiate migration" style="margin-top: 8px;">
            <input :disabled="disabled" @click="() => {signRawTxHex = addMigrationSignatureAndSend; showSignRawTxHex = true;}" type="button" class="primaryButton" value="Add signature" style="margin-top: 8px;">
          </div>
        </fieldset>
      </div>
      <div v-else-if="contractDeployed === false" style="display: flex; flex-direction: column;">
        <input @click="deployContract()" type="button" class="primaryButton" value="Deploy Contract" style="margin-top: 8px;">
      </div>
      <div v-else style="text-align: center;">Loading...</div>
    </fieldset>
  </div>

  <!-- editable -->
  <q-dialog v-model="showSignRawTxHex">
    <q-card style="min-width: 350px; background-color: rgba(71, 71, 71, 0.9);">
      <q-card-section>
        <div class="text-h6" style="font-size: large;">Paste Transaction Hex</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-input :disabled="disabled" type="textarea" dense v-model="rawTxHex" autofocus />
      </q-card-section>

      <q-card-actions class="text-primary" style="justify-content: right;">
        <input :disabled="disabled" @click="signRawTxHex!()" type="button" class="primaryButton" value="Sign">
        <input :disabled="disabled" type="button" class="primaryButton" value="Close" style="margin-left: 1rem;" v-close-popup @click="signRawTxHex = undefined">
      </q-card-actions>
    </q-card>
  </q-dialog>

  <!-- readonly -->
  <q-dialog v-model="showRawTxHex">
    <q-card style="min-width: 350px; background-color: rgba(71, 71, 71, 0.9);">
      <q-card-section>
        <div class="text-h6" style="font-size: large;">Transaction Hex</div>
        <div class="text-h6" style="font-size: small; margin-top: 0.5rem;;">Send this multisig transaction to other signers to add their signatures and complete the transaction.</div>
      </q-card-section>

      <q-card-section class="q-pt-none">
        <q-input :disabled="disabled" type="textarea" dense v-model="rawTxHex" readonly autofocus />
      </q-card-section>

      <q-card-actions class="text-primary" style="justify-content: right;">
        <input :disabled="disabled" @click="copyToClipboard(rawTxHex)" type="button" class="primaryButton" value="Copy" style="">
        <input :disabled="disabled" type="button" class="primaryButton" value="Close" style="margin-left: 1rem;" v-close-popup @click="rawTxHex = undefined">
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style>
  .q-field__control-container > textarea {
    color: white;
    border: 1px solid #ccc;
    padding: 3px
  }
</style>