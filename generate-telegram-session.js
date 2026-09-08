// generate-telegram-session.js
// 한 번만 실행해서 TELEGRAM_SESSION 문자열을 발급받는 스크립트.
// 실행 후 나온 세션 문자열을 .env.local의 TELEGRAM_SESSION에 저장하고
// 이 파일은 삭제해도 됨 (세션 문자열 자체가 로그인 정보를 담고 있어 민감함).

require("dotenv").config({ path: ".env.local" });
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input"); // 터미널 입력을 받기 위한 라이브러리

const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
const apiHash = process.env.TELEGRAM_API_HASH;

(async () => {
  if (!apiId || !apiHash) {
    console.error("TELEGRAM_API_ID / TELEGRAM_API_HASH가 .env.local에 설정되지 않았습니다.");
    process.exit(1);
  }

  console.log("텔레그램 로그인을 시작합니다...");

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("전화번호를 입력하세요 (예: +821012345678): "),
    password: async () => await input.text("2단계 인증 비밀번호가 있다면 입력하세요 (없으면 Enter): "),
    phoneCode: async () => await input.text("텔레그램 앱으로 온 인증코드를 입력하세요: "),
    onError: (err) => console.error(err),
  });

  console.log("\n로그인 성공!\n");
  console.log("아래 세션 문자열을 복사해서 .env.local의 TELEGRAM_SESSION에 붙여넣으세요:\n");
  console.log(client.session.save());
  console.log("\n(이 값은 로그인 정보와 같으니 절대 다른 사람과 공유하거나 채팅에 붙여넣지 마세요)");

  await client.disconnect();
  process.exit(0);
})();