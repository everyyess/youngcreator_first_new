export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { Api, TelegramClient as TC } from "telegram";
import type { StringSession as SS } from "telegram/sessions";

// eslint-disable-next-line no-eval
const _tg = eval("require")("telegram") as { TelegramClient: typeof TC; sessions: { StringSession: typeof SS } };
const TelegramClient = _tg.TelegramClient;
const StringSession = _tg.sessions.StringSession;

export async function GET() {
  const apiId      = parseInt(process.env.TELEGRAM_API_ID   ?? "", 10);
  const apiHash    = process.env.TELEGRAM_API_HASH  ?? "";
  const sessionStr = process.env.TELEGRAM_SESSION   ?? "";

  if (!apiId || !apiHash || !sessionStr) {
    return NextResponse.json({ error: "텔레그램 설정 필요" }, { status: 503 });
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
