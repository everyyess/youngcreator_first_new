/**
 * 공유 요청 스케줄러 — 서버 상주 엔진(통합 리서치·추론·시그널바)의 모든 아웃바운드
 * 요청을 하나의 동시성 풀로 통과시켜, 엔진이 몇 개가 동시에 돌든 총 부하가
 * 상한을 넘지 않게 한다. 파일마다 흩어져 있던 매직넘버 딜레이(100/150/250ms)를
 * 대체하는 단일 지점.
 *
 * 사용법: `await externalApiLimit(() => fetch(...))` / `await geminiLimit(() => fetch(...))`
 */

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Task<T> = () => Promise<T>;

/** 동시 실행 개수를 max로 제한하는 리미터를 만든다 (p-limit 방식). */
export function createLimiter(max: number): <T>(task: Task<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };

  return function limit<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < max) run();
      else queue.push(run);
    });
  };
}

// dev 서버 핫리로드에도 풀이 하나만 유지되도록 globalThis에 고정
const g = globalThis as unknown as {
  _reqSchedExternal?: ReturnType<typeof createLimiter>;
  _reqSchedGemini?: ReturnType<typeof createLimiter>;
};

/** 외부 데이터 API(내부 라우트 경유 포함: 뉴스·블로그·리포트·텔레그램·Yahoo·KRX) 공용 풀 */
export const externalApiLimit = (g._reqSchedExternal ??= createLimiter(4));

/** Gemini LLM 호출 공용 풀 — 두 엔진이 동시에 돌아도 LLM 동시 요청은 5개로 제한 */
export const geminiLimit = (g._reqSchedGemini ??= createLimiter(5));

