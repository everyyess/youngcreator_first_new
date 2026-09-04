import type {
  PortfolioAsset,
  RebalancingHistoryItem,
  RebalancingHistoryRecord,
  RebalancingPortfolioSnapshot,
} from "./CustomerContext";
import { readActiveConsultation } from "../consultationStore";

function finite(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function assetKey(asset: Pick<PortfolioAsset, "name" | "ticker">) {
  return `${asset.name ?? ""}::${asset.ticker ?? ""}`;
}

function isOverseas(asset: PortfolioAsset) {
  return (
    asset.productType?.includes("해외") ||
    asset.asset_class?.includes("해외") ||
    (asset.country && asset.country !== "한국" && asset.country !== "대한민국")
  );
}

function unitPriceKrw(asset: PortfolioAsset, usdKrwRate: number) {
  const nativePrice = finite(asset.current_price) || finite(asset.buy_price);
  if (!nativePrice) return null;
  return Math.round(nativePrice * (isOverseas(asset) ? usdKrwRate : 1));
}

function toSnapshot(
  asset: PortfolioAsset,
  usdKrwRate: number,
): RebalancingPortfolioSnapshot {
  const amount = finite(asset.amount);

  return {
    id: assetKey(asset),
    source: "holding",
    category: asset.productType || asset.asset_class || "-",
    name: asset.name || asset.ticker || "-",
    ticker: asset.ticker || "",
    quantity: asset.amount_type === "quantity" ? amount : null,
    amountKrw: asset.amount_type === "value" ? amount : null,
    unitPriceKrw: unitPriceKrw(asset, usdKrwRate),
  };
}

function consultationMeta(customerId: string) {
  const now = new Date().toISOString();
  const active = readActiveConsultation();

  if (active && active.customerId === customerId) {
    return {
      consultationId: active.sessionId,
      consultationAt: active.startedAt,
      confirmedAt: now,
    };
  }

  return {
    consultationId: `manual:${customerId}:${now.slice(0, 10)}`,
    consultationAt: now,
    confirmedAt: now,
  };
}

export function createStockRebalancingRecord(args: {
  customerId: string;
  beforeAssets: PortfolioAsset[];
  afterAssets: PortfolioAsset[];
  usdKrwRate: number;
}): RebalancingHistoryRecord {
  const { customerId, beforeAssets, afterAssets, usdKrwRate } = args;

  const beforeMap = new Map(beforeAssets.map((asset) => [assetKey(asset), asset]));
  const afterMap = new Map(afterAssets.map((asset) => [assetKey(asset), asset]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const items: RebalancingHistoryItem[] = [];

  for (const key of keys) {
    const before = beforeMap.get(key);
    const after = afterMap.get(key);

    if (!before && after) {
      items.push({
        id: `stock:${key}`,
        source: "stock",
        category: after.productType || after.asset_class || "-",
        name: after.name || after.ticker || "-",
        ticker: after.ticker || "",
        action: "매수",
        quantity: after.amount_type === "quantity" ? finite(after.amount) : null,
        amountKrw: after.amount_type === "value" ? finite(after.amount) : null,
        unitPriceKrw: unitPriceKrw(after, usdKrwRate),
        reason: "",
      });
      continue;
    }

    if (before && !after) {
      items.push({
        id: `stock:${key}`,
        source: "stock",
        category: before.productType || before.asset_class || "-",
        name: before.name || before.ticker || "-",
        ticker: before.ticker || "",
        action: "매도",
        quantity: before.amount_type === "quantity" ? finite(before.amount) : null,
        amountKrw: before.amount_type === "value" ? finite(before.amount) : null,
        unitPriceKrw: unitPriceKrw(before, usdKrwRate),
        reason: "",
      });
      continue;
    }

    if (!before || !after) continue;

    const beforeAmount = finite(before.amount);
    const afterAmount = finite(after.amount);
    const diff = afterAmount - beforeAmount;

    if (Math.abs(diff) < 0.000001) continue;

    const reference = diff > 0 ? after : before;

    items.push({
      id: `stock:${key}`,
      source: "stock",
      category: reference.productType || reference.asset_class || "-",
      name: reference.name || reference.ticker || "-",
      ticker: reference.ticker || "",
      action: diff > 0 ? "매수" : "매도",
      quantity:
        reference.amount_type === "quantity" ? Math.abs(diff) : null,
      amountKrw:
        reference.amount_type === "value" ? Math.abs(diff) : null,
      unitPriceKrw: unitPriceKrw(reference, usdKrwRate),
      reason: "",
    });
  }

  return {
    id: consultationMeta(customerId).consultationId,
    customerId,
    ...consultationMeta(customerId),
    items,
    beforePortfolio: beforeAssets.map((asset) =>
      toSnapshot(asset, usdKrwRate),
    ),
    afterPortfolio: afterAssets.map((asset) =>
      toSnapshot(asset, usdKrwRate),
    ),
  };
}

export function createProductRebalancingRecord(args: {
  customerId: string;
  baseAssets: PortfolioAsset[];
  products: Array<{
    id: string;
    category: string;
    name: string;
    ticker?: string;
    amountKrw: number;
  }>;
}): RebalancingHistoryRecord {
  const { customerId, baseAssets, products } = args;
  const meta = consultationMeta(customerId);

  const baseSnapshots = baseAssets.map((asset) => toSnapshot(asset, 1));

  const productSnapshots: RebalancingPortfolioSnapshot[] = products.map(
    (product) => ({
      id: `product:${product.id}`,
      source: "product",
      category: product.category,
      name: product.name,
      ticker: product.ticker || "",
      quantity: null,
      amountKrw: product.amountKrw,
      unitPriceKrw: null,
    }),
  );

  return {
    id: meta.consultationId,
    customerId,
    ...meta,
    items: products.map((product) => ({
      id: `product:${product.id}`,
      source: "product" as const,
      category: product.category,
      name: product.name,
      ticker: product.ticker || "",
      action: "가입" as const,
      quantity: null,
      amountKrw: product.amountKrw,
      unitPriceKrw: null,
      reason: "",
    })),
    beforePortfolio: baseSnapshots,
    afterPortfolio: [...baseSnapshots, ...productSnapshots],
  };
}

export function upsertRebalancingHistory(
  current: RebalancingHistoryRecord[],
  incoming: RebalancingHistoryRecord,
): RebalancingHistoryRecord[] {
  const index = current.findIndex(
    (record) => record.consultationId === incoming.consultationId,
  );

  if (index < 0) {
    return [incoming, ...current].sort((a, b) =>
      b.confirmedAt.localeCompare(a.confirmedAt),
    );
  }

  const existing = current[index];
  const incomingSource = incoming.items[0]?.source;

  const preservedItems = incomingSource
    ? existing.items.filter((item) => item.source !== incomingSource)
    : existing.items;

  let afterPortfolio = incoming.afterPortfolio;

  if (incomingSource === "stock") {
    const existingProducts = existing.afterPortfolio.filter(
      (item) => item.source === "product",
    );
    afterPortfolio = [...incoming.afterPortfolio, ...existingProducts];
  }

  if (incomingSource === "product") {
    const existingHoldings = existing.afterPortfolio.filter(
      (item) => item.source !== "product",
    );
    const incomingProducts = incoming.afterPortfolio.filter(
      (item) => item.source === "product",
    );
    afterPortfolio = [...existingHoldings, ...incomingProducts];
  }

  const merged: RebalancingHistoryRecord = {
    ...existing,
    confirmedAt: incoming.confirmedAt,
    items: [...preservedItems, ...incoming.items],
    beforePortfolio:
      existing.beforePortfolio.length > 0
        ? existing.beforePortfolio
        : incoming.beforePortfolio,
    afterPortfolio,
  };

  const next = [...current];
  next[index] = merged;

  return next.sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}