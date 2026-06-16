import { boot } from 'quasar/wrappers';

// Request persistent storage on every app launch (browser/PWA only).
// Replaces the manual "request persistent storage" button in the backup wallet section.
export default boot(async () => {
  try {
    const isBrowser = process.env.MODE === 'spa';
    const supported = typeof navigator !== 'undefined' && !!navigator.storage?.persist;
    if (!isBrowser || !supported) return;

    const persisted = await navigator.storage.persisted();
    if (!persisted) {
      await navigator.storage.persist();
    }
  } catch (error) {
    console.error('Persistent storage request failed:', error);
  }
});
