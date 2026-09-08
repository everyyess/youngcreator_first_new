// app/api/kis-test/route.ts
// KIS API 연결 테스트용 임시 라우트. 정상 작동 확인 후 삭제 예정.

import { NextResponse } from "next/server";
import { buildKisHeaders, KIS_BASE_URL } from "@/lib/kis/auth";

export async function GET() {
  try {
    const headers = await buildKisHeaders("FHKST01010100"); // 주식현재가 시세 조회 TR ID

    const url = `${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=005930`;

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ ok: false, status: res.status, error: text }, { status: 502 });
    }

    const data = await res.json();

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}