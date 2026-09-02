// app/api/screener/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildKisHeaders, KIS_BASE_URL } from "@/lib/kis/auth";

const ETF_NAME_PATTERN = /(액티브|ETF|ETN|KODEX|TIGER|KBSTAR|ARIRANG|HANARO|SOL |RISE |WON |1Q |MIDAS |PLUS |ACE |KIWOOM |채권|국채|회사채|금융채|스팩|레버리지|인버스)/;

interface KisFluctuationRow {
  stck_shrn_iscd: string;
  hts_kor_isnm: string;
  stck_prpr: string;
  prdy_ctrt: string;
  acml_vol: string;
}

interface KisVolumeRankRow {
  mksc_shrn_iscd: string;
  hts_kor_isnm: string;
  stck_prpr: string;
  prdy_ctrt: string;
  acml_vol: string;
  acml_tr_pbmn: string;
}

interface KisDisparityRow {
  stck_shrn_iscd: string;
  hts_kor_isnm: string;
  stck_prpr: string;
  prdy_ctrt: string;
  d20_dsrt: string;
}

interface KisNearHighLowRow {
  hts_kor_isnm: string;
  mksc_shrn_iscd: string;
  stck_prpr: string;
  prdy_ctrt: string;
  acml_vol: string;
  hprc_near_rate: string;
  lwpr_near_rate: string;
}

interface KisDividendRow {
  sht_cd: string;
  isin_name: string;
  per_sto_divi_amt: string;
}

async function fetchFluctuation(sortType: "rise" | "fall") {
  const headers = await buildKisHeaders("FHPST01700000");
  const params = new URLSearchParams({
    fid_rsfl_rate2: "",
    fid_cond_mrkt_div_code: "J",
    fid_cond_scr_div_code: "20170",
    fid_input_iscd: "0000",
    fid_rank_sort_cls_code: sortType === "rise" ? "0" : "1",
    fid_input_cnt_1: "0",
    fid_prc_cls_code: "1",
    fid_input_price_1: "",
    fid_input_price_2: "",
    fid_vol_cnt: "",
    fid_trgt_cls_code: "0",
    fid_trgt_exls_cls_code: "0",
    fid_div_cls_code: "0",
    fid_rsfl_rate1: "",
  });
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`fluctuation HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.output as KisFluctuationRow[])
  .filter((r) => Number(r.acml_vol) > 0 && !ETF_NAME_PATTERN.test(r.hts_kor_isnm))
  .map((r) => ({
    ticker: r.stck_shrn_iscd,
    name: r.hts_kor_isnm,
    price: Number(r.stck_prpr),
    changePct: Number(r.prdy_ctrt),
    volume: Number(r.acml_vol),
  }));
}

async function fetchVolumeRank(blngClsCode: "0" | "3") {
  const headers = await buildKisHeaders("FHPST01710000");
  const params = new URLSearchParams({
    fid_cond_mrkt_div_code: "J",
    fid_cond_scr_div_code: "20171",
    fid_input_iscd: "0000",
    fid_div_cls_code: "0",
    fid_blng_cls_code: blngClsCode,
    fid_trgt_cls_code: "111111111",
    fid_trgt_exls_cls_code: "0000000000",
    fid_input_price_1: "",
    fid_input_price_2: "",
    fid_vol_cnt: "",
    fid_input_date_1: "",
  });
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/volume-rank?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`volume-rank HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.output as KisVolumeRankRow[])
    .filter((r) => !ETF_NAME_PATTERN.test(r.hts_kor_isnm))
    .map((r) => ({
      ticker: r.mksc_shrn_iscd,
      name: r.hts_kor_isnm,
      price: Number(r.stck_prpr),
      changePct: Number(r.prdy_ctrt),
      volume: Number(r.acml_vol),
      tradingValue: Math.round(Number(r.acml_tr_pbmn) / 100_000_000),
    }));
}

async function fetchDisparity() {
  const headers = await buildKisHeaders("FHPST01780000");
  const params = new URLSearchParams({
    fid_input_iscd: "0000",
    fid_rank_sort_cls_code: "0",
    fid_hour_cls_code: "20",
    fid_cond_mrkt_div_code: "J",
    fid_cond_scr_div_code: "20178",
    fid_div_cls_code: "0",
    fid_trgt_cls_code: "0",
    fid_trgt_exls_cls_code: "0",
    fid_input_price_1: "",
    fid_input_price_2: "",
    fid_vol_cnt: "",
  });
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/disparity?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`disparity HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.output as KisDisparityRow[])
    .filter((r) => !ETF_NAME_PATTERN.test(r.hts_kor_isnm))
    .map((r) => ({
      ticker: r.stck_shrn_iscd,
      name: r.hts_kor_isnm,
      price: Number(r.stck_prpr),
      changePct: Number(r.prdy_ctrt),
      disparity20d: Number(r.d20_dsrt) - 100,
    }))
    .filter((r) => Math.abs(r.disparity20d) < 100);
}

async function fetchNearHighLow(priceClsCode: "0" | "1") {
  const headers = await buildKisHeaders("FHPST01870000");
  const params = new URLSearchParams({
    fid_aply_rang_vol: "100000",
    fid_cond_mrkt_div_code: "J",
    fid_cond_scr_div_code: "20187",
    fid_div_cls_code: "0",
    fid_input_cnt_1: "0",
    fid_input_cnt_2: "5",
    fid_prc_cls_code: priceClsCode,
    fid_input_iscd: "0000",
    fid_trgt_cls_code: "0",
    fid_trgt_exls_cls_code: "0",
    fid_aply_rang_prc_1: "",
    fid_aply_rang_prc_2: "",
  });
  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/near-new-highlow?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`near-new-highlow HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.output as KisNearHighLowRow[])
    .filter((r) => !ETF_NAME_PATTERN.test(r.hts_kor_isnm))
    .map((r) => ({
      ticker: r.mksc_shrn_iscd,
      name: r.hts_kor_isnm,
      price: Number(r.stck_prpr),
      changePct: Number(r.prdy_ctrt),
      highLowGapPct: priceClsCode === "0" ? -Number(r.hprc_near_rate) : Number(r.lwpr_near_rate),
    }));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPrice(ticker: string): Promise<number | null> {
  try {
    const headers = await buildKisHeaders("FHKST01010100");
    const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${ticker}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[dividend] 현재가 조회 실패 (${ticker}): HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const price = Number(json.output?.stck_prpr);
    if (!Number.isFinite(price) || price <= 0) {
      console.warn(`[dividend] 현재가 값 이상 (${ticker}): ${json.output?.stck_prpr}`);
      return null;
    }
    return price;
  } catch (err) {
    console.warn(`[dividend] 현재가 조회 예외 (${ticker}):`, err);
    return null;
  }
}

// KIS 초당 20건 제한(EGW00201) 회피를 위해 병렬(Promise.all) 대신 순차 호출 +
// 요청 간 80ms 간격을 둠(초당 최대 약 12건으로 제한, 다른 동시 요청과 겹칠 여유 확보).
async function fetchDividendTop() {
  const headers = await buildKisHeaders("HHKDB13470100");

  const today = new Date();
  const toStr = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const params = new URLSearchParams({
    CTS_AREA: "",
    GB1: "0",
    UPJONG: "0001",
    GB2: "0",
    GB3: "2",
    F_DT: toStr(oneYearAgo),
    T_DT: toStr(today),
    GB4: "1",
  });

  const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/ranking/dividend-rate?${params.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`dividend-rate HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const rawRows = json.output as KisDividendRow[];

  const results: { ticker: string; name: string; price: number; dividendYield: number }[] = [];
  let failed = 0;

  for (const r of rawRows) {
    const price = await fetchPrice(r.sht_cd);
    if (price === null) {
      failed++;
      continue;
    }
    const divAmt = Number(r.per_sto_divi_amt);
    const dividendYield = Number(((divAmt / price) * 100).toFixed(2));
    if (dividendYield > 0 && dividendYield < 10) {
      results.push({ ticker: r.sht_cd, name: r.isin_name, price, dividendYield });
    }
    await sleep(80);
  }

  if (failed > 0) {
    console.warn(`[dividend] 전체 ${rawRows.length}건 중 ${failed}건 현재가 조회 실패로 제외됨`);
  }

  return results;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "volume";

  try {
    if (type === "rise" || type === "fall") {
      return NextResponse.json({ ok: true, type, data: await fetchFluctuation(type) });
    }
    if (type === "disparity") {
      return NextResponse.json({ ok: true, type, data: await fetchDisparity() });
    }
    if (type === "nearHigh") {
      return NextResponse.json({ ok: true, type, data: await fetchNearHighLow("0") });
    }
    if (type === "nearLow") {
      return NextResponse.json({ ok: true, type, data: await fetchNearHighLow("1") });
    }
    if (type === "dividend") {
      return NextResponse.json({ ok: true, type, data: await fetchDividendTop() });
    }
    if (type === "value") {
      return NextResponse.json({ ok: true, type, data: await fetchVolumeRank("3") });
    }
    return NextResponse.json({ ok: true, type: "volume", data: await fetchVolumeRank("0") });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[screener] type=${type} 실패:`, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}