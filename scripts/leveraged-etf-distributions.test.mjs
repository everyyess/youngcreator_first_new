import test from 'node:test';
import assert from 'node:assert/strict';
import { __test, isLeveragedEtf, isPlausibleDistribution } from '../lib/leveragedEtfDistributions.mjs';

test('SOXS reverse splits are applied to historical distributions', () => {
  const events = [
    ['2025-09-24', 0.05628],
    ['2025-12-23', 0.04087],
    ['2026-03-24', 0.28685],
    ['2026-06-24', 0.0375],
  ];
  const splits = [
    { date: '2026-03-02', oldRate: 20, newRate: 1 },
    { date: '2026-07-01', oldRate: 10, newRate: 1 },
  ];
  const adjusted = events.map(([date, amount]) => ({
    date,
    amount: __test.splitAdjustedAmount(amount, date, splits),
  }));
  const result = __test.summarize('SOXS', 'test', adjusted, 46.34, new Date('2026-09-08T00:00:00Z'));
  assert.equal(Number(result.trailingAnnualDividendRate.toFixed(4)), 22.6735);
  assert.equal(Number((result.dividendYield * 100).toFixed(2)), 48.93);
});

test('corrupted Yahoo-style yield is rejected', () => {
  assert.equal(isPlausibleDistribution(334.43 / 46.34, 334.43, 46.34), false);
});

test('leveraged ETFs are detected by ticker and fund name', () => {
  assert.equal(isLeveragedEtf('TQQQ'), true);
  assert.equal(isLeveragedEtf('TEST', { longName: 'Example 3X Bull ETF' }), true);
  assert.equal(isLeveragedEtf('SPY', { longName: 'SPDR S&P 500 ETF Trust' }), false);
  assert.equal(isLeveragedEtf('BOND', { longName: 'Short Duration Bond ETF' }), false);
});
