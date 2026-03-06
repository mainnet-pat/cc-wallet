import { cachedFetch } from "./cacheUtils";

export async function fetchCurrentTokenPrice(tokenId: string): Promise<number> {
  // cache for 5 minutes
  const priceResponse = await cachedFetch(`https://indexer.cauldron.quest/cauldron/price/${tokenId}/current`, 300000);

  const price = (await priceResponse.json()).price;
  return price;
};

export async function fetchHistoricTokenPrice(tokenId: string, timestamp: number): Promise<number> {
  // lookup historic prices with from day before to date in 10 minute steps and grab latest avg price reported
  const priceHisotryResponse = await cachedFetch(`https://indexer.cauldron.quest/cauldron/price/${tokenId}/history/?start=${timestamp - 86400}&end=${timestamp + 1}&stepsize=600`);

  const history = (await priceHisotryResponse.json()).history as {avg: number, timestamp: number}[];
  return history.at(-1)?.avg ?? 0;
};