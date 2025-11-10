<script setup lang="ts">
  import { type ElectrumClientEvents } from '@electrum-cash/network';
  import { type ElectrumFallbackClient } from '@mainnet-pat/electrum-fallback-client';
  import { ref } from 'vue';
  import { useSettingsStore } from '../stores/settingsStore';
  import { useStore } from '../stores/store';

  const store = useStore()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    network: "mainnet" | "chipnet",
    servers: Array<[string, boolean]>,
  }>()

  const scores = ref<[number, number, string][]>([]);

  function getScores() {
    scores.value = (store.wallet.provider.electrum as unknown as ElectrumFallbackClient<ElectrumClientEvents>).scores;
  }
  getScores();

  function changeElectrumServer(targetNetwork: "mainnet" | "chipnet"){
    if(!store._wallet) throw new Error('No wallet set in global store');
    store.changeView(1)
    store.resetWalletState()
    if(targetNetwork == "mainnet"){
      localStorage.setItem("electrum-mainnet", JSON.stringify(settingsStore.electrumServerMainnet));
    }
    if(targetNetwork == "chipnet"){
      localStorage.setItem("electrum-chipnet", JSON.stringify(settingsStore.electrumServerChipnet));
    }
    store.initializeWallet()
  }

</script>
<template>
  <div>
    <label for="selectNetwork">Change Electrum server {{ network }}:</label>
    <table class="electrum-servers-table">
      <thead>
        <tr>
          <th>Server Name</th>
          <th>Score</th>
          <th>Enabled</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="server in props.servers" :key="server[0]">
          <td>{{ server[0].replace('wss://','').replace(':50004','') }}</td>
          <td>{{ scores.find((score) => server[0].includes(score[2].replace(':443','')))?.[0]?.toFixed(3) }}</td>
          <td>
            <input
              type="checkbox"
              :checked="server[1]"
              :disabled="props.servers.filter(s => s[1]).length === 1 && server[1]"
              @change="if (!(props.servers.filter(s => s[1]).length === 1 && server[1])) server[1] = !server[1];"
            />
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="text-align: center;">
            <button class="button primary" @click="getScores()">
              Refresh
            </button>
            <button class="button primary" @click="() => changeElectrumServer(props.network)">
              Save
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
table.electrum-servers-table {
  width: 90%;
  margin-left: 5%;
}

table.electrum-servers-table td {
  padding: 4px 8px;
}
</style>