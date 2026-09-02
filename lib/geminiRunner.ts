import { getOrderedGeminiApiKeys } from "./geminiServerEnv";
export { getOrderedGeminiApiKeys };
import { orderGeminiModels } from "./geminiModels";
import { geminiLimit, sleep } from "./requestScheduler";


export interface GeminiFallbackOptions {
  models: readonly string[] | string[];
  preferredModel?: string | null;
  preferredKeyIndex?: number;
  urlBuilder?: (model: string, apiKey: string) => string;
  requestInit: RequestInit;
}

export async function fetchGeminiWithFallback({
  models,
  preferredModel,
  preferredKeyIndex,
  urlBuilder,
  requestInit,
}: GeminiFallbackOptions): Promise<{ res: Response; model: string; apiKey: string }> {
  const apiKeys = await getOrderedGeminiApiKeys(preferredKeyIndex);
  if (apiKeys.length === 0) {
    throw new Error("Gemini API 키가 설정되지 않았습니다.");
  }

  const orderedModels = orderGeminiModels(models, preferredModel);
  let lastError = "";
  let rateLimitHits = 0; // 429 연속 횟수 — 지수 백오프 산정용

  for (const model of orderedModels) {
    for (const apiKey of apiKeys) {
      try {
        const url = urlBuilder
          ? urlBuilder(model, apiKey)
          : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        // 공유 풀(geminiLimit)을 통과 — 두 엔진이 동시에 돌아도 Gemini 동시 요청 상한 유지.
        // caller가 signal을 전달하면 그것과 120초 내부 타임아웃 중 먼저 발생하는 쪽으로 abort.
        // (caller signal을 무시하면 Vercel 함수 타임아웃이 먼저 걸려 504 텍스트 응답이 반환됨)
        const internalTimeout = AbortSignal.timeout(120_000);
        const effectiveSignal = requestInit.signal
          ? AbortSignal.any([requestInit.signal as AbortSignal, internalTimeout])
          : internalTimeout;
        const res = await geminiLimit(() =>
          fetch(url, { ...requestInit, signal: effectiveSignal }),
        );

        // 429: Rate Limit, 503: Service Unavailable, 404: 모델 미지원, 403: 권한 없음, 400 중 API Key 무효 오류 등 -> 다음 API 키/모델로 폴백
        let shouldFallback = false;
        let errorMsg = `HTTP ${res.status}`;
        
        if (res.status === 403 || res.status === 429 || res.status === 503 || res.status === 404) {
          shouldFallback = true;
          const data = await res.clone().json().catch(() => ({}));
          errorMsg = data.error?.message || errorMsg;
        } else if (res.status === 400) {
          const data = await res.clone().json().catch(() => ({}));
          const msg = (data.error?.message || "").toLowerCase();
          if (msg.includes("key") || msg.includes("api")) {
            shouldFallback = true;
            errorMsg = data.error?.message || errorMsg;
          }
        }

        if (shouldFallback) {
          const keyMasked = apiKey.slice(0, 8) + "...";
          lastError = `[Model: ${model}, Key: ${keyMasked}] ${errorMsg}`;
          console.warn(`[geminiRunner] ${lastError} — 다음 API 키 또는 모델로 폴백 시도`);
          
          if (res && res.status === 429) {
            // 지수 백오프: 1s → 2s → 4s → 8s (최대). 짧은 고정 대기는 재시도 폭주를 유발한다.
            const waitMs = Math.min(1000 * 2 ** rateLimitHits, 8000);
            rateLimitHits++;
            if (rateLimitHits === 1) {
              console.log(`[geminiRunner] 429 Rate Limit 감지. 지수 백오프(최대 8초)로 폴백을 시도합니다...`);
            }
            await sleep(waitMs);
          }
          continue;
        }

        // 성공적인 응답 또는 다른 클라이언트 에러(예: 프롬프트 형식 오류 400 등)는 그대로 반환
        return { res, model, apiKey };
      } catch (err: any) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(`[geminiRunner] model=${model} fetch error: ${lastError}`);
      }
    }
  }

  throw new Error(`모든 API 키와 모델 호출에 실패했습니다. 마지막 오류: ${lastError}`);
}
