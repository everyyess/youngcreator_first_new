// lib/kis/auth.ts
// 한국투자증권 Open API 접근토큰 발급 및 캐싱

const KIS_DOMAIN = "https://openapi.koreainvestment.com:9443";

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cachedToken: TokenCache | null = null;

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function getKisAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt - now > 10 * 60 * 1000) {
    return cachedToken.token;
  }

  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("KIS_APP_KEY / KIS_APP_SECRET 환경 변수가 설정되지 않았습니다.");
  }

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
    expiresAt: now + data.expires_in * 1000,
  };

  return cachedToken.token;
}

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