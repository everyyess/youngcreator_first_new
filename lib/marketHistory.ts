// 시장 지표/섹터 "30분 전 대비" 조회를 위한 서버 공유 스냅샷 히스토리.
// 브라우저 localStorage에 의존하면 탭이 백그라운드일 때 폴링이 멈추거나, 기기/브라우저가
// 바뀌거나, 세션이 새로 시작될 때마다 30분 전 실측치를 잃어버린다. 이를 서버 프로세스
// 전역(globalThis)에 저장해 어떤 클라이언트가 접속하든, 탭이 열려 있지 않든 동일한
// 실측 히스토리를 참조하게 한다.

type Tick = { ts: number; val: number };

const globalForHistory = globalThis as unknown as {
  _marketHistoryStore?: Map<string, Tick[]>;
};

function store(): Map<string, Tick[]> {
  if (!globalForHistory._marketHistoryStore) globalForHistory._marketHistoryStore = new Map();
  return globalForHistory._marketHistoryStore;
}

const RETAIN_MS = 90 * 60_000; // 30분 조회에 여유를 두고 넉넉히 보관
const TOLERANCE_MS = 10 * 60_000; // 정확히 30분 전 스냅샷이 없을 때 허용하는 오차

export function recordTick(key: string, val: number, now = Date.now()): void {
  const s = store();
  const arr = (s.get(key) ?? []).filter((t) => now - t.ts <= RETAIN_MS);
  arr.push({ ts: now, val });
  s.set(key, arr);
}

/** 30분 전에 가장 가까운 실측 스냅샷 값. 신뢰할 만한 실측치가 없으면 null(지어내지 않음). */
export function get30mAgo(key: string, now = Date.now()): number | null {
  const arr = store().get(key);
  if (!arr || !arr.length) return null;
  const target = now - 30 * 60_000;
  let best = arr[0];
  let minDiff = Math.abs(arr[0].ts - target);
  for (const t of arr) {
    const diff = Math.abs(t.ts - target);
    if (diff < minDiff) {
      minDiff = diff;
      best = t;
    }
  }
  return minDiff <= TOLERANCE_MS ? best.val : null;
}
