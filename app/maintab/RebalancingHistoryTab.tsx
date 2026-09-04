"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GitCompareArrows,
  History,
  X,
} from "lucide-react";
import {
  useCustomerContext,
  type RebalancingHistoryRecord,
  type RebalancingPortfolioSnapshot,
} from "./CustomerContext";

function formatDateTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function money(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function amountText(item: {
  quantity: number | null;
  amountKrw: number | null;
}) {
  if (item.quantity != null) {
    return `${item.quantity.toLocaleString("ko-KR")}주`;
  }

  if (item.amountKrw != null) {
    return money(item.amountKrw);
  }

  return "-";
}

function snapshotKey(item: RebalancingPortfolioSnapshot) {
  return `${item.name}::${item.ticker}`;
}

function changeText(
  before?: RebalancingPortfolioSnapshot,
  after?: RebalancingPortfolioSnapshot,
) {
  if (before && !after) {
    return {
      text: before.source === "product" ? "전량 해지" : "전량 매도",
      className: "border-red-200 bg-red-50 text-red-600",
    };
  }

  if (!before && after) {
    return {
      text: after.source === "product" ? "신규 가입" : "신규 편입",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  if (!before || !after) {
    return {
      text: "-",
      className: "border-slate-200 bg-slate-50 text-slate-500",
    };
  }

  if (before.quantity != null && after.quantity != null) {
    const diff = after.quantity - before.quantity;

    if (diff < 0) {
      return {
        text: `${Math.abs(diff).toLocaleString("ko-KR")}주 매도`,
        className: "border-red-200 bg-red-50 text-red-600",
      };
    }

    if (diff > 0) {
      return {
        text: `${diff.toLocaleString("ko-KR")}주 추가매수`,
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }
  }

  if (before.amountKrw != null && after.amountKrw != null) {
    const diff = after.amountKrw - before.amountKrw;

    if (diff < 0) {
      return {
        text: `${money(Math.abs(diff))} 감소`,
        className: "border-red-200 bg-red-50 text-red-600",
      };
    }

    if (diff > 0) {
      return {
        text: `${money(diff)} 증가`,
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    }
  }

  return {
    text: "변동 없음",
    className: "border-slate-200 bg-slate-50 text-slate-500",
  };
}

function snapshotQuantity(
  item?: RebalancingPortfolioSnapshot,
) {
  if (!item || item.quantity == null || !Number.isFinite(item.quantity)) {
    return "-";
  }

  return `${item.quantity.toLocaleString("ko-KR")}주`;
}

function snapshotAmount(
  item?: RebalancingPortfolioSnapshot,
) {
  if (!item) return "-";

  if (item.amountKrw != null && Number.isFinite(item.amountKrw)) {
    return money(item.amountKrw);
  }

  if (
    item.quantity != null &&
    Number.isFinite(item.quantity) &&
    item.unitPriceKrw != null &&
    Number.isFinite(item.unitPriceKrw)
  ) {
    return money(item.quantity * item.unitPriceKrw);
  }

  return "-";
}


function assetClassBadgeClass(category: string) {
  const value = category.trim();

  if (value === "국내주식")
    return "bg-indigo-50 text-indigo-600";

  if (value === "해외주식")
    return "bg-rose-50 text-rose-500";

  if (value === "국내ETF")
    return "bg-sky-50 text-sky-600";

  if (value === "해외ETF")
    return "bg-emerald-50 text-emerald-500";

  if (value === "국내채권")
    return "bg-amber-50 text-amber-600";

  if (value === "해외채권")
    return "bg-orange-50 text-orange-600";

  if (value === "채권")
    return "bg-amber-50 text-amber-600";

  if (value === "펀드")
    return "bg-violet-50 text-violet-600";

  if (value === "랩어카운트" || value === "랩")
    return "bg-cyan-50 text-cyan-600";

  if (value === "ELS")
    return "bg-pink-50 text-pink-600";

  if (value === "보험")
    return "bg-teal-50 text-teal-600";

  return "bg-slate-100 text-slate-500";
}

function displayCategory(
  item?: RebalancingPortfolioSnapshot,
) {
  if (!item) return "-";

  const raw = (item.category ?? "").trim();
  const combined = `${raw} ${item.name ?? ""} ${item.ticker ?? ""}`.toUpperCase();

  if (
    raw.includes("해외채권") ||
    raw.includes("미국채") ||
    raw.includes("외화채권")
  ) {
    return "해외채권";
  }

  if (
    raw.includes("국내채권") ||
    raw.includes("국고채") ||
    raw.includes("지방채") ||
    raw.includes("특수채")
  ) {
    return "국내채권";
  }

  if (raw === "채권" || raw.includes("채권")) {
    const looksOverseasBond =
      combined.includes("UST") ||
      combined.includes("US TREASURY") ||
      combined.includes("TREASURY") ||
      combined.includes("미국") ||
      combined.includes("USD");

    return looksOverseasBond ? "해외채권" : "국내채권";
  }

  return raw || "-";
}

function PortfolioCompareModal({
  record,
  onClose,
}: {
  record: RebalancingHistoryRecord;
  onClose: () => void;
}) {
  const rows = useMemo(() => {
    const before = new Map(
      record.beforePortfolio.map((item) => [snapshotKey(item), item]),
    );

    const after = new Map(
      record.afterPortfolio.map((item) => [snapshotKey(item), item]),
    );

    const keys = Array.from(
      new Set([...before.keys(), ...after.keys()]),
    );

    const rows = keys.map((key) => ({
      key,
      before: before.get(key),
      after: after.get(key),
    }));

    const snapshotValue = (
      item?: RebalancingPortfolioSnapshot,
    ): number => {
      if (!item) return 0;

      if (
        item.amountKrw != null &&
        Number.isFinite(item.amountKrw)
      ) {
        return item.amountKrw;
      }

      if (
        item.quantity != null &&
        Number.isFinite(item.quantity) &&
        item.unitPriceKrw != null &&
        Number.isFinite(item.unitPriceKrw)
      ) {
        return item.quantity * item.unitPriceKrw;
      }

      return 0;
    };

    // 리밸런싱 후 실제 보유 중인 자산만 기준으로
    // 자산군별 총 평가금액 계산
    const categoryTotals = new Map<string, number>();

    for (const row of rows) {
      if (!row.after) continue;

      const category = displayCategory(row.after);
      const value = snapshotValue(row.after);

      categoryTotals.set(
        category,
        (categoryTotals.get(category) ?? 0) + value,
      );
    }

    return rows.sort((a, b) => {
      const aSoldOut = Boolean(a.before && !a.after);
      const bSoldOut = Boolean(b.before && !b.after);

      // 전량 매도/해지는 항상 맨 아래
      if (aSoldOut !== bSoldOut) {
        return aSoldOut ? 1 : -1;
      }

      const assetA = a.after ?? a.before;
      const assetB = b.after ?? b.before;

      const categoryA = displayCategory(assetA);
      const categoryB = displayCategory(assetB);

      if (!aSoldOut && !bSoldOut) {
        // 1차: 자산군별 총 평가금액 내림차순
        const categoryValueA = categoryTotals.get(categoryA) ?? 0;
        const categoryValueB = categoryTotals.get(categoryB) ?? 0;

        if (categoryValueA !== categoryValueB) {
          return categoryValueB - categoryValueA;
        }

        // 2차: 같은 자산군 안에서 개별 종목 금액 내림차순
        const valueA = snapshotValue(a.after ?? a.before);
        const valueB = snapshotValue(b.after ?? b.before);

        if (valueA !== valueB) {
          return valueB - valueA;
        }
      } else {
        // 전량 매도/해지끼리는 기존 금액이 컸던 순
        const valueA = snapshotValue(a.before);
        const valueB = snapshotValue(b.before);

        if (valueA !== valueB) {
          return valueB - valueA;
        }
      }

      // 금액까지 같으면 종목명순
      return (assetA?.name ?? "").localeCompare(
        assetB?.name ?? "",
        "ko-KR",
        {
          numeric: true,
          sensitivity: "base",
        },
      );
    });
  }, [record]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-6"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="max-h-[88vh] w-full max-w-[1500px] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">
              포트폴리오 전후 비교
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              {formatDateTime(record.consultationAt)} 상담 기준
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[72vh] overflow-auto p-6">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-black text-slate-600">
                    카테고리
                  </th>

                  <th className="min-w-[210px] px-4 py-3 text-left text-xs font-black text-slate-600">
                    종목명
                  </th>

                  <th className="min-w-[120px] px-4 py-3 text-left text-xs font-black text-slate-600">
                    티커
                  </th>

                  <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-black text-slate-600">
                    기존 수량
                  </th>

                  <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-black text-slate-600">
                    기존 금액
                  </th>

                  <th className="min-w-[160px] px-4 py-3 text-center text-xs font-black text-slate-600">
                    변경사항
                  </th>

                  <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-black text-slate-600">
                    이후 수량
                  </th>

                  <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-black text-slate-600">
                    이후 금액
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {rows.map(({ key, before, after }) => {
                  const change = changeText(before, after);
                  const asset = after ?? before;

                  const isRemoved = Boolean(before && !after);
                  const isNew = Boolean(!before && after);

                  return (
                    <tr
                      key={key}
                      className={
                        isRemoved
                          ? "bg-red-50/50"
                          : isNew
                            ? "bg-emerald-50/50"
                            : "bg-white hover:bg-slate-50/70"
                      }
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                          {(() => {
      const category = displayCategory(asset);
      return (
        <span
          className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold ${assetClassBadgeClass(category)}`}
        >
          {category}
        </span>
      );
    })()}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-bold text-slate-900">
                        {asset?.name || "-"}
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-500">
                        {asset?.ticker || "-"}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                        {snapshotQuantity(before)}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                        {snapshotAmount(before)}
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-bold ${change.className}`}
                        >
                          {change.text}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                        {snapshotQuantity(after)}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                        {snapshotAmount(after)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400">
            <span>※ 빨간 행: 전량 매도·해지</span>
            <span>※ 초록 행: 신규 편입·가입</span>
            <span>※ 금액: 저장 금액 우선, 없으면 수량 × 단가</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RebalancingHistoryTab() {
  const {
    selectedCustomer,
    sharedUiState,
    updateSharedUiState,
  } = useCustomerContext();

  const records = useMemo(
    () =>
      [...(sharedUiState.tab3?.rebalancingHistory ?? [])].sort((a, b) =>
        b.confirmedAt.localeCompare(a.confirmedAt),
      ),
    [sharedUiState.tab3?.rebalancingHistory],
  );

  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [compareRecord, setCompareRecord] =
    useState<RebalancingHistoryRecord | null>(null);

  useEffect(() => {
    setOpenIds(records[0] ? new Set([records[0].id]) : new Set());
  }, [selectedCustomer, records[0]?.id]);

  const updateReason = (
    historyId: string,
    itemId: string,
    reason: string,
  ) => {
    const next = records.map((record) =>
      record.id === historyId
        ? {
            ...record,
            items: record.items.map((item) =>
              item.id === itemId ? { ...item, reason } : item,
            ),
          }
        : record,
    );

    updateSharedUiState({
      tab3: {
        rebalancingHistory: next,
      },
    });
  };

  if (records.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-soft">
        <History size={30} className="mx-auto mb-3 text-slate-300" />
        <h2 className="text-base font-black text-slate-700">
          아직 리밸런싱 히스토리가 없습니다.
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          주식 또는 상품 리밸런싱을 확정하면 상담별 내역이 여기에 기록됩니다.
        </p>
      </section>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {records.map((record) => {
          const opened = openIds.has(record.id);
          const buyCount = record.items.filter(
            (item) => item.action === "매수",
          ).length;
          const sellCount = record.items.filter(
            (item) => item.action === "매도",
          ).length;
          const productCount = record.items.filter(
            (item) => item.action === "가입",
          ).length;

          return (
            <section
              key={record.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(record.id)) next.delete(record.id);
                    else next.add(record.id);
                    return next;
                  })
                }
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-black text-slate-900">
                      {formatDateTime(record.consultationAt)} 상담
                    </h2>

                    {sellCount > 0 && (
                      <span className="rounded-md border border-red-100 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                        매도 {sellCount}건
                      </span>
                    )}

                    {buyCount > 0 && (
                      <span className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        매수 {buyCount}건
                      </span>
                    )}

                    {productCount > 0 && (
                      <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                        상품 가입 {productCount}건
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-400">
                    최종 확정 {formatDateTime(record.confirmedAt)}
                  </p>
                </div>

                {opened ? (
                  <ChevronUp size={19} className="shrink-0 text-slate-400" />
                ) : (
                  <ChevronDown size={19} className="shrink-0 text-slate-400" />
                )}
              </button>

              {opened && (
                <div className="border-t border-slate-100 p-5">
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-[1080px] w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          <th className="px-3 py-3 font-bold">카테고리</th>
                          <th className="px-3 py-3 font-bold">종목명</th>
                          <th className="px-3 py-3 font-bold">티커</th>
                          <th className="px-3 py-3 font-bold">거래</th>
                          <th className="px-3 py-3 font-bold">
                            수량
                          </th>
                          <th className="px-3 py-3 font-bold">
                            매매단가 · 가입금액
                          </th>
                          <th className="min-w-[280px] px-3 py-3 font-bold">
                            리밸런싱 근거 기록
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100">
                        {record.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-3 font-semibold text-slate-600">
                              {(() => {
      const category = item.category || "기타";
      return (
        <span
          className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold ${assetClassBadgeClass(category)}`}
        >
          {category}
        </span>
      );
    })()}
                            </td>
                            <td className="px-3 py-3 font-bold text-slate-900">
                              {item.name}
                            </td>
                            <td className="px-3 py-3 text-slate-500">
                              {item.ticker || "-"}
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className={`rounded-md px-2 py-1 font-bold ${
                                  item.action === "매도" ||
                                  item.action === "해지"
                                    ? "bg-red-50 text-red-600"
                                    : item.action === "가입"
                                      ? "bg-blue-50 text-blue-700"
                                      : "bg-emerald-50 text-emerald-700"
                                }`}
                              >
                                {item.action}
                              </span>
                            </td>
                            <td className="px-3 py-3 font-semibold text-slate-700">
                              {amountText(item)}
                            </td>
                            <td className="px-3 py-3 text-slate-600">
                              {money(item.unitPriceKrw)}
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={item.reason}
                                onChange={(event) =>
                                  updateReason(
                                    record.id,
                                    item.id,
                                    event.target.value,
                                  )
                                }
                                placeholder="리밸런싱 근거를 입력하세요."
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-[#2f2f9d] focus:ring-2 focus:ring-[#2f2f9d]/10"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setCompareRecord(record)}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#2f2f9d] bg-white px-4 py-2 text-xs font-bold text-[#2f2f9d] transition hover:bg-indigo-50"
                    >
                      <GitCompareArrows size={15} />
                      포트폴리오 전후 비교
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {compareRecord && (
        <PortfolioCompareModal
          record={compareRecord}
          onClose={() => setCompareRecord(null)}
        />
      )}
    </>
  );
}