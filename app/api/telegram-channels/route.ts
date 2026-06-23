export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Api, TelegramClient as TC } from "telegram";
import type { StringSession as SS } from "telegram/sessions";

export async function GET() {
  const apiId      = parseInt(process.env.TELEGRAM_API_ID   ?? "", 10);
  const apiHash    = process.env.TELEGRAM_API_HASH  ?? "";
  const sessionStr = process.env.TELEGRAM_SESSION   ?? "";

  if (!apiId || !apiHash || !sessionStr) {
    return NextResponse.json({ error: "텔레그램 설정 필요" }, { status: 503 });
  }

  let TelegramClient: typeof TC;
  let StringSession: typeof SS;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const _tg = require("telegram") as { TelegramClient: typeof TC; sessions: { StringSession: typeof SS } };
    TelegramClient = _tg.TelegramClient;
    StringSession = _tg.sessions.StringSession;
  } catch (e) {
    return NextResponse.json({ error: `telegram 모듈 로드 실패: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 2 });

  try {
    await client.connect();
    const dialogs = await client.getDialogs({ limit: 500 });

    const channels = dialogs
      .filter(d => d.entity && (d.entity as { className?: string }).className === "Channel")
      .map(d => {
        const ch = d.entity as Api.Channel;
        return {
          id: String(ch.id),
          title: ch.title || String(ch.id),
          username: ch.username || null,
          megagroup: ch.megagroup ?? false,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, "ko"));

    return NextResponse.json({ total: channels.length, channels });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    await client.disconnect();
  }
}
