<script setup lang="ts">
  import { ref, onMounted, toRefs, computed, watch } from 'vue';
  import { TokenSendRequest, SendRequest, convert  } from "mainnet-js"
  import { decodeCashAddress } from "@bitauth/libauth"
  // @ts-ignore
  import { createIcon } from '@download/blockies';
  import alertDialog from 'src/components/alertDialog.vue'
  import swapDialog from './swapDialog.vue';
  import { CurrencySymbols, type TokenDataFT, type bcmrTokenMetadata } from "src/interfaces/interfaces"
  import { queryTotalSupplyFT, queryReservedSupply } from "src/queryChainGraph"
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import { useQuasar } from 'quasar'
  import QrCodeScanDialog from '../qr/qrCodeScanDialog.vue';

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    tokenData: TokenDataFT,
  }>()
  const { tokenData } = toRefs(props);

  const displaySendTokens = ref(false);
  const displayBurnFungibles = ref(false);
  const displayAuthTransfer = ref(false);
  const displayTokenInfo = ref(false);
  const tokenSendAmount = ref("");
  const destinationAddr = ref("");
  const burnAmountFTs = ref("");
  const reservedSupplyInput = ref("")
  const tokenMetaData = ref(undefined as (bcmrTokenMetadata | undefined));
  const totalSupplyFT = ref(undefined as bigint | undefined);
  const reservedSupply = ref(undefined as bigint | undefined);
  const showSwapDialog = ref(false);
  const showQrCodeDialog = ref(false);

  tokenMetaData.value = store.bcmrRegistries?.[tokenData.value.tokenId];

  const numberFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 8});

  const MAX_SUPPLY_FTS = 9_223_372_036_854_775_807n

  const httpsUrlTokenIcon = computed(() => {
    let tokenIconUri = tokenMetaData.value?.uris?.icon;
    if(tokenIconUri?.startsWith('ipfs://')){
      return settingsStore.ipfsGateway + tokenIconUri.slice(7);
    }
    return tokenIconUri;
  })
  const tokenName = computed(() => {
    return tokenMetaData.value?.name;
  })

  const tokenPrice = ref(0);
  const updateTokenPrice = async () => {
    const priceInSat = await store.fetchCurrentTokenPrice(tokenData.value.tokenId);
    tokenPrice.value = await convert(Number(tokenData.value.amount) * priceInSat, "sat", settingsStore.currency);
  };
  setTimeout(updateTokenPrice, 1);
  watch(tokenData, updateTokenPrice);

  onMounted(() => {
    const icon = createIcon({
      seed: tokenData.value.tokenId,
      size: 12,
      scale: 4,
      spotcolor: '#000'
    });
    icon.style = "display: block; border-radius: 50%;"
    const template = document.querySelector(`#id${tokenData.value.tokenId.slice(0, 10)}`);
    const iconDiv = template?.querySelector("#genericTokenIcon")
    iconDiv?.appendChild(icon);
  })

  function copyToClipboard(copyText:string){
    navigator.clipboard.writeText(copyText);
    $q.notify({
      message: "Copied!",
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }

  // check if need to fetch onchain stats on displayTokenInfo
  watch(displayTokenInfo, async() => {
    if(!totalSupplyFT.value && tokenData.value?.amount){
      totalSupplyFT.value = await queryTotalSupplyFT(tokenData.value.tokenId, settingsStore.chaingraph);
      reservedSupply.value = await queryReservedSupply(tokenData.value.tokenId, settingsStore.chaingraph)
    }
  })

  // Fungible token specific functionality
  function toAmountDecimals(amount:bigint){
    let tokenAmountDecimals: bigint|number = amount;
    const decimals = tokenMetaData.value?.token?.decimals;
    if(decimals) tokenAmountDecimals = Number(tokenAmountDecimals) / (10 ** decimals);
    return tokenAmountDecimals;
  }
  async function maxTokenAmount(tokenSend:boolean){
    try{
      if(!tokenData.value?.amount) return // should never happen
      const decimals = tokenMetaData.value?.token?.decimals;
      let amountTokens = decimals ? Number(tokenData.value.amount) / (10 ** decimals) : tokenData.value.amount;
      const targetState = tokenSend? tokenSendAmount : burnAmountFTs;
      targetState.value = amountTokens.toString();
    } catch(error) {
      console.log(error)
    }
  }
  async function sendTokens(){
    try{
      if(!store.wallet) return;
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      if(!destinationAddr.value) throw("No destination address provided")
      if(!tokenSendAmount?.value) throw(`No valid amount provided`);
      const decimals = tokenMetaData.value?.token?.decimals;
      const amountTokens = decimals ? +tokenSendAmount.value * (10 ** decimals) : +tokenSendAmount.value;
      const validInput =  Number.isInteger(amountTokens);
      if(!validInput && !decimals) throw(`Amount tokens to send must be a valid integer`);
      if(!validInput ) throw(`Amount tokens to send must only have ${decimals} decimal places`);
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        throw(`Address prefix ${networkPrefix} is required`)
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw("Invalid BCH address provided")
      const supportsTokens = (decodedAddress.type === 'p2pkhWithTokens' || decodedAddress.type === 'p2shWithTokens');
      if(!supportsTokens ) throw(`Not a Token Address (should start with z...)`);
      if(tokenData.value?.authUtxo){
        let authWarning = "You risk unintentionally sending the authority to update this token's metadata elsewhere. \nAre you sure you want to send the transaction anyways?";
        if(confirm(authWarning) != true) return;
      }
      const tokenId = tokenData.value.tokenId;
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([
        new TokenSendRequest({
          cashaddr: destinationAddr.value,
          amount: amountTokens,
          tokenId: tokenId,
        }),
      ]);
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const amountSentFormatted = numberFormatter.format(toAmountDecimals(BigInt(amountTokens)))
      const alertMessage = tokenMetaData.value?.token?.symbol ?
        `Sent ${amountSentFormatted} ${tokenMetaData.value.token.symbol} to ${destinationAddr.value}`
        : `Sent ${amountSentFormatted} fungible tokens of category ${displayId} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string }
        }
      })
       $q.notify({
        type: 'positive',
        message: 'Transaction succesfully sent!'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      tokenSendAmount.value = "";
      destinationAddr.value = "";
      displaySendTokens.value = false;
      await store.updateTokenList();
    }catch(error){
      handleTransactionError(error)
    }
  }
  async function burnFungibles(){
    try {
      if(!store.wallet) return;
      if(!burnAmountFTs?.value) throw(`Amount tokens to burn must be a valid integer`);
      const decimals = tokenMetaData.value?.token?.decimals;
      const amountTokens = decimals ? +burnAmountFTs.value * (10 ** decimals) : +burnAmountFTs.value;
      const validInput =  Number.isInteger(amountTokens);
      if(!validInput && !decimals) throw(`Amount tokens to burn must be a valid integer`);
      if(!validInput ) throw(`Amount tokens to burn must only have ${decimals} decimal places`);
      if((store?.balance?.sat ?? 0) < 550) throw(`Need some BCH to cover transaction fee`);
      const tokenId = tokenData.value.tokenId;

      let burnWarning = `You are about to burn ${amountTokens} tokens, this can not be undone. \nAre you sure you want to burn the tokens?`;
      if (confirm(burnWarning) != true) return;

      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.tokenBurn({
          tokenId: tokenId,
          amount: BigInt(amountTokens),
        },
        "burn", // optional OP_RETURN message
      );
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const amountBurntFormatted = numberFormatter.format(toAmountDecimals(BigInt(amountTokens)))
      const alertMessage = tokenMetaData.value?.token?.symbol ?
        `Burned ${amountBurntFormatted} ${tokenMetaData.value.token.symbol}`
        : `Burned ${amountBurntFormatted} tokens of category ${displayId}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string }
        }
      })
       $q.notify({
        type: 'positive',
        message: 'Burn successful'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
      burnAmountFTs.value = "";
      displayBurnFungibles.value = false;
      await store.updateTokenList();
    } catch (error) {
      handleTransactionError(error)
    }
  }
  async function transferAuth() {
    if(!store.wallet || !store.wallet.tokenaddr) return;
    if(!tokenData.value?.authUtxo) return;
    if(!reservedSupplyInput?.value) throw(`Amount tokens for reserved supply must be a valid integer`);
    const decimals = tokenMetaData.value?.token?.decimals;
    const reservedSupply = decimals ? +burnAmountFTs.value * (10 ** decimals) : +reservedSupplyInput.value;
    const validInput =  Number.isInteger(reservedSupply);
    if(!validInput && !decimals) throw(`Amount tokens for reserved supply must be a valid integer`);
    if(!validInput ) throw(`Amount tokens for reserved supply must only have ${decimals} decimal places`);
    const tokenId = tokenData.value.tokenId;
    try {
      const authTransfer = !reservedSupply? {
        cashaddr: destinationAddr.value,
        value: 1000,
        unit: 'sats',
      } as SendRequest : new TokenSendRequest({
        cashaddr: destinationAddr.value,
        tokenId: tokenId,
        amount: reservedSupply
      });
      const outputs = [authTransfer];
      const changeAmount = reservedSupply? tokenData.value.amount - BigInt(reservedSupply) : tokenData.value.amount;
      if(changeAmount){
        const changeOutput = new TokenSendRequest({
          cashaddr: store.wallet.tokenaddr,
          tokenId: tokenId,
          amount: changeAmount
        });
        outputs.push(changeOutput)
      }
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send(outputs, { ensureUtxos: [tokenData.value.authUtxo] });
      const displayId = `${tokenId.slice(0, 20)}...${tokenId.slice(-10)}`;
      const alertMessage = `Transferred the Auth of utxo ${displayId} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string }
        }
      })
       $q.notify({
        type: 'positive',
        message: 'Auth transfer successful'
      })
      console.log(alertMessage);
      console.log(`${store.explorerUrl}/${txId}`);
    } catch (error) { 
      handleTransactionError(error);
    }
  }

  function handleTransactionError(error: any){
    console.log(error)
    const errorMessage = typeof error == 'string' ? error : "something went wrong";
    $q.notify({
      message: errorMessage,
      icon: 'warning',
      color: "red"
    })
  }

  const qrDecode = (content: string) => {
    destinationAddr.value = content;
  }
  const qrFilter = (content: string) => {
    const decoded = decodeCashAddress(content);
    if (typeof decoded === "string" || decoded.prefix !== store.wallet?.networkPrefix || !['p2pkhWithTokens', 'p2shWithTokens'].includes(decoded.type)) {
      return "Not a tokenaddress on current network";
    }

    return true;
  }
</script>

<template id="token-template">
  <div :id="`id${tokenData.tokenId.slice(0, 10)}`" class="item">
    <fieldset style="position: relative;">
      <legend>
        <div id="tokenType"></div>
      </legend>
      <div class="tokenInfo">
        <img v-if="httpsUrlTokenIcon" id="tokenIcon" class="tokenIcon" style="width: 48px; height: 48px; border-radius: 50%;" :src="httpsUrlTokenIcon">
        <div v-else id="genericTokenIcon" class="tokenIcon"></div>
        <div class="tokenBaseInfo">
          <div class="tokenBaseInfo1">
            <div v-if="tokenName" id="tokenName">Name: {{ tokenName }}</div>
            <div id="tokenIdBox" style="word-break: break-all;">
              TokenId: 
              <span>
                <span class="tokenId" @click="copyToClipboard(tokenData.tokenId)" style="cursor: pointer;">
                  {{ !isMobile ? `${tokenData.tokenId.slice(0, 20)}...${tokenData.tokenId.slice(-10)}` :  `${tokenData.tokenId.slice(0, 10)}...${tokenData.tokenId.slice(-10)}`}}
                </span>
                <img class="copyIcon" src="images/copyGrey.svg">
              </span>
            </div>
            <div id="childNftCommitment" style="word-break: break-all;" class="hide"></div>
          </div>
          <div v-if="tokenData?.amount !== undefined" style="display: flex; flex-direction: column;">
            <div class="tokenAmount" id="tokenAmount">Amount: 
              {{ numberFormatter.format(toAmountDecimals(tokenData?.amount)) }} {{ tokenMetaData?.token?.symbol }}
            </div>
            <div v-if="tokenPrice !== 0" class="tokenAmount" id="tokenAmount">Value: 
              {{ tokenPrice }} {{ CurrencySymbols[settingsStore.currency] }}
            </div>
          </div>
        </div>
      </div>

      <div class="tokenActions">
        <div class="actionBar">
          <span v-if="tokenData?.amount" @click="displaySendTokens = !displaySendTokens" style="margin-left: 10px;">
            <img id="sendIcon" class="icon" :src="settingsStore.darkMode? 'images/sendLightGrey.svg' : 'images/send.svg'"> send </span>
          <span @click="displayTokenInfo = !displayTokenInfo" id="infoButton">
            <img id="infoIcon" class="icon" :src="settingsStore.darkMode? 'images/infoLightGrey.svg' : 'images/info.svg'"> info
          </span>
          <span v-if="settingsStore.tokenBurn && tokenData?.amount" @click="displayBurnFungibles = !displayBurnFungibles" style="white-space: nowrap;">
            <img id="burnIcon" class="icon" :src="settingsStore.darkMode? 'images/fireLightGrey.svg' : 'images/fire.svg'">
            <span>burn tokens</span>
          </span>
          <span v-if="tokenData?.authUtxo" @click="displayAuthTransfer = !displayAuthTransfer" style="white-space: nowrap;" id="authButton">
            <img id="authIcon" class="icon" :src="settingsStore.darkMode? 'images/shieldLightGrey.svg' : 'images/shield.svg'">
            <span>auth transfer</span>
          </span>
          <span v-if="tokenPrice" @click="showSwapDialog = true" style="white-space: nowrap;" id="swapButton">
            <img id="swapIcon" class="icon" :src="settingsStore.darkMode? 'images/cauldron-dark.svg' : 'images/cauldron.svg'" style="width: 16px; height: 16px; margin-right: 5px;">
            <span>swap</span>
          </span>
          <span @click="store.toggleFavorite(tokenData.tokenId)" style="float:right">
            {{ settingsStore.featuredTokens.includes(tokenData.tokenId) ? "★" : "☆" }} favorite </span>
        </div>
        <div v-if="displayTokenInfo" style="margin-top: 10px;">
          <div></div>
          <div v-if="tokenMetaData?.description"> Token description: {{ tokenMetaData.description }} </div>
          <div v-if="tokenData.amount && tokenMetaData">
            Number of decimals: {{ tokenMetaData?.token?.decimals ?? 0 }}
          </div>
          <div v-if="tokenMetaData?.uris?.web">
            Token web link: 
            <a :href="tokenMetaData.uris.web" target="_blank">{{ tokenMetaData.uris.web }}</a>
          </div>
          <div>
            Max supply: 
            <span v-if="totalSupplyFT">
              {{ totalSupplyFT!= MAX_SUPPLY_FTS ?
                  numberFormatter.format(toAmountDecimals(totalSupplyFT)) +
                  (tokenMetaData?.token?.symbol ? " " + tokenMetaData?.token?.symbol : " tokens")
                : "open ended"
              }}
            </span><span v-else>...</span>
          </div>
          <div>
            Circulating supply: 
            <span v-if="totalSupplyFT && reservedSupply != undefined">
              {{ numberFormatter.format(toAmountDecimals(totalSupplyFT - reservedSupply)) +
                (tokenMetaData?.token?.symbol ? " " + tokenMetaData?.token?.symbol: " tokens")
              }}
              {{ totalSupplyFT!= MAX_SUPPLY_FTS ?
                `(${((Number((totalSupplyFT - reservedSupply)*1000n/totalSupplyFT))/10).toFixed(1)}%)`
                :"" 
              }}
            </span><span v-else>...</span>
          </div>
        </div>

        <div v-if="displaySendTokens" style="margin-top: 10px;">
          Send these tokens to
          <div class="inputGroup">
            <div class="addressInputFtSend">
              <div style="display: flex;">
                <input v-model="destinationAddr" id="tokenAddress" placeholder="token address">
                <button @click="() => showQrCodeDialog = true" style="padding: 12px">
                  <img src="images/qrscan.svg" />
                </button>
              </div>
            </div>
            <div class="sendTokenAmount">
              <span style="width: 100%; position: relative; ">
                <input v-model="tokenSendAmount" placeholder="amount">
                <i id="sendUnit" class="input-icon" style="width: min-content; padding-right: 15px;">
                  {{ tokenMetaData?.token?.symbol ?? "tokens" }}
                </i>
              </span>
              <button @click="maxTokenAmount(true)" id="maxButton" style="color: black;">max</button>
            </div>
          </div>
          <input @click="sendTokens()" type="button" id="sendSomeButton" class="primaryButton" value="Send">
        </div>
        <div v-if="displayBurnFungibles" style="margin-top: 10px;">
          <div>Burning tokens removes them from the supply forever</div>
          <div style="display: flex">
            <span style="width: 50%; position: relative; display: flex;">
              <input v-model="burnAmountFTs" type="number" placeholder="amount tokens">
              <i id="sendUnit" class="input-icon" style="width: min-content; padding-right: 15px;">
                {{ tokenMetaData?.token?.symbol ?? "tokens" }}
              </i>
            </span>
            <button @click="maxTokenAmount(false)" style="color: black;">max</button>
          </div>
          <input @click="burnFungibles()" type="button" value="burn tokens" class="button error" style="margin-top: 10px;">
        </div>
        <div v-if="displayAuthTransfer" style="margin-top: 10px;">
          Transfer the authority to change the token's metadata <br>
          You can either transfer the Auth to a dedicated wallet or to the <a href="https://cashtokens.studio/" target="_blank">CashTokens Studio</a>.<br>
          Token supply kept at the Auth UTXO will be marked as reserved supply, not yet in circulation. <br>
          <span class="grouped" style="margin-top: 10px;">
            <input v-model="destinationAddr" placeholder="destinationAddr">
            <span style="width: 100%; position: relative; display: flex; margin: 0">
              <input v-model="reservedSupplyInput" placeholder="reservedSupply">
              <i id="sendUnit" class="input-icon" style="width: min-content; padding-right: 15px;">
                {{ tokenMetaData?.token?.symbol ?? "tokens" }}
              </i>
            </span>
          </span>
          <input @click="transferAuth()" type="button" class="primaryButton" value="Transfer Auth"  style="margin-top: 10px;">
        </div>
      </div>
    </fieldset>

    <div v-if="tokenPrice && showSwapDialog">
      <swapDialog :token-balance="tokenData.amount" :token-id="tokenData.tokenId" :token-metadata="tokenMetaData" @close-dialog="() => showSwapDialog = false"/>
    </div>
  </div>
  <div v-if="showQrCodeDialog">
    <QrCodeScanDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>