<script setup lang="ts">
  import Toggle from '@vueform/toggle'
  import { computed, ref, watch } from 'vue';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import TransactionDialog from './transactionDialog.vue';
  import { TransactionHistoryItem } from 'mainnet-js/dist/module/history/interface';
  import { convert } from 'mainnet-js';
  import JSON5 from '@mainnet-pat/json5-bigint';
import { useWindowSize } from '@vueuse/core';

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const store = useStore();
  const settingsStore = useSettingsStore();
  const useCurrency = ref(settingsStore.historyUseCurrency);

  watch(useCurrency, async () => {
    history.value = await processHistoryCurrency(store.history, useCurrency.value ? settingsStore.currency : settingsStore.bchUnit);
    localStorage.setItem("historyUseCurrency", useCurrency.value.toString());
  });

  const processHistoryCurrency = async (history: TransactionHistoryItem[] | undefined, unit: string): Promise<TransactionHistoryItem[] | undefined> => {
    if (!history) {
      return history;
    }

    if (unit.includes("sat")) {
      return history;
    }

    // structuredClonse does not seem to work with refs?
    // const copy = structuredClone(history) as TransactionHistoryItem[];
    const copy = JSON5.parse(JSON5.stringify(history)) as TransactionHistoryItem[];

    for (const transaction of copy) {
      for (const input of transaction.inputs) {
        input.value = await convert(input.value, "sat", unit);
      }

      for (const output of transaction.outputs) {
        output.value = await convert(output.value, "sat", unit);
      }

      transaction.valueChange = await convert(transaction.valueChange, "sat", unit);
      transaction.balance = await convert(transaction.balance, "sat", unit);
    }

    return copy;
  };

  const reloadHistory = () => {
    store.wallet?.getHistory({}).then(async (result) => {
      store.history = result;
      history.value = await processHistoryCurrency(result, useCurrency.value ? settingsStore.currency : settingsStore.bchUnit);
    });
    store.shouldReloadHistory = false;
  }

  const history = ref(store.shouldReloadHistory ? undefined : await processHistoryCurrency(store.history, useCurrency.value ? settingsStore.currency : settingsStore.bchUnit) as TransactionHistoryItem[] | undefined)

  if (store.history === undefined || store.shouldReloadHistory) {
    reloadHistory();
  }

  const loadedTokenIds = store.tokenList?.map(token => token.tokenId) ?? [];
  const tokenIds = (store.history?.map(transaction => transaction.tokenAmountChanges.map(tokenChange => tokenChange.tokenId)) ?? [])
    .flat()
    .filter((value, index, array) => array.indexOf(value) === index)
    .filter(tokenId => !loadedTokenIds.includes(tokenId));

  store.importRegistries(tokenIds.map(tokenId => ({tokenId} as any)), false);

  const selectedTransaction = ref(undefined as TransactionHistoryItem | undefined)
</script>

<template>
  <div class="history">
    <TransactionDialog v-if="selectedTransaction" :bcmr-registries="store.bcmrRegistries" :history-item="selectedTransaction" :unit="(useCurrency ? settingsStore.currency : settingsStore.bchUnit).toLocaleUpperCase()" @hide="() => {selectedTransaction = undefined}"></TransactionDialog>

    <div v-if="history === undefined" style="text-align: center;">Loading history ...</div>
    <div v-if="history && history.length === 0" style="text-align: center;">No transactions in this wallet</div>

    <fieldset v-if="history?.length" style="position: relative;">
      <legend></legend>
      <div style="display: flex; justify-content: end; align-items: center;">
        {{ settingsStore.bchUnit.toLocaleUpperCase() }}
        <Toggle v-model="useCurrency" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
        {{ settingsStore.currency.toLocaleUpperCase() }}
      </div>
      <table class="">
        <thead>
          <tr>
            <th scope="col"></th>
            <th scope="col">Date</th>
            <th scope="col" class="valueHeader">Amount</th>
            <th scope="col" class="valueHeader">Balance</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody class="body">
          <tr :class="settingsStore.darkMode ? 'dark' : ''" v-for="transaction in history" :key="transaction.hash" @click="() => {selectedTransaction = transaction}">
            <td>{{ transaction.timestamp ? "✅" : "⏳" }}</td>
            <td v-if="isMobile">{{ transaction.timestamp ? new Date(transaction.timestamp * 1000).toLocaleString().replace("202", "2").replace(",", "") : "Unconf." }}</td>
            <td v-else>{{ transaction.timestamp ? new Date(transaction.timestamp * 1000).toLocaleString() : "Unconfirmed" }}</td>
            <td class="value" v-if="transaction.valueChange >= 0">{{ `+${transaction.valueChange}` }}</td>
            <td v-else class="value" style="color: rgb(188,30,30)"> {{ `${transaction.valueChange}` }}</td>
            <td class="value">{{ transaction.balance }}</td>
            <td v-if="transaction.tokenAmountChanges.length">
              <div class="tokenChange" v-for="tokenChange in transaction.tokenAmountChanges" :key="tokenChange.tokenId">
                <span v-if="tokenChange.amount !== 0n">
                  <span v-if="tokenChange.amount > 0n" class="value">+{{ Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0) }}</span>
                  <span v-else class="value" style="color: rgb(188,30,30)">{{ Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0) }}</span>
                  <span class="break"> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }}</span>
                </span>
                <span v-if="tokenChange.nftAmount !== 0n">
                  <span v-if="tokenChange.nftAmount > 0n" class="value">+{{ tokenChange.nftAmount }}</span>
                  <span v-else class="value" style="color: rgb(188,30,30)">{{ tokenChange.nftAmount }}</span>
                  <span class="break"> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }} NFT</span>
                </span>

                <img v-if="store.bcmrRegistries?.[tokenChange.tokenId]" id="tokenIcon" class="tokenIcon" style="width: 20px; height: 20px; border-radius: 50%;" :src="store.tokenIconUrl(tokenChange.tokenId)">
              </div>
            </td>
            <td v-else></td>
          </tr>
        </tbody>
      </table>

    </fieldset>
  </div>
</template>

<style lang="css">
th.valueHeader {
  text-align: right;
}
tr:nth-child(even) {
  background-color: var(--color-background-soft);
}
tr.dark:nth-child(even) {
  background-color: #232326;
}

.body > * {
  font-size: small;
}

.value {
  font-family: monospace;
  text-align: right;
}

.tokenChange {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.tokenChange > img {
  margin-left: 5px;
}

.break {
  word-break: break-all;
}

</style>