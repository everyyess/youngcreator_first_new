/**
 * 텔레그램 세션 문자열 생성기 (최초 1회만 실행)
 *
 * 실행 방법:
 *   node scripts/generate-telegram-session.mjs
 *
 * 결과로 출력되는 세션 문자열을 .env.local 의
 *   TELEGRAM_SESSION=<여기에 붙여넣기>
 * 에 저장하세요.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import * as readline from "readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

const apiId   = parseInt(process.env.TELEGRAM_API_ID   ?? "", 10);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";

if (!apiId || !apiHash) {
  console.error(
    "\n[오류] TELEGRAM_API_ID 와 TELEGRAM_API_HASH 를 환경변수로 전달해야 합니다.\n" +
    "예시:\n" +
    "  TELEGRAM_API_ID=12345678 TELEGRAM_API_HASH=abcdef... node scripts/generate-telegram-session.mjs\n"
  );
  process.exit(1);
}

const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
  connectionRetries: 3,
});

await client.start({
  phoneNumber: async () => await ask("📱 전화번호 (+82로 시작, 예: +821012345678): "),
  password:    async () => await ask("🔑 2단계 인증 비밀번호 (없으면 Enter): "),
  phoneCode:   async () => await ask("📨 인증 코드 (텔레그램 앱에서 받은 코드): "),
  onError:     (err) => console.error("[오류]", err),
});

const sessionString = client.session.save();
console.log("\n✅ 세션 생성 완료! 아래 값을 .env.local 에 추가하세요:\n");
console.log(`TELEGRAM_SESSION=${sessionString}\n`);

await client.disconnect();
rl.close();
