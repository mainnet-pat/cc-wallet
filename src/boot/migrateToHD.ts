import { boot } from 'quasar/wrappers';

const STORE_NAME = "wallet";

async function migrateDatabase(dbName: "bitcoincash" | "bchtest"): Promise<string[]> {
  const migrated: string[] = [];

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = () => reject(new Error(`Failed to open database: ${dbName}`));

    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close();
        resolve(migrated);
        return;
      }

      const dbTx = db.transaction(STORE_NAME, "readwrite");
      const objectStore = dbTx.objectStore(STORE_NAME);
      const cursorRequest = objectStore.openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;

        const entry = cursor.value as { name?: string; wallet?: string };
        const walletId = entry.wallet ?? '';

        if (walletId.startsWith('seed:')) {
          // seed:mainnet:_words_:m/44'/145'/0'/0/0
          // -> hd:mainnet:_words_:m/44'/145'/0':0:0
          entry.wallet = walletId
            .replace('seed:', 'hd:')
            .replace('/0/0', ':0:0');
          cursor.update(entry);
          if (entry.name) migrated.push(entry.name);
        }

        cursor.continue();
      };

      dbTx.oncomplete = () => {
        db.close();
        resolve(migrated);
      };

      dbTx.onerror = () => {
        db.close();
        reject(new Error(`Migration transaction failed for ${dbName}`));
      };
    };
  });
}

export default boot(async () => {
  try {
    const [mainnetMigrated, chipnetMigrated] = await Promise.all([
      migrateDatabase("bitcoincash"),
      migrateDatabase("bchtest")
    ]);

    // Update wallet type metadata in localStorage
    const migratedNames = new Set([...mainnetMigrated, ...chipnetMigrated]);
    if (migratedNames.size > 0) {
      const raw = localStorage.getItem("walletMetadata");
      const metadata: Record<string, { walletType?: string; createdAt?: string }> = raw ? JSON.parse(raw) : {};

      for (const name of migratedNames) {
        if (!metadata[name]) metadata[name] = {};
        metadata[name].walletType = 'hd';
      }

      localStorage.setItem("walletMetadata", JSON.stringify(metadata));
      console.log(`Migrated ${migratedNames.size} wallet(s) to HD:`, [...migratedNames]);
    }
  } catch (error) {
    console.error("HD wallet migration failed:", error);
  }
});
