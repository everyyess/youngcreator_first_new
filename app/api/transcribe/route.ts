import { NextResponse } from "next/server";
import { getGeminiApiKey } from "@/lib/geminiServerEnv";

const allowedExtensions = new Set(["mp3", "wav", "m4a", "webm"]);
const mimeByExtension: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  webm: "audio/webm",
};
const genericMimeTypes = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function jsonError(message: string, status: number, detail?: string, source: "mock" | "gemini" = "mock") {
  return NextResponse.json({ success: false, source, geminiUsed: false, message, error: message, detail }, { status });
}

function resolveAudioFile(file: File) {
  const extension = fileExtension(file.name);
  const rawMimeType = file.type?.trim().toLowerCase() ?? "";
  const canonicalMimeType = mimeByExtension[extension];
  return {
    extension,
    rawMimeType,
    mimeType: canonicalMimeType ?? (genericMimeTypes.has(rawMimeType) ? "" : rawMimeType),
    isSupported: Boolean(canonicalMimeType),
  };
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
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return jsonError("Gemini API 키가 설정되지 않았습니다.", 500);
    }

    const formData = await request.formData();
    const audio = formData.get("audio");
    if (!(audio instanceof File)) {
      return jsonError("오디오 파일을 찾을 수 없습니다.", 400, "FormData field 'audio' is missing or is not a File.");
    }

    const { extension, rawMimeType, mimeType, isSupported } = resolveAudioFile(audio);
    if (!isSupported || !allowedExtensions.has(extension)) {
      return jsonError(
        "지원하지 않는 음성 파일 형식입니다. mp3, wav, m4a, webm 파일을 업로드해주세요.",
        400,
        `Unsupported extension '${extension || "(none)"}' with browser MIME '${rawMimeType || "(empty)"}'.`,
      );
    }

    if (audio.size <= 0) {
      return jsonError("빈 오디오 파일입니다.", 400, `File '${audio.name}' has size ${audio.size}.`);
    }

    console.info("Gemini transcription input", {
      fileName: audio.name,
      extension,
      rawMimeType: rawMimeType || "(empty)",
      normalizedMimeType: mimeType,
      size: audio.size,
    });

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
      const detail = JSON.stringify(result ?? { status: response.status, statusText: response.statusText });
      console.error("Gemini transcription failed", {
        status: response.status,
        statusText: response.statusText,
        fileName: audio.name,
        extension,
        rawMimeType,
        normalizedMimeType: mimeType,
        size: audio.size,
        result,
      });
      return jsonError("Gemini 음성 변환에 실패했습니다.", 502, detail, "gemini");
    }

    const text = textFromGeminiResponse(result);
    if (!text) {
      const detail = JSON.stringify(result ?? {});
      console.error("Gemini transcription returned empty text", {
        fileName: audio.name,
        extension,
        rawMimeType,
        normalizedMimeType: mimeType,
        size: audio.size,
        result,
      });
      return jsonError("음성에서 텍스트를 추출하지 못했습니다.", 502, detail, "gemini");
    }

    return NextResponse.json({ success: true, source: "gemini", geminiUsed: true, text });
  } catch (error) {
    console.error("Transcription route failed", error);
    return jsonError("음성 변환 중 오류가 발생했습니다.", 500, error instanceof Error ? error.message : String(error), "gemini");
  }
}
