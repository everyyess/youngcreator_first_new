/**
 * 저장 목록 "최근 N일" 필터 — Supabase에는 전체가 보존되고 표시만 제한한다.
 * 날짜 컬럼 포맷이 소스마다 달라(yy.mm.dd / yyyy-mm-dd / yyyy-mm-dd hh:mm 등)
 * JS에서 정규화 후 비교한다. 콘텐츠 날짜가 없으면 저장 시각(created_at) 기준.
 * 모든 날짜 비교는 한국 시간(Asia/Seoul) 달력일 기준으로 계산해, 서버가 UTC로
 * 돌아가더라도 자정 근처에서 "당일" 판정이 어긋나지 않게 한다.
 */

type Row = Record<string, unknown>;

/** Date를 한국 시간 기준 yyyy-mm-dd 문자열로 변환 */
function kstDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** 오늘 날짜(한국 시간 기준, yyyy-mm-dd) */
export function todayKst(): string {
  return kstDateStr(new Date());
}

/** ISO 타임스탬프가 한국 시간 기준 오늘 날짜인지 */
export function isTodayKst(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return kstDateStr(d) === todayKst();
}

function normDate(v: unknown): string | null {
  if (v instanceof Date) return kstDateStr(v);
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  // "yyyy-mm-dd..." (created_at 등 ISO 타임스탬프 포함) — 시각까지 있으면 KST로 변환
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/);
  if (m1) {
    if (m1[4]) {
      const parsed = new Date(s);
      if (!Number.isNaN(parsed.getTime())) return kstDateStr(parsed);
    }
    return `${m1[1]}-${m1[2]}-${m1[3]}`;
  }
  const m2 = s.match(/^(\d{2})\.(\d{2})\.(\d{2})/);
  if (m2) return `20${m2[1]}-${m2[2]}-${m2[3]}`;
  const m3 = s.match(/^(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})/);
  if (m3) return `${m3[1]}-${m3[2].padStart(2, "0")}-${m3[3].padStart(2, "0")}`;
  return null;
}

/** rows 중 콘텐츠 날짜(dateFields 순서로 탐색)가 최근 days일 이내(한국 시간 기준)인 것만 반환 */
export function filterRecent<T extends Row>(rows: T[], dateFields: string[], days = 3): T[] {
  const cutoff = kstDateStr(new Date(Date.now() - days * 24 * 3600 * 1000));
  return rows.filter((r) => {
    for (const f of dateFields) {
      const d = normDate(r[f]);
      if (d) return d >= cutoff;
    }
    return false; // 날짜를 파싱할 수 없으면 오래된 데이터가 새어 나가지 않도록 제외
  });
}

