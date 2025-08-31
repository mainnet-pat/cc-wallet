<script setup lang="ts">
  import { ref, watch, computed, onBeforeUnmount } from 'vue';
  import { useStore } from 'src/stores/store';
  import { type BcmrTokenMetadata } from 'src/interfaces/interfaces';
  import { type ActivePoolEntry, type ActivePoolsResult, broadcastTrade, fundProposedTrade, NATIVE_BCH_TOKEN_ID, proposeTrade, type RostrumCauldronContractSubscribeResponse, type TradeProposal } from 'src/utils/cauldron';

  import { ElectrumClient, type RPCParameter } from "@electrum-cash/network";
  import { ElectrumWebSocket } from "@electrum-cash/web-socket";
  import { type TestNetWallet, type Wallet } from 'mainnet-js';
  import { caughtErrorToString } from 'src/utils/errorHandling';

  const store = useStore();

  const props = defineProps<{
    tokenBalance: bigint;
    tokenId: string,
    tokenMetadata: BcmrTokenMetadata | undefined,
  }>()

  const showIcon = ref(true)
  const emit = defineEmits(['closeDialog']);
  watch(showIcon, () => emit('closeDialog'))
  const assetA = ref(NATIVE_BCH_TOKEN_ID);
  const assetB = ref(props.tokenId);
  const amountA = ref("0");
  const amountB = ref("0");
  const assetAIcon = computed(() => store.tokenIconUrl(assetA.value));
  const assetBIcon = computed(() => store.tokenIconUrl(assetB.value));
  const decimalsA = computed(() => assetA.value === NATIVE_BCH_TOKEN_ID ? 8 : props.tokenMetadata?.token.decimals ?? 0);
  const decimalsB = computed(() => assetB.value === NATIVE_BCH_TOKEN_ID ? 8 : props.tokenMetadata?.token.decimals ?? 0);
  const swapButtonDisabled = ref(true);
  const tradeProposal = ref(undefined as undefined | TradeProposal);
  const statusMessage = ref(" ");

  function swapAssets() {
    const assetAValue = assetA.value;
    const assetBValue = assetB.value;
    assetA.value = assetBValue;
    assetB.value = assetAValue;

    const amountBValue = amountB.value;
    amountA.value = amountBValue;

    amountAChange({ target: { value: amountBValue } } as unknown as Event);
  }

  async function amountAChange(event: Event) {
    try {
      const amountAValue = Math.floor(Number((event.target as HTMLInputElement).value) * 10 ** decimalsA.value);
      if (amountAValue === 0) {
        return;
      }
      const tradeResult = await proposeTrade({
        supplyTokenId: assetA.value,
        demandTokenId: assetB.value,
        supplyAmount: BigInt(amountAValue),
        activePools: pools.value!,
      });
      tradeProposal.value = tradeResult;

      amountB.value = (Number(tradeResult.summary.demand) / 10 ** decimalsB.value).toFixed(decimalsB.value);

      if (assetB.value === NATIVE_BCH_TOKEN_ID && tradeResult.summary.demand < 1000) {
        throw Error("Receiving BCH amount too low");
      }

      if (assetB.value === NATIVE_BCH_TOKEN_ID && BigInt(amountAValue) > props.tokenBalance) {
        throw Error("Insufficient token balance");
      }

      if (assetA.value === NATIVE_BCH_TOKEN_ID && amountAValue > (store.balance?.sat ?? 0)) {
        throw Error("Insufficient balance");
      }

      statusMessage.value = `Price impact: ${(tradeResult.priceImpact * 100).toFixed(2)}%`;
      swapButtonDisabled.value = false;
    } catch (e) {
      let message = caughtErrorToString(e);
      if (message === "Nothing available to trade.") {
        message = "No pools for this token on Cauldron";
      }
      statusMessage.value = message;
      swapButtonDisabled.value = true;
    }
  }

  async function amountBChange(event: Event) {
    try {
      const amountBValue = Math.floor(Number((event.target as HTMLInputElement).value) * 10 ** decimalsB.value);
      if (amountBValue === 0) {
        return;
      }
      const tradeResult = await proposeTrade({
        supplyTokenId: assetA.value,
        demandTokenId: assetB.value,
        demandAmount: BigInt(amountBValue),
        activePools: pools.value!,
      });
      tradeProposal.value = tradeResult;

      amountA.value = (Number(tradeResult.summary.supply) / 10 ** decimalsA.value).toFixed(decimalsA.value);

      if (assetA.value === NATIVE_BCH_TOKEN_ID && tradeResult.summary.supply < 1000) {
        throw Error("BCH amount too low");
      }

      statusMessage.value = `Price impact: ${(tradeResult.priceImpact * 100).toFixed(2)}%`;
      swapButtonDisabled.value = false;
    } catch (e) {
      let message = caughtErrorToString(e);
      if (message === "Nothing available to trade.") {
        message = "No pools for this token on Cauldron";
      }
      statusMessage.value = message;
      swapButtonDisabled.value = true;
    }
  }

  function maxClick() {
    if (assetA.value === NATIVE_BCH_TOKEN_ID) {
      const satBalance = store.balance?.sat ?? 0;
      if (satBalance < 10000) {
        return;
      }
      amountA.value = String((satBalance - 10000) / 1e8);
      amountAChange({ target: { value: String((satBalance - 10000) / 1e8) } } as unknown as Event);
    } else {
      amountA.value = String(Number(props.tokenBalance) / 10 ** decimalsA.value);
      amountAChange({ target: { value: String(Number(props.tokenBalance) / 10 ** decimalsA.value) } } as unknown as Event);
    }
  }

  function onFocus(event: Event) {
    if (!Number((event.target as HTMLInputElement).value)) {
      (event.target as HTMLInputElement).select();
    }
  }

  async function swapClick() {
    if (swapButtonDisabled.value) {
      return;
    }

    if (!tradeProposal.value) {
      return;
    }

    swapButtonDisabled.value = true;

    try {
      statusMessage.value = "Swapping...";
      const tradeTxList = await fundProposedTrade({wallet: store.wallet as Wallet | TestNetWallet, tradeProposal: tradeProposal.value});

      await broadcastTrade(store.wallet as Wallet | TestNetWallet, tradeTxList);
      statusMessage.value = "Swapped!";
    } catch (e) {
      statusMessage.value = caughtErrorToString(e);
      console.log(e);
      swapButtonDisabled.value = false;
    }

    amountAChange({ target: { value: amountA.value } } as unknown as Event);
  }

  // rostrum handling
  const pools = ref(undefined as undefined | ActivePoolsResult);

  const callback = (response: RPCParameter[] | undefined) => {
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
    };
  }

  const webSocket = new ElectrumWebSocket(
    "rostrum.cauldron.quest",
    50004,
    true,
    30000,
  );

  const electrumClient = new ElectrumClient("Cashonize", "1.4.3", webSocket, {
      disableBrowserConnectivityHandling: true,
      disableBrowserVisibilityHandling: true,
  });
  electrumClient.on("notification", (notification) => {
    if (notification.method === "cauldron.contract.subscribe") {
      callback(notification.params);
    }
  });
  electrumClient.connect().then(async () => {
    await electrumClient.subscribe("cauldron.contract.subscribe", 2, props.tokenId);
  });

  onBeforeUnmount(async () => {
    await electrumClient.unsubscribe("cauldron.contract.subscribe", 2, props.tokenId);
    await electrumClient.disconnect(true, false);
  });
</script>

<template>
  <q-dialog v-model="showIcon" style="">
      <q-card>
        <!-- <q-card-section class="row items-center q-pb-none text-white">
          <q-space />
          <q-btn icon="close" color="white" flat round dense v-close-popup/>
        </q-card-section> -->

        <q-card-section>
          <div style="display: flex; justify-content: center;padding-left:20px;padding-right:20px;">
            <div class="text-h4">Swap {{ tokenMetadata?.name || `${tokenId.slice(0, 8)}...${tokenId.slice(64-8)}` }} on Cauldron</div>
          </div>
        </q-card-section>

        <div style="padding:32px;padding-top: 0px;">
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <div id="statusMessage" style="color: rgb(173,112,0);">{{ statusMessage }}</div>
            <div style="display: flex; align-items: center;">
              <input v-model="amountA" @input="(event: Event) => amountAChange(event)" @focus="onFocus" style="width: 100%;" placeholder="Amount" />
              <input @click="() => maxClick()" type="button" id="max" class="primaryButton" value="max" style="padding:12px; margin-left: 1rem;">
              <img :src="assetAIcon as any" style="border-radius: 50%; width: 32px; height: 32px; margin-left: 16px;" />
            </div>
            <div style="display: flex; width: 100%; justify-content: center;">
               <div @click="swapAssets" class="flip" style="font-weight: bolder; font-size: 24px; width: 36px; text-align: center; cursor: pointer;">↓</div>
            </div>
            <div style="display: flex; align-items: center;">
              <input v-model="amountB" @input="(event: Event) => amountBChange(event)" @focus="onFocus" style="width: 100%;" placeholder="Amount" />
              <img :src="assetBIcon as any" style="border-radius: 50%; width: 32px; height: 32px; margin-left: 16px;" />
            </div>

            <input @click="swapClick" :disabled="swapButtonDisabled" type="button" id="swap" class="primaryButton" value="Swap" style="margin: auto;">
          </div>
        </div>
      </q-card>
    </q-dialog>
</template>

<style scoped>
.q-card{
  background: var(--bg-color);
}
.row {
  margin-right: 0px;
}
.flip {
  transition: transform .2s ease-in-out;
}
.flip:hover {
  transform: rotate(180deg);
}
</style>