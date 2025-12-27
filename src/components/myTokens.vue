
<script setup lang="ts">
  import tokenItemNFT from './tokenItems/tokenItemNFT.vue'
  import tokenItemFT from './tokenItems/tokenItemFT.vue'
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { ref } from 'vue'

  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  const showAllTokens = ref(false);
  function copyToClipboard(copyText: string|undefined){
    if(!copyText) return
    navigator.clipboard.writeText(copyText);
    $q.notify({
      message: "Copied!",
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }
</script>

<template>
  <div style="word-break: break-all; text-align: center;">
    Token receiving address:
  </div>
  <qr-code
    @click="() => copyToClipboard(store.wallet?.tokenaddr)" 
    id="qrCode" 
    :contents="store.wallet?.tokenaddr" 
    style="cursor:pointer; display: block; width: 230px; height: 230px; margin: 5px auto 5px auto; background-color: #fff;"
  >
    <img src="images/olando-small.png" slot="icon" /> <!-- eslint-disable-line -->
  </qr-code>
  <div style="word-break: break-all; text-align: center; font-size: 8pt">
    <span @click="() => copyToClipboard(store.wallet?.tokenaddr)" style="cursor:pointer;">
      <span class="depositAddr">{{ store.wallet?.tokenaddr ?? "" }}</span>
      <img class="copyIcon" src="images/copyGrey.svg">
    </span>
  </div>

  <div v-if="store.nrBcmrRegistries == undefined" style="text-align: center;">Loading tokendata ...</div>
  <div v-if="store.tokenList?.length == 0" style="text-align: center;"> No tokens in this wallet </div>
  <div v-if="store.nrBcmrRegistries != undefined">
    <div v-for="tokenData in store.tokenList?.filter(token => settingsStore.featuredTokens.includes(token.tokenId))" :key="tokenData.tokenId.slice(0,6)">
      <tokenItemFT v-if="'amount' in tokenData" :tokenData="tokenData"/>
      <tokenItemNFT v-else :tokenData="tokenData"/>
    </div>
    <div v-if="store.tokenList?.filter(token => !settingsStore.featuredTokens.includes(token.tokenId)).length" style="margin: 10px; margin-top: 20px;">
      <span @click="showAllTokens = !showAllTokens" style="cursor: pointer;">{{showAllTokens ? "▲ Hide" : "▼ Show"}} other tokens</span>
      <div v-if="showAllTokens">
        <div v-for="tokenData in store.tokenList?.filter(token => !settingsStore.featuredTokens.includes(token.tokenId))" :key="tokenData.tokenId.slice(0,6)">
          <tokenItemFT v-if="'amount' in tokenData" :tokenData="tokenData"/>
          <tokenItemNFT v-else :tokenData="tokenData"/>
        </div>
      </div>
    </div>
  </div>
</template>