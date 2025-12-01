<script setup lang="ts">
  import { ref } from 'vue';
  import { useStore } from '../stores/store';
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { onUnmounted } from 'vue';

  const store = useStore()
  const settingsStore = useSettingsStore()

  const offline = ref<boolean>(window.navigator.onLine === false);
  const electrumFailure = ref<boolean>(false);

  window.addEventListener('offline', () => {
    console.log('App is offline');
    offline.value = true;
  });

  window.addEventListener('online', () => {
    console.log('App is online');
    offline.value = false;
  });

  let intervalId: number | undefined = undefined;

  const electrumCheck = () => Promise.race([
    store.wallet?.provider.electrum.request('server.ping'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 1000))
  ]).then(() => electrumFailure.value = false).catch(() => electrumFailure.value = true);

  intervalId = window.setInterval(electrumCheck, 3000);

  // Clear interval on unmount
  onUnmounted(() => {
    if (intervalId !== undefined) {
      clearInterval(intervalId);
    }
  });

</script>
<template>
  <div v-if="offline" class="offline">Network offline</div>
  <div v-else-if="electrumFailure" @click="() => { settingsStore.menuIndex = 5; store.changeView(5); }" class="offline" style="cursor: pointer;">Network providers do not respond. Go to <span style="text-decoration: underline; text-decoration-style: dashed;">settings.</span></div>
</template>

<style scoped>
.offline {
  z-index: 100;
  text-align: center;
  width: 100%;
  position: sticky;
  top: 0;
  background-color: indianred;
}
</style>