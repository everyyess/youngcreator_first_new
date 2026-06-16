import { NextResponse } from "next/server";

const allowedExtensions = new Set(["mp3", "wav", "m4a", "webm"]);
const allowedMimeTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/webm",
]);

const mimeByExtension: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  webm: "audio/webm",
};

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function textFromGeminiResponse(value: unknown) {
  const data = value as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  return data.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim() ?? "";
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, source: "mock", geminiUsed: false, error: "Gemini API 키가 설정되지 않았습니다." }, { status: 500 });
    }

    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      return NextResponse.json({ success: false, source: "mock", geminiUsed: false, error: "오디오 파일을 찾을 수 없습니다." }, { status: 400 });
    }

    const extension = fileExtension(audio.name);
    const rawMimeType = audio.type || "";
    const mimeType = rawMimeType && rawMimeType !== "application/octet-stream"
      ? rawMimeType
      : mimeByExtension[extension] || "application/octet-stream";
    if (!allowedExtensions.has(extension) && !allowedMimeTypes.has(mimeType)) {
      return NextResponse.json({ success: false, source: "mock", geminiUsed: false, error: "지원하지 않는 오디오 형식입니다." }, { status: 400 });
    }

    if (audio.size <= 0) {
      return NextResponse.json({ success: false, source: "mock", geminiUsed: false, error: "빈 오디오 파일입니다." }, { status: 400 });
    }

    const bytes = Buffer.from(await audio.arrayBuffer());
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "다음 상담 음성을 가능한 한 정확하게 한국어 텍스트로 변환해주세요.\n요약하지 말고 원문에 가깝게 출력해주세요.",
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: bytes.toString("base64"),
                },
              },
            ],
          },
        ],
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Gemini transcription failed", { status: response.status, result });
      return NextResponse.json({ success: false, source: "gemini", geminiUsed: false, error: "Gemini 음성 변환에 실패했습니다." }, { status: 502 });
    }

    const text = textFromGeminiResponse(result);
    if (!text) {
      return NextResponse.json({ success: false, source: "gemini", geminiUsed: false, error: "음성에서 텍스트를 추출하지 못했습니다." }, { status: 502 });
    }

    return NextResponse.json({ success: true, source: "gemini", geminiUsed: true, text });
  } catch (error) {
    console.error("Transcription route failed", error);
    return NextResponse.json({ success: false, source: "gemini", geminiUsed: false, error: "음성 변환 중 오류가 발생했습니다." }, { status: 500 });
  }
}
