export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import type { Api, TelegramClient as TC } from "telegram";
import type { StringSession as SS } from "telegram/sessions";

// ── 중요도 분류 ───────────────────────────────────────────────────────────────

const URGENT = [
  "급등", "급락", "서킷브레이커", "사이드카", "상한가", "하한가",
  "급반등", "급반락", "어닝쇼크", "어닝 쇼크", "실적쇼크", "실적 쇼크",
  "어닝서프라이즈", "어닝 서프라이즈", "제재", "수출규제", "금지", "조사",
  "불성실", "블랙리스트", "횡령", "상장폐지", "M&A", "인수", "합병", "매각",
];
const IMPORTANT = [
  "실적", "매출", "영업이익", "파산", "증자", "차익", "어닝시즌",
  "분기실적", "연간실적", "계약", "수주", "MOU", "협약", "파트너십",
  "공급계약", "출시", "개발", "생산", "특허", "신제품", "기술이전",
  "투자", "증설", "설비투자",
];

function classifyImportance(text: string): string {
  if (URGENT.some(k => text.includes(k))) return "⚠️ 긴급";
  if (IMPORTANT.some(k => text.includes(k))) return "🔵 중요";
  return "🟡 일반";
}

function topRelated(texts: string[], keyword: string) {
  const stop = new Set(["있는","합니다","하는","위해","대한","것으로","있다","대해","관련","그리고","이번","따라","하여","이후","으로","에서","에게","부터"]);
  const counter: Record<string, number> = {};
  const combined = texts.join(" ").replace(/https?\S+/g, "").replace(/[^\w\s가-힣]/g, " ");
  for (const w of combined.split(/\s+/)) {
    if (w.length < 2 || w.toLowerCase().includes(keyword.toLowerCase()) || stop.has(w)) continue;
    counter[w] = (counter[w] ?? 0) + 1;
  }
  return Object.entries(counter).sort((a,b) => b[1]-a[1]).slice(0,3).map(([word,count]) => ({ word, count }));
}

function similarity(a: string, b: string): number {
  const sa = new Set(a.split(/\s+/));
  const sb = new Set(b.split(/\s+/));
  const inter = [...sa].filter(w => sb.has(w)).length;
  return inter / Math.max(sa.size, sb.size, 1);
}

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 타입 ──────────────────────────────────────────────────────────────────────

type FoundMsg = { date: Date; text: string; id: number; channelTitle: string; cleanId: string };

export interface TelegramMessage {
  channel: string;
  date: string;
  importance: string;
  text: string;
  summary: string;
  link: string;
}
export interface TelegramSearchResponse {
  keyword: string;
  collected_at: string;
  top_related: { word: string; count: number }[];
  messages: TelegramMessage[];
  summary?: string;
  error?: string;
}

// ── 검색 제외 채널 ID 목록 ────────────────────────────────────────────────────

const EXCLUDED_CHANNEL_IDS = new Set([
  "1250083224", // 🌸Crypto Judy🐰🌸
  "3846361765", // 64비트사령부⚡️
  "1595235468", // 낭만투자파트너스
  "1265215458", // 부동산 급등일보🏠
  "1612411061", // 선수촌
  "1918977910", // 시미의 생각 아카이브
  "1514595150", // 엄브렐라리서치 Jay의 주식투자교실
  "2821525183", // 여유_Research
  "3885506984", // 여유_Summary
  "2249953555", // 요약하는 고잉
  "2322948689", // 우산 X NNN의 아이디어
  "1446671164", // 코인 갤러리(Coin gallery)
  "2318888530", // 투자 생각 한 스푼
  "1506613982", // 특파원 김씨 (5분 딜레이)
  "2388573708", // BI (Be Independent)
  "1656364050", // Brain and Body Research
  "1308754120", // BZCF | 비즈까페
  "2508155064", // fed rate cuts
  "1945407885", // KB증권 이지은의 인터넷/게임
  "2098793993", // KK Kontemporaries
  "1768167577", // Macro Jungle | micro lens
  "2283860878", // SHY_Research
  "1863728198", // Stock Trip
]);

// ── 채널 목록 조회 ────────────────────────────────────────────────────────────

async function getChannelDialogs(
  client: TC,
): Promise<{ entity: Api.Channel; title: string; cleanId: string }[]> {
  const dialogs = await client.getDialogs({ limit: 500 });
  const channels: { entity: Api.Channel; title: string; cleanId: string }[] = [];
  for (const dialog of dialogs) {
    const e = dialog.entity;
    if (!e || (e as { className?: string }).className !== "Channel") continue;
    const ch = e as Api.Channel;
    const cleanId = String(ch.id);
    if (EXCLUDED_CHANNEL_IDS.has(cleanId)) continue;
    channels.push({ entity: ch, title: ch.title || cleanId, cleanId });
  }
  return channels;
}

// ── 채널 검색 (대형 배치 병렬 처리) ──────────────────────────────────────────
// BATCH_SIZE를 크게 늘려 순차 배치 횟수를 줄임 → 전체 검색 시간 단축
// 44채널 / 20 = 3배치 × ~2s ≈ 6s (Vercel Hobby 10s 내 완료 가능)

const BATCH_SIZE = 20;

async function searchChannels(
  client: TC,
  keyword: string,
  keyword2: string | undefined,
): Promise<FoundMsg[]> {
  const channels = await getChannelDialogs(client);
  const found: FoundMsg[] = [];

  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ({ entity, title, cleanId }) => {
        try {
          const searches: Promise<unknown[]>[] = [
            client.getMessages(entity, { search: keyword, limit: 10 }),
          ];
          if (keyword2 && keyword2.toLowerCase() !== keyword.toLowerCase()) {
            searches.push(client.getMessages(entity, { search: keyword2, limit: 10 }));
          }
          const msgLists = await Promise.all(searches);
          const msgs: FoundMsg[] = [];
          for (const msgList of msgLists) {
            for (const msg of msgList) {
              const m = msg as unknown as Api.Message;
              if (!m.message || !m.date) continue;
              const textOnly = m.message.replace(/https?\S+/g, "").trim();
              if (textOnly.length < 50) continue;
              msgs.push({ date: new Date(m.date * 1000), text: m.message, id: m.id, channelTitle: title, cleanId });
            }
          }
          return msgs;
        } catch {
          return [];
        }
      })
    );
    found.push(...batchResults.flat());
  }

  return found;
}

// ── API 라우트 ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const keyword  = req.nextUrl.searchParams.get("keyword")?.trim();
  const keyword2 = req.nextUrl.searchParams.get("keyword2")?.trim() || undefined;

  if (!keyword) return NextResponse.json({ error: "keyword 파라미터가 필요합니다." }, { status: 400 });

  const apiId      = parseInt(process.env.TELEGRAM_API_ID   ?? "", 10);
  const apiHash    = process.env.TELEGRAM_API_HASH  ?? "";
  const sessionStr = process.env.TELEGRAM_SESSION   ?? "";

  if (!apiId || !apiHash || !sessionStr) {
    return NextResponse.json({ error: "텔레그램 설정 필요 (TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION)" }, { status: 503 });
  }

  // maxDuration(60s)보다 5초 일찍 중단 → Vercel HTML 504 대신 JSON 오류 반환
  const INTERNAL_TIMEOUT_MS = 55_000;

  // 모듈 레벨이 아닌 함수 내부에서 require → 초기화 실패 시 JSON 오류 반환 가능
  let TelegramClient: typeof TC;
  let StringSession: typeof SS;
  try {
    // eslint-disable-next-line no-eval
    const _tg = eval("require")("telegram") as { TelegramClient: typeof TC; sessions: { StringSession: typeof SS } };
    TelegramClient = _tg.TelegramClient;
    StringSession = _tg.sessions.StringSession;
  } catch (e) {
    return NextResponse.json({ error: `telegram 모듈 로드 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  let client: TC | null = null;
  try {
    client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 2 });
    await client.connect();

    const found = await Promise.race([
      searchChannels(client, keyword, keyword2),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("검색 시간 초과. 잠시 후 다시 시도해주세요.")),
          INTERNAL_TIMEOUT_MS,
        )
      ),
    ]);

    found.sort((a, b) => b.date.getTime() - a.date.getTime());
    const unique: FoundMsg[] = [];
    for (const m of found) {
      if (unique.every(u => similarity(m.text, u.text) < 0.8)) unique.push(m);
      if (unique.length === 10) break;
    }

    const now = new Date();
    const p = (n: number) => String(n).padStart(2,"0");
    const collectedAt = `${now.getUTCFullYear()}-${p(now.getUTCMonth()+1)}-${p(now.getUTCDate())} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())} UTC`;

    const response: TelegramSearchResponse = {
      keyword,
      collected_at: collectedAt,
      top_related: topRelated(unique.map(m => m.text), keyword),
      messages: unique.map((m) => ({
        channel: m.channelTitle,
        date: fmtDate(m.date),
        importance: classifyImportance(m.text),
        text: m.text,
        summary: "",
        link: `https://t.me/c/${m.cleanId}/${m.id}`,
      })),
      ...(unique.length === 0 ? { summary: `'${keyword}' 관련 메시지가 없습니다.` } : {}),
    };

    return NextResponse.json(response);
  } catch (e) {
    return NextResponse.json({ error: `텔레그램 연결 오류: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  } finally {
    await client?.disconnect();
  }
}
