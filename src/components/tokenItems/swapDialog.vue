<script setup lang="ts">
  import { ref, watch, computed, onBeforeUnmount } from 'vue';
  import { useStore } from 'src/stores/store';
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { bcmrTokenMetadata } from 'src/interfaces/interfaces';
  import { ActivePoolEntry, ActivePoolsResult, broadcastTrade, fundProposedTrade, NATIVE_BCH_TOKEN_ID, proposeTrade, RostrumCauldronContractSubscribeResponse, TradeProposal } from 'src/utils/cauldron';

  import { ElectrumClient } from "electrum-cash";

  const store = useStore();
  const settingsStore = useSettingsStore();

  const props = defineProps<{
    tokenBalance: bigint;
    tokenId: string,
    tokenMetadata: bcmrTokenMetadata | undefined,
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

    amountAChange({target: {value: amountBValue}} as any);
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
        demandAmount: undefined,
        activePools: pools.value,
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
    } catch (e: any) {
      let message = e.message;
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
        supplyAmount: undefined,
        demandAmount: BigInt(amountBValue),
        activePools: pools.value,
      });
      tradeProposal.value = tradeResult;

      amountA.value = (Number(tradeResult.summary.supply) / 10 ** decimalsA.value).toFixed(decimalsA.value);

      if (assetA.value === NATIVE_BCH_TOKEN_ID && tradeResult.summary.supply < 1000) {
        throw Error("BCH amount too low");
      }

      statusMessage.value = `Price impact: ${(tradeResult.priceImpact * 100).toFixed(2)}%`;
      swapButtonDisabled.value = false;
    } catch (e: any) {
      let message = e.message;
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
      amountAChange({target: {value: String((satBalance - 10000) / 1e8)}} as any);
    } else {
      amountA.value = String(Number(props.tokenBalance) / 10 ** decimalsA.value);
      amountAChange({target: {value: String(Number(props.tokenBalance) / 10 ** decimalsA.value)}} as any);
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
      const tradeTxList = await fundProposedTrade({wallet: store.wallet as any, tradeProposal: tradeProposal.value});

      await broadcastTrade(store.wallet as any, tradeTxList);
      statusMessage.value = "Swapped!";
    } catch (e: any) {
      statusMessage.value = e.message;
      swapButtonDisabled.value = false;
    }

    amountAChange({target: {value: amountA.value}} as any);
  }

  // rostrum handling
  const pools = ref(undefined as undefined | ActivePoolsResult);

  const callback = (response: RostrumCauldronContractSubscribeResponse) => {
    pools.value = {
      active: response.utxos.map(utxo => ({
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

  const electrumClient = new ElectrumClient("Cashonize", "1.4.3", "rostrum.cauldron.quest", 50004, "wss");
  electrumClient.connect().then(async () => {
    await electrumClient.subscribe(callback as any, "cauldron.contract.subscribe", 2, props.tokenId);
  });

  onBeforeUnmount(async () => {
    await electrumClient.unsubscribe(callback as any, "cauldron.contract.subscribe", 2, props.tokenId);
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
              <img @click="swapAssets" class="flip" :src="settingsStore.darkMode ? 'images/arrow-small-down-dark.svg' : 'images/arrow-small-down.svg'" style="width: 32px; height: 32px; cursor: pointer;" />
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
img.flip {
  transition: transform .2s ease-in-out;
}
img.flip:hover {
  transform: rotate(180deg);
}
</style>