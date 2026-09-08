import nextEnv from '@next/env';
import { getLeveragedEtfDistribution } from '../lib/leveragedEtfDistributions.mjs';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const tickers = process.argv.slice(2);
const symbols = tickers.length ? tickers : ['SOXS', 'SOXL', 'TQQQ', 'SQQQ', 'SPXS'];

async function yahooSnapshot(ticker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&events=div`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
  const body = await response.json();
  const result = body?.chart?.result?.[0];
  const price = Number(result?.meta?.regularMarketPrice) || 0;
  const dividends = Object.values(result?.events?.dividends ?? {});
  const rawRate = dividends.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0);
  return { price, rawRate, rawYield: price > 0 ? rawRate / price : 0 };
}

const rows = [];
for (const ticker of symbols) {
  try {
    const yahoo = await yahooSnapshot(ticker);
    const verified = await getLeveragedEtfDistribution({ ticker, currentPrice: yahoo.price, force: true });
    rows.push({
      ticker,
      price: yahoo.price.toFixed(2),
      yahooRawYieldPct: (yahoo.rawYield * 100).toFixed(2),
      provider: verified.provider ?? 'none',
      verifiedYieldPct: verified.provider ? (verified.dividendYield * 100).toFixed(2) : 'rejected',
      trailingDistribution: verified.provider ? verified.trailingAnnualDividendRate.toFixed(6) : '-',
      eventCount: verified.eventCount ?? 0,
      quality: verified.quality,
      attempts: verified.attempts.map(item => `${item.provider}:${item.error}`).join(' | '),
    });
  } catch (error) {
    rows.push({ ticker, provider: 'error', quality: String(error?.message || error) });
  }
}

console.table(rows);
