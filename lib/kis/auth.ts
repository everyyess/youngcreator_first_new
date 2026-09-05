// lib/kis/auth.ts
// 한국투자증권 Open API 접근토큰 발급 및 캐싱

const KIS_DOMAIN = "https://openapi.koreainvestment.com:9443";

interface TokenCache {
  token: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: TokenCache | null = null;
let pendingTokenRequest: Promise<string> | null = null; // 동시 요청 시 중복 발급 방지용 락

/**
 * KIS 접근토큰을 반환한다. 캐시된 토큰이 아직 유효하면 재사용하고,
 * 없거나 만료됐으면 새로 발급받아 캐시한다.
 *
 * 여러 조건을 동시에 조회할 때(Promise.all로 여러 API를 병렬 호출) 토큰이
 * 아직 캐시에 없으면 각 요청이 동시에 발급을 시도해 KIS의 "1분당 1회"
 * 발급 제한(EGW00133)에 걸릴 수 있다. 이를 막기 위해 진행 중인 발급 요청을
 * pendingTokenRequest에 저장해두고, 그 사이 들어온 다른 요청은 새로 발급을
 * 시도하지 않고 이미 진행 중인 요청의 결과를 그대로 기다렸다가 재사용한다.
 */
export async function getKisAccessToken(): Promise<string> {
  const now = Date.now();

  // 만료 10분 전까지는 캐시된 토큰 재사용 (여유를 둬서 경계 시점 에러 방지)
  if (cachedToken && cachedToken.expiresAt - now > 10 * 60 * 1000) {
    return cachedToken.token;
  }

  if (pendingTokenRequest) {
    return pendingTokenRequest;
  }

  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET 환경 변수가 설정되지 않았습니다.");
  }

  pendingTokenRequest = (async () => {
    try {
      const res = await fetch(`${KIS_DOMAIN}/oauth2/tokenP`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: appKey,
          appsecret: appSecret,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`KIS 토큰 발급 실패: HTTP ${res.status} - ${text}`);
      }

      const data = (await res.json()) as TokenResponse;

      cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      return cachedToken.token;
    } finally {
      pendingTokenRequest = null;
    }
  })();

  return pendingTokenRequest;
}

/**
 * KIS API 호출에 필요한 공통 헤더를 만든다.
 * trId: 각 API 문서에 명시된 실전 TR ID
 */
export async function buildKisHeaders(trId: string): Promise<Record<string, string>> {
  const token = await getKisAccessToken();
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET 환경 변수가 설정되지 않았습니다.");
  }

  return {
    "content-type": "application/json; charset=utf-8",
    authorization: `Bearer ${token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: trId,
    custtype: "P",
  };
}

export const KIS_BASE_URL = KIS_DOMAIN;