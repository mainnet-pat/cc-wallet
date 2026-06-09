<script setup lang="ts">
  import { decodeCashAddress, binToHex } from '@bitauth/libauth'
  import { ElectrumNetworkProvider, HashType, Network, SignatureAlgorithm, SignatureTemplate, type Utxo } from 'cashscript'
  import { deployContractFromAuthGuard, dissolveIssuanceFund, investInIssuanceFund, getIssuanceContract, addMultisigSignature, donate, migrate, MaxTokenSupply } from 'olando'
  import { Notify } from 'quasar'
  import { adminPubkeys, getAdminMultisig2of3Contract, getCouncilMultisig2of3Contract, olandoCategory, olandoSymbol, olandoDecimals, type RostrumUtxo, getContractState } from 'src/olando'
  import { useStore } from 'src/stores/store'
  import { type ActivePoolsResult, type RostrumCauldronContractSubscribeResponse, type ActivePoolEntry } from 'src/utils/cauldron'
  import { ElectrumClient, type RPCParameter } from "@electrum-cash/network";
  import { ElectrumWebSocket } from "@electrum-cash/web-socket";
  import { caughtErrorToString } from 'src/utils/errorHandling'
  import { onBeforeUnmount, ref, watch } from 'vue'
  import { ExchangeRate, type TestNetWallet, type Wallet } from 'mainnet-js'
  import { CurrencyShortNames, CurrencySymbols, type WalletType } from 'src/interfaces/interfaces'
  import { useSettingsStore } from 'src/stores/settingsStore'

  const store = useStore()
  const settingsStore = useSettingsStore()

  const exchangeRate = ref<number | undefined>(undefined);
  async function fetchExchangeRate() {
    exchangeRate.value = await ExchangeRate.get(settingsStore.currency, true);
  }
  void fetchExchangeRate();
  watch(() => settingsStore.currency, () => void fetchExchangeRate());

  const investAmountBch = ref(""); //ref("0");
  const investAmountCurrency = ref("");
  const investButtonDisabled = ref(false);
  const investStatusMessage = ref(" ");
  const estimatedTokensBought = ref(0n);

  const donateAmountOla = ref("0");
  const donateButtonDisabled = ref(false);
  const donateStatusMessage = ref(" ");
  const newAdminMultisigContractAddress = ref<string>("");
  const newIssuanceFundContractAddress = ref<string>("");

  const dissolveExpanded = ref(false);
  const migrateExpanded = ref(false);
  const issuanceContractUtxo = ref<Utxo | undefined>(undefined);
  const issuanceContractStats = ref<Awaited<ReturnType<typeof getContractState>> | undefined>(undefined);
  const contractDeployed = ref<boolean | undefined>(undefined);
  const showSignRawTxHex = ref(false);
  const showRawTxHex = ref<boolean>(false);
  const rawTxHex = ref<string | undefined>();
  const signRawTxHex = ref<undefined | (() => Promise<void>)>(undefined);
  const disabled = ref(false);

  const adminWallet = store.wallet as Wallet | TestNetWallet

  const pubkey = adminWallet.publicKeyCompressed ?? Uint8Array.from([])
  const privKey = adminWallet.privateKey
  const address = adminWallet.cashaddr

  const isAdmin = adminPubkeys.includes(binToHex(pubkey));

  const provider = new ElectrumNetworkProvider(Network.MAINNET, {
    manualConnectionManagement: true,
  });
  void provider.connect();

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
    void navigator.clipboard.writeText(copyText);
    Notify.create({
      message: "Copied!",
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }

  const deployContract = async () => {
    if (!adminWallet.privateKey) {
      const errorMessage = `Deployment can be done only from admin single-address wallet`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });
      console.error(errorMessage);
    }

    disabled.value = true;
    try {
      await deployContractFromAuthGuard({
        wallet: adminWallet,
        provider: provider,
        councilContract: councilMultisigContract,
        adminContract: adminMultisigContract,
        olandoCategory: olandoCategory,
      });
    } catch (e) {
      const errorMessage = `Failed to deploy contract: ${caughtErrorToString(e).split("\n")[0]}`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });
      console.error(e);
    }
    disabled.value = false;
  };

  const initiateDissolveContract = async () => {
    if (!adminWallet.privateKey) {
      const errorMessage = `Dissolve can be done only from admin single-address wallet`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });
      console.error(errorMessage);
    }

    disabled.value = true;
    try {
      const sigTemplate = new SignatureTemplate(adminWallet.privateKey, HashType.SIGHASH_ALL, SignatureAlgorithm.ECDSA);
      rawTxHex.value = await dissolveIssuanceFund({
        wallet: adminWallet,
        provider: provider,
        olandoCategory: olandoCategory,
        councilMultisigContract,
        adminMultisigContract,
        signatures: [sigTemplate, Uint8Array.from(Array(71))],
        send: false,
      });
      // console.log("Partial transaction hex:", dissolvePartialTxHex.value);
      showRawTxHex.value = true;
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
        partiallySignedTxHex: rawTxHex.value!,
        privateKey: privKey,
        send: true,
      });
      console.log("Signed transaction hex:", signedTxHex);
      showSignRawTxHex.value = false;
      rawTxHex.value = undefined;
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
    if (!adminWallet.privateKey) {
      const errorMessage = `Migration can be done only from admin single-address wallet`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });
      console.error(errorMessage);
    }

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

    console.log("creating tx (calling migrate())");
    try {
      const sigTemplate = new SignatureTemplate(adminWallet.privateKey, HashType.SIGHASH_ALL, SignatureAlgorithm.ECDSA);
      rawTxHex.value = await migrate({
        provider: provider,
        adminMultisigContract,
        councilMultisigContract,
        newAdminMultisigContractAddress: newAdminMultisigContractAddress.value,
        newIssuanceFundContractAddress: newIssuanceFundContractAddress.value,
        wallet: adminWallet,
        signatures: [sigTemplate, Uint8Array.from(Array(71))],
        olandoCategory: olandoCategory,
        send: false,
      });
      // console.log("Partial transaction hex:", dissolvePartialTxHex.value);
      showRawTxHex.value = true;
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
    if (!adminWallet.privateKey) {
      const errorMessage = `Migration can be done only from admin single-address wallet`;
      Notify.create({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      });
      console.error(errorMessage);
    }

    disabled.value = true;
    try {
      const signedTxHex = await addMultisigSignature({
        provider: provider,
        adminMultisigContract: adminMultisigContract,
        multisigInputIndex: 1,
        partiallySignedTxHex: rawTxHex.value!,
        privateKey: privKey,
        send: true,
      });
      // console.log("Signed transaction hex:", signedTxHex);
      showSignRawTxHex.value = false;
      rawTxHex.value = undefined;
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

  const invest = async (send: boolean) => {
    if (send) {
      disabled.value = true;
    }

    const investAmountValue = Number(parseFloat(investAmountBch.value).toFixed(8));
    if (investAmountValue <= 0) {
      investStatusMessage.value = `Investment amount too low`;
      disabled.value = false;
      return;
    }

    try {
      const tokensBought = await investInIssuanceFund({
        investAmountBch: investAmountValue,
        provider: provider,
        wallet: store.wallet as WalletType,
        councilMultisigContract: councilMultisigContract,
        adminMultisigContract: adminMultisigContract,
        olandoCategory: olandoCategory,
        send: send,
      });

      if (send) {
        Notify.create({
          message: `Successfuly bought ${Number(tokensBought) / 10**2} ${olandoSymbol}. The same amount was also sent to the Community Council Fund`,
          color: "positive",
        });
      }
      estimatedTokensBought.value = tokensBought;
    } catch (e) {
      const errorMessage = `Failed to create invest transaction: ${caughtErrorToString(e).split("\n")[0]}`;
      investStatusMessage.value = errorMessage;
    }
    disabled.value = false;
  };

  function investMaxClick() {
    const satBalance = store.balance ?? 0n;
    if (satBalance < 50000n) {
      return;
    }
    const bchValue = (Number(satBalance) - 50000) / 1e8;
    investAmountBch.value = String(bchValue);
    if (exchangeRate.value) {
      investAmountCurrency.value = (bchValue * exchangeRate.value).toFixed(2);
    }
    investAmountChange({ target: { value: String(bchValue) } } as unknown as Event);
  };

  function investAmountChange(event: Event) {
    try {
      investButtonDisabled.value = true;
      investStatusMessage.value = ` `;
      const balance = store.balance ?? 0n;
      const bchValue = Number((event.target as HTMLInputElement).value);
      const investAmountValue = Math.floor(bchValue * 10 ** 8);

      // sync currency field
      if (exchangeRate.value && bchValue > 0) {
        investAmountCurrency.value = (bchValue * exchangeRate.value).toFixed(2);
      } else {
        investAmountCurrency.value = "";
      }

      if (investAmountValue < 0.001 * 10 ** 8) {
        investStatusMessage.value = `Buy amount too low`;
        return;
      }
      if (investAmountValue > Number(balance) - 50000) {
        investStatusMessage.value = `Swap not possible, you have too few BCH`;
        return;
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

  function investCurrencyAmountChange(event: Event) {
    try {
      investButtonDisabled.value = true;
      investStatusMessage.value = ` `;

      if (!exchangeRate.value) return;

      const currencyValue = Number((event.target as HTMLInputElement).value);
      if (!currencyValue || currencyValue <= 0) {
        investAmountBch.value = "";
        return;
      }

      const bchValue = currencyValue / exchangeRate.value;
      investAmountBch.value = bchValue.toFixed(8);

      const balance = store.balance ?? 0n;
      const investAmountSats = Math.floor(bchValue * 10 ** 8);

      if (investAmountSats < 0.001 * 10 ** 8) {
        investStatusMessage.value = `Buy amount too low`;
        return;
      }
      if (investAmountSats > Number(balance) - 50000) {
        investStatusMessage.value = `Swap not possible, you have too few BCH`;
        return;
      }

      investButtonDisabled.value = false;
    } catch (e) {
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
        wallet: store.wallet as WalletType,
        provider: provider,
        olandoCategory: olandoCategory,
        councilMultisigContract: councilMultisigContract,
        adminMultisigContract: adminMultisigContract,
        donationTokenAmount: BigInt(olaAmount * 10**olandoDecimals),
      });

      Notify.create({
        message: `Donation of ${olaAmount} ${olandoSymbol} sent to the Community Council Fund`,
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
    const utxos = store.walletUtxos?.filter(utxo => utxo.token?.category === olandoCategory);
    const max = utxos?.reduce((acc, utxo) => acc + (utxo.token?.amount ?? 0n), 0n) ?? 0n;
    const decimals = 2;
    const maxAmount = Number(max) / 10**decimals;
    donateAmountOla.value = String(maxAmount);
    donateAmountChange({ target: { value: String(maxAmount) } } as unknown as Event);
  };

  function donateAmountChange(event: Event) {
    try {
      donateButtonDisabled.value = true;
      donateStatusMessage.value = ` `;

      const utxos = store.walletUtxos?.filter(utxo => utxo.token?.category === olandoCategory);
      const max = utxos?.reduce((acc, utxo) => acc + (utxo.token?.amount ?? 0n), 0n) ?? 0n;
      const decimals = 2;
      const maxAmount = Number(max) / 10**decimals;

      const donateAmountValue = Number((event.target as HTMLInputElement).value);

      if (donateAmountValue <= 0) {
        donateStatusMessage.value = `Donation amount too low`;
        donateAmountOla.value = String(0);
        return;
      }

      if (donateAmountValue > maxAmount) {
        donateStatusMessage.value = `Donation amount exceeds available ${olandoSymbol} balance`;
        return;
      }

      if (BigInt(Math.floor(donateAmountValue * 10**2)) + issuanceContractStats.value!.currentSupply > MaxTokenSupply) {
        donateStatusMessage.value = `Donation amount exceeds maximum ${olandoSymbol} supply allowed to be held by the contract`;
        return;
      }

      if (donateAmountValue > 0) {
        donateButtonDisabled.value = false;
      }
    } catch (e) {
      donateButtonDisabled.value = true;
    }
  };

  // rostrum handling
  const pools = ref(undefined as undefined | ActivePoolsResult);

  const poolsCallback = (response: RPCParameter[] | undefined) => {
    if (response instanceof Error || !response) {
      console.error("ElectrumCash callback error:", response);
      return;
    }

    const rostrumResponse = (response[2] ?? response) as RostrumCauldronContractSubscribeResponse;

    if (!rostrumResponse.utxos) {
      console.error("ElectrumCash callback error: no data", response);
      return;
    }

    pools.value = {
      active: rostrumResponse.utxos.map(utxo => ({
        owner_p2pkh_addr: "",
        owner_pkh: utxo.pkh,
        sats: utxo.sats,
        token_id: utxo.token_id,
        tokens: utxo.token_amount,
        tx_pos: utxo.new_utxo_n,
        txid: utxo.new_utxo_txid,
      }) as ActivePoolEntry)

      // limit to 10 most liquid pools
      .sort((a, b) => b.sats - a.sats).filter((_, index) => index < 10)
    };
  }

  const subscribeCallback = async (response: RPCParameter[] | undefined) => {
    const rawUtxos = await electrumClient.request("blockchain.address.listunspent", issuanceContract.address, "include_tokens") as (RostrumUtxo)[];
    const utxos = rawUtxos.map((utxo) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      satoshis: BigInt(utxo.value),
      token: utxo.has_token ? {
        amount: BigInt(utxo.token_amount ?? 0),
        category: utxo.token_id,
        nft: {
          capability: "mutable",
          commitment: utxo.commitment,
        }
      } : undefined,
    } as Utxo)).filter(utxo => utxo.token?.category === olandoCategory);

    if (utxos.length > 0) {
      issuanceContractUtxo.value = utxos[0] as Utxo;
      contractDeployed.value = true;
    } else {
      issuanceContractUtxo.value = undefined;
      contractDeployed.value = false;
    }
  }

  const webSocket = new ElectrumWebSocket(
    "rostrum.riften.net",
    443,
    true,
    30000,
  );

  const electrumClient = new ElectrumClient("OlandoWallet", "1.4.3", webSocket, {
      disableBrowserConnectivityHandling: true,
      disableBrowserVisibilityHandling: true,
  });
  electrumClient.on("notification", (notification) => {
    if (notification.method === "cauldron.contract.subscribe") {
      poolsCallback(notification.params);
    } else if (notification.method === "blockchain.address.subscribe") {
      void subscribeCallback(notification.params);
    }
  });
  void electrumClient.connect().then(async () => {
    await electrumClient.subscribe("cauldron.contract.subscribe", 2, olandoCategory);
    await electrumClient.subscribe("blockchain.address.subscribe", issuanceContract.address);
  });

  onBeforeUnmount(async () => {
    await electrumClient.unsubscribe("cauldron.contract.subscribe", 2, olandoCategory);
    await electrumClient.unsubscribe("blockchain.address.subscribe", issuanceContract.address);
    await electrumClient.disconnect(true, false);

    await provider.disconnect();
  });

  watch([issuanceContractUtxo, pools], async () => {
    if (!issuanceContractUtxo.value || !pools.value || pools.value.active.length === 0) {
      return;
    }

    issuanceContractStats.value = await getContractState({
      issuanceContractUtxo: issuanceContractUtxo.value,
      investAmountBch: Number(investAmountBch.value),
      pools: pools.value,
    });
  });

</script>

<template>
  <div>
    <!-- key display -->
    <!--
      <div style="margin-bottom: 2rem;">Your public key: {{ binToHex(pubkey) }}</div>
      <div style="margin-bottom: 2rem;">Olando category: {{ olandoCategory }}</div>
    -->
    <fieldset class="olando" style="margin-top: 20px; padding-top: 2rem; max-width: 75rem; margin: auto 10px;">
      <!--<legend>Buy {{ olandoName }}</legend>-->
      <div v-if="contractDeployed === true" style="display: flex; flex-direction: column;">
        <div style="">
          <h5>Here you can buy {{ olandoSymbol }} with BCH with a solitary
effect.</h5>
          <br/>
        </div>
<!--        <div style="">Buying {{ olandoName }} is beneficial for the community. You buy {{ olandoSymbol }} tokens from Cauldron at a 5% premium and unlock the same amount to be sent to the Community Council Fund which distributes it to help various community projects.</div>-->
        <div style="display: flex; flex-direction: column; gap: 2rem;">
          <div class="amount-input-grid">
            <div class="framed-input">
            <input class="framed-input" :disabled="disabled" v-model="investAmountBch" @input="(event: Event) => investAmountChange(event)" placeholder="Amount BCH" type="number" />
            </div>

            <input :disabled="disabled" @click="() => investMaxClick()" type="button" value="max">
            <template v-if="exchangeRate">
              <input :disabled="disabled" v-model="investAmountCurrency" @input="(event: Event) => investCurrencyAmountChange(event)" class="fiat-input" :placeholder="`Amount ${CurrencyShortNames[settingsStore.currency]}`" type="number" />
              <span class="fiat-icon">{{ CurrencySymbols[settingsStore.currency] }}</span>
            </template>
          </div>
          <div style="display: flex; flex-direction: column; align-items: center;">
            <span style="margin-bottom: 1rem;">{{ issuanceContractStats?.cauldronTradeAdjustedTokenAmount ?? 0n > 0n ? `You will receive ${(Number(issuanceContractStats!.cauldronTradeAdjustedTokenAmount) / 10**2).toLocaleString("en-US")} ${olandoSymbol} ` : '' }}</span>
            <span style="margin-bottom: 1rem;">{{ issuanceContractStats?.cauldronTradeAdjustedTokenAmount ?? 0n > 0n ? `You will mirror ${(Number(issuanceContractStats!.cauldronTradeAdjustedTokenAmount) / 10**2).toLocaleString("en-US")} ${olandoSymbol} ` : '' }}</span>
            <input @click="invest(true)" type="button" class="primaryButton" value="Buy" :disabled="investButtonDisabled || disabled">
            <span style="margin-top: 1rem; background-color: indianred; padding-left: 0.5rem; padding-right: 0.5rem;">{{ investStatusMessage }}</span>
          </div>
        </div>

        <!-- explanatory propaganda -->

        <div style="padding-top: 30px">
          Every <b>payment</b> for goods and services with OLANDO increase <b>freedom</b> and promotes a free means of payment.
          <br/><br/>
          OLANDO is a symbol for the real value of human life, not just the exchange rate.
          <br/><br/>
          The conversion rate with BCH is reduced by 5% as security fee to prevent abuse. A maximum of 8.888 billion OLANDO will be issued. The amount of OLANDO issued is dynamically limited to prevent excessive hoarding.
          <br/><br/>
          More info: <a href="http://www.olando.club">www.olando.club</a>
        </div>
        <!--
        <hr />
        <div>Already have {{ olandoSymbol }} and want to give it back to issuance fund? Want to help the community grow? Donate today!</div>
        <div style="display: flex; flex-direction: column; gap: 2rem;">
          <div style="display: flex; flex-direction: row; gap: 2rem; margin-top: 8px;">
            <input :disabled="disabled" v-model="donateAmountOla" @input="(event: Event) => donateAmountChange(event)" style="width: 100%;" placeholder="Amount {{ olandoName }}" type="number" />
            <input :disabled="disabled" @click="() => donateMaxClick()" type="button" class="primaryButton" value="max" style="padding:12px;">
          </div>
          <div style="display: flex; flex-direction: column; align-items: center;">
            <input @click="donateToFund()" type="button" class="primaryButton" value="Donate" :disabled="donateButtonDisabled || disabled">
            <span style="margin-top: 1rem; background-color: indianred; padding-left: 0.5rem; padding-right: 0.5rem;">{{ donateStatusMessage }}</span>
          </div>
        </div>
        -->
      </div>
      <div v-else-if="contractDeployed === false" style="display: flex; flex-direction: column;">
        <div style="margin-bottom: 2rem;"><h4>Contract is not deployed yet. Admins should deploy it first.</h4></div>
        <div style="margin-bottom: 2rem;">
          AdminA pubkey: <b>{{ adminPubkeys[0] }}</b>
          AdminB pubkey: <b>{{ adminPubkeys[1] }}</b>
          AdminC pubkey: <b>{{ adminPubkeys[2] }}</b>
        </div>
        <div style="margin-bottom: 2rem;">issuanceFundContract.address: <b>{{ newIssuanceFundContractAddress }}</b></div>
        <div style="margin-bottom: 2rem;">councilMultisigContract.address: <b>{{ councilMultisigContract.address }}</b></div>
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
        <input :disabled="disabled" @click="deployContract()" type="button" class="primaryButton" value="Deploy Contract" style="margin-top: 8px;">
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
        <div class="text-h6" style="font-size: small; margin-top: 0.5rem;">Send this multisig transaction to other signers to add their signatures and complete the transaction.</div>
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

  <!-- loading -->
  <q-dialog backdrop-filter="blur(0px)" transition-duration="0" v-model="disabled" :persistent="true">
    <q-card style="height: 120px; min-width: 240px; background-color: rgba(71, 71, 71, 0.9); display: flex; flex-direction: column; justify-content: center; align-items: center;">
      <q-spinner
        color="primary"
        size="3em"
      />
      <div style="font-size: large; font-weight: bold; margin-top: 1rem;">Please Wait</div>
    </q-card>
  </q-dialog>
</template>

<style>
  .q-field__control-container > textarea {
    color: white;
    border: 1px solid #ccc;
    padding: 3px
  }
  .fiat-input {
    width: 100%;
    background-color: rgba(255, 255, 255, 0.5);
  }
  .fiat-icon {
    min-width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    font-size: 1.5em;
    border-radius: 50%;
    /* border: 1px solid rgba(0, 0, 0, 0.3); */
  }
  body.dark .fiat-icon {
    /* border: 1px solid rgba(255, 255, 255, 0.3); */
    color: grey;
  }

  .amount-input-grid {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 1rem 2rem;
    align-items: center;
  }
  .framed-input {
    margin-left: 0 !important;
  }
</style>
