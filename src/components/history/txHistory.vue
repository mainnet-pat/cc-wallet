<script setup lang="ts">
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { useStore } from 'src/stores/store'
  import { computed, ref } from 'vue';
  import { asyncComputed, useWindowSize } from '@vueuse/core';
  import { convert, ExchangeRate, type TransactionHistoryItem } from 'mainnet-js';
  import TransactionDialog from './transactionDialog.vue';
  import EmojiItem from '../general/emojiItem.vue';
  import { formatTimestamp, formatFiatAmount } from 'src/utils/utils';
  import { fetchCurrentTokenPrice, fetchHistoricTokenPrice } from 'src/utils/priceUtils';
  import { type TokenDataFT } from 'src/interfaces/interfaces';
  import { CurrencySymbols } from 'src/interfaces/interfaces';

  const store = useStore()
  const settingsStore = useSettingsStore()

  const itemsPerPage = 100
  const currentPage = ref(1)
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 570)

  const bchDisplayUnit = computed(() => {
    return store.network === "mainnet" ? "BCH" : "tBCH";
  });

  const exchangeRate = +(await ExchangeRate.get(settingsStore.currency, true)).toFixed(2)

  const tokenPricesForTransaction = ref({} as Record<string, number>);

  const tokenPrices = ref({} as Record<string, number>);
  const tokenChangeCurrencyValues = ref({} as Record<string, number>);

  const processHistoryCurrency = async (history: TransactionHistoryItem[] | undefined, unit: string): Promise<TransactionHistoryItem[] | undefined> => {
    if (!history) {
      return history;
    }

    const prices: Record<string, Promise<number> | number> = {};
    for (const item of history) {
      for (const inOutput of [...item.inputs, ...item.outputs]) {
        if (inOutput.token?.amount) {
          const key = `${inOutput.token.tokenId}-${(item.timestamp ?? 0)}`;
          if (prices[key] !== undefined) {
            continue;
          }

          if (item.timestamp === undefined) {
            prices[key] = fetchCurrentTokenPrice(inOutput.token.tokenId)
          } else {
            prices[key] = fetchHistoricTokenPrice(inOutput.token.tokenId, item.timestamp)
          }
        }
      }
    }

    await Promise.all(Object.entries(prices).map(async ([key, promise]) => {
      prices[key] = await promise;
    }));

    tokenPrices.value = prices as Record<string, number>;

    if (unit.includes("sat")) {
      return history;
    }

    const changeCurrencyValues: Record<string, number> = {};
    for (const transaction of history) {
      for (const tokenChange of transaction.tokenAmountChanges) {
        if (tokenChange.amount) {
          const priceInSat = tokenPrices.value[`${tokenChange.tokenId}-${transaction.timestamp ?? 0}`] ?? 0;
          changeCurrencyValues[`${tokenChange.tokenId}-${transaction.timestamp ?? 0}-${tokenChange.amount}`] = await convert(priceInSat * Number(tokenChange.amount), "sat", settingsStore.currency);
        }
      }
    }
    tokenChangeCurrencyValues.value = changeCurrencyValues;
  };

  const loadedTokenIds = store.tokenList?.map(token => token.tokenId) ?? [];
  const tokenIds = (store.walletHistory?.map(transaction => transaction.tokenAmountChanges.map(tokenChange => tokenChange.tokenId)) ?? [])
    .flat()
    .filter((value, index, array) => array.indexOf(value) === index)
    .filter(tokenId => !loadedTokenIds.includes(tokenId));

  store.importRegistries(tokenIds.map(tokenId => ({tokenId} as TokenDataFT)), false);

  const selectTransaction = (transaction: TransactionHistoryItem) => {
    selectedTransaction.value = transaction;
    const tokenIds = [...transaction.inputs, ...transaction.outputs].map(inOutput => inOutput.token?.amount ? inOutput.token?.tokenId : undefined).filter((value, index, array) => value && array.indexOf(value) === index);
    tokenPricesForTransaction.value = Object.fromEntries(Object.entries(tokenPrices.value).filter(([key, ]) => tokenIds.includes(key.split('-')[0]) && key.includes(`-${transaction.timestamp ?? 0}`)));
  }

  const selectedTransaction = ref(undefined as TransactionHistoryItem | undefined);
  const selectedFilter = ref("allTransactions" as "allTransactions" | "bchTransactions" | "tokenTransactions");

  const selectedHistory = asyncComputed(async () => {
    const filteredHistory = (() => {
      if (selectedFilter.value === "bchTransactions") return store.walletHistory?.filter(tx => !tx.tokenAmountChanges.length) ?? [];
      if (selectedFilter.value === "tokenTransactions") return store.walletHistory?.filter(tx => tx.tokenAmountChanges.length) ?? [];
      return store.walletHistory ?? [];
    })();

    await processHistoryCurrency(filteredHistory, settingsStore.currency);
    return filteredHistory;
  }, []);

  const transactionCount = computed(() => selectedHistory.value?.length);

  const paginatedHistory = computed(() => {
    const start = (currentPage.value - 1) * itemsPerPage
    return selectedHistory.value?.slice(start, start + itemsPerPage)
  })
  const totalPages = computed(() => Math.ceil((selectedHistory.value?.length ?? 0) / itemsPerPage))
</script>

<template>
  <div>
    <div v-if="store.walletHistory == undefined" style="text-align: center;">Loading transaction history ...</div>
    <div v-if="store.walletHistory?.length == 0" style="text-align: center;">No transactions in this wallet</div>

    <fieldset class="item" v-if="store.walletHistory?.length">
      <legend>Transaction History</legend>

      <div style="margin-top:5px; margin: auto; display: flex; align-items: baseline; gap: 20px;">
        <div style="margin-top:5px; width: 150px;  display: flex;">
          <label for="filterTransactions" style=" margin-right: 10px;">Show:</label>
          <select v-model="selectedFilter" name="filterTransactions" style="padding: 0px 4px">
            <option value="allTransactions">All</option>
            <option value="bchTransactions">BCH txs</option>
            <option value="tokenTransactions">Token txs</option>
          </select>
        </div>

        <div v-if="!isMobile">{{ transactionCount }} Transactions </div>
      </div>

      <table>
        <thead>
          <tr style="padding-left: 10px;">
            <th scope="col"></th>
            <th scope="col">Date</th>
            <th scope="col" class="valueHeader">BCH</th>
            <!--<th scope="col" class="valueHeader">Balance</th>-->
            <th scope="col" style="text-align: right; padding-right: 40px;">Token</th>
          </tr>
        </thead>
        <tbody class="transactionTable">
          <tr
            v-for="transaction in paginatedHistory"
            :key="transaction.hash"
            @click="() => selectTransaction(transaction)"
            :class="settingsStore.darkMode ? 'dark' : ''"
          >

            <td><EmojiItem :emoji="transaction.timestamp ? '✅' : '⏳' " style="margin: 0 5px; vertical-align: sub;"/> </td>

            <!-- date -->
            <td v-if="isMobile">
              <div v-if="transaction.timestamp" style="line-height: 1.3">
                <div>{{new Date(transaction.timestamp * 1000).toLocaleDateString().replace("202", "2").replaceAll("/", "-") }}</div>
                <div>{{new Date(transaction.timestamp * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }}</div>
              </div>
              <div v-else>pending</div>
            </td>
            <td v-else>{{ transaction.timestamp ? formatTimestamp(transaction.timestamp).replaceAll("/", "-") : "Unconfirmed" }}</td>

            <!-- BCH -->

            <td class="value" :style="transaction.valueChange < 0 ? 'color: var(--color-red-text)' : ''">
              {{ `${transaction.valueChange > 0 ? '+' : '' }${(transaction.valueChange / 100_000_000).toFixed(5)}`}}
              {{ isMobile? "" : (bchDisplayUnit) }}
              <div v-if="settingsStore.showFiatValueHistory">
                ({{`${transaction.valueChange > 0 ? '+' : '' }` + formatFiatAmount(exchangeRate * transaction.valueChange / 100_000_000, settingsStore.currency)}})
              </div>
            </td>
              
            <!-- balance -->
            <!--<td class="value">
              {{ (transaction.balance / 100_000_000).toFixed(5) }}
              {{ isMobile? "" : (bchDisplayUnit) }}
              <div v-if="settingsStore.showFiatValueHistory">
                ~{{formatFiatAmount(exchangeRate * transaction.balance / 100_000_000, settingsStore.currency) }}
              </div>
            </td>-->

            <td class="tokenChange">
              <div class="tokenChangeItem" v-for="tokenChange in transaction.tokenAmountChanges" :key="tokenChange.tokenId">
                <span v-if="tokenChange.amount !== 0n || tokenChange.nftAmount == 0n">
                  <span v-if="tokenChange.amount > 0n" class="value">+{{ (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}</span>
                  <span v-else class="value" style="color: var(--color-red-text)">{{ (Number(tokenChange.amount) / 10**(store.bcmrRegistries?.[tokenChange.tokenId]?.token.decimals ?? 0)).toLocaleString("en-US") }}</span>
                  <span class="hideOnOverflow"> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }}</span>
                  <div class="value" v-if="settingsStore.showFiatValueHistory" :style="tokenChange.amount < 0n ? 'var(--color-red-text)' : ''">
                    {{ tokenChange.amount < 0n ? '' : '+' }}{{ tokenChangeCurrencyValues[`${tokenChange.tokenId}-${transaction.timestamp ?? 0}-${tokenChange.amount}`] === 0 ? `${CurrencySymbols[settingsStore.currency]}0.00` : `${CurrencySymbols[settingsStore.currency]}${tokenChangeCurrencyValues[`${tokenChange.tokenId}-${transaction.timestamp ?? 0}-${tokenChange.amount}`]}` }}
                  </div>
                </span>
                <span v-if="tokenChange.nftAmount !== 0n">
                  <span v-if="tokenChange.nftAmount > 0n" class="value">+{{ tokenChange.nftAmount }}</span>
                  <span v-else class="value" style="color: rgb(188,30,30)">{{ tokenChange.nftAmount }}</span>
                  <span> {{ " " + (store.bcmrRegistries?.[tokenChange.tokenId]?.token?.symbol ?? tokenChange.tokenId.slice(0, 8)) }} NFT</span>
                </span>

                <img
                  v-if="store.bcmrRegistries?.[tokenChange.tokenId]"
                  class="tokenIcon"
                  style="width: 28px; height: 28px; border-radius: 50%;"
                  :src="store.tokenIconUrl(tokenChange.tokenId) ?? ''"
                  >
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <q-pagination
        v-if="totalPages > 1"
        v-model="currentPage"
        :max="totalPages"
        input
        direction-links
        boundary-numbers
        color="primary"
      />
    </fieldset>
  </div>

  <TransactionDialog v-if="selectedTransaction" :history-item="selectedTransaction" :tokenPrices="tokenPricesForTransaction" @hide="() => {selectedTransaction = undefined}"></TransactionDialog>
</template>

<style scoped>
tr:nth-child(even) {
  background-color: var(--color-background-soft);
}
tr.dark:nth-child(even) {
  background-color: #232326;
}

.transactionTable > * {
  font-size: smaller;
}

.value {
  font-family: monospace;
}

.tokenChange {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  text-align: end;
  width: auto;
  margin-left: -30px;
}
.tokenChangeItem {
  max-width: 160px;
  display: flex;
  align-items: center;
}

img.tokenIcon {
  margin-left: 5px;
}

.break {
  word-break: keep-all;
  text-align: end;
}

@media only screen and (max-width: 570px) {
  fieldset {
    padding: .5rem 1rem;
  }
  .tokenIcon {
    margin-right: 0px;
  }
  .tokenChange{
    margin-left: -10px;
  }
  .tokenChangeItem {
    max-width: 120px;
    text-align: center;
    width: 100%;
    flex-direction: column;
    justify-content: center;
  }
  .transactionTable > * {
    font-size: small;
  }
}

@media only screen and (max-width: 450px) {
  .tokenChangeItem {
    max-width: 100px;
  }
  .tokenChange {
    margin-left: 0px;
  }
  .hideOnOverflow {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
  }
}
</style>

<style>
.q-pagination .q-btn {
  background-color: transparent !important;
}
.q-pagination .q-field {
  width: 5em !important;
  margin: 10px 0px;
}
.q-pagination .q-field__inner {
  width: 100%;
}
.q-pagination .q-field__control-container {
  width: 100%;
}
.q-pagination .q-field__native {
  color: var(--font-color);
}
</style>