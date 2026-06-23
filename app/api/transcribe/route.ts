import { NextResponse } from "next/server";

type TranscriptTurn = { speaker: "PB" | "고객"; text: string; timestamp?: string };

const allowedExtensions = new Set(["mp3", "wav", "m4a", "webm"]);
const mimeByExtension: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  webm: "audio/webm",
};
const genericMimeTypes = new Set(["", "application/octet-stream", "binary/octet-stream", "audio/x-m4a", "audio/m4a"]);

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function jsonError(message: string, status: number, detail?: string) {
  return NextResponse.json({ success: false, source: "azure", azureUsed: false, geminiUsed: false, message, error: message, detail }, { status });
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

function azureEndpointCandidates(projectEndpoint: string) {
  const clean = projectEndpoint.replace(/\/+$/, "");
  const origin = (() => {
    try {
      return new URL(clean).origin;
    } catch {
      return clean;
    }
  })();
  return Array.from(new Set([
    `${origin}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
    `${clean}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
  ]));
}

function stringifyErrorDetail(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function speakerLabel(rawSpeaker: unknown, speakerMap: Map<string, "PB" | "고객">) {
  const raw = String(rawSpeaker ?? "").trim();
  if (/^PB$/i.test(raw)) return "PB";
  if (/고객|customer|client/i.test(raw)) return "고객";
  const key = raw || `speaker-${speakerMap.size + 1}`;
  const existing = speakerMap.get(key);
  if (existing) return existing;
  const next = speakerMap.size === 0 ? "PB" : "고객";
  speakerMap.set(key, next);
  return next;
}

function timestampFromOffset(value: unknown) {
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function extractTextFromPhrase(phrase: Record<string, unknown>) {
  const nBest = Array.isArray(phrase.nBest) ? phrase.nBest as Record<string, unknown>[] : Array.isArray(phrase.NBest) ? phrase.NBest as Record<string, unknown>[] : [];
  const best = nBest[0] ?? {};
  return String(
    phrase.display ??
    phrase.Display ??
    phrase.text ??
    phrase.Text ??
    best.display ??
    best.Display ??
    best.lexical ??
    best.Lexical ??
    "",
  ).trim();
}

function normalizeTranscriptText(text: string) {
  return text.replace(/\uD30C\uAD34\uB429\uB2C8\uB2E4/g, "\uD30C\uAE30\uB429\uB2C8\uB2E4").trim();
}

function normalizeTranscriptTurns(transcript: TranscriptTurn[]) {
  return transcript.reduce<TranscriptTurn[]>((merged, turn) => {
    const text = normalizeTranscriptText(turn.text);
    if (!text) return merged;
    const last = merged[merged.length - 1];
    if (last?.speaker === turn.speaker) {
      last.text = `${last.text.trim()} ${text}`.trim();
      return merged;
    }
    merged.push({ ...turn, text });
    return merged;
  }, []);
}

function parseAzureTranscript(result: unknown): TranscriptTurn[] {
  const speakerMap = new Map<string, "PB" | "고객">();
  const data = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const directTranscript = Array.isArray(data.transcript) ? data.transcript as Record<string, unknown>[] : [];
  if (directTranscript.length) {
    return directTranscript
      .map((turn, index) => ({
        speaker: speakerLabel(turn.speaker ?? turn.Speaker ?? index, speakerMap),
        text: String(turn.text ?? turn.Text ?? "").trim(),
        timestamp: typeof turn.timestamp === "string" ? turn.timestamp : undefined,
      }))
      .filter((turn) => turn.text);
  }

  const phrases = [
    ...(Array.isArray(data.recognizedPhrases) ? data.recognizedPhrases as Record<string, unknown>[] : []),
    ...(Array.isArray(data.phrases) ? data.phrases as Record<string, unknown>[] : []),
  ];
  if (phrases.length) {
    return phrases
      .map((phrase, index) => ({
        speaker: speakerLabel(phrase.speaker ?? phrase.Speaker ?? phrase.speakerId ?? phrase.channel ?? index, speakerMap),
        text: extractTextFromPhrase(phrase),
        timestamp: timestampFromOffset(phrase.offsetMilliseconds ?? phrase.OffsetMilliseconds ?? phrase.offset),
      }))
      .filter((turn) => turn.text);
  }

  const combined = Array.isArray(data.combinedPhrases) ? data.combinedPhrases as Record<string, unknown>[] : [];
  if (combined.length) {
    return combined
      .map((phrase, index) => ({
        speaker: speakerLabel(phrase.speaker ?? phrase.channel ?? index, speakerMap),
        text: extractTextFromPhrase(phrase),
      }))
      .filter((turn) => turn.text);
  }

  const text = String(data.text ?? data.displayText ?? data.DisplayText ?? "").trim();
  return text ? [{ speaker: "고객", text }] : [];
}

async function requestAzureTranscription(endpoint: string, apiKey: string, audio: File, mimeType: string) {
  const form = new FormData();
  form.append("audio", new Blob([await audio.arrayBuffer()], { type: mimeType }), audio.name || "audio.webm");
  form.append("definition", JSON.stringify({
    locales: ["ko-KR"],
    diarization: { enabled: true, maxSpeakers: 2 },
    profanityFilterMode: "None",
  }));

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "api-key": apiKey,
    },
    body: form,
  });
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.AZURE_API_KEY?.trim();
    const projectEndpoint = process.env.AZURE_PROJECT_ENDPOINT?.trim();
    if (!apiKey || !projectEndpoint) {
      return jsonError("Azure STT 환경변수가 설정되지 않았습니다.", 500, "AZURE_API_KEY and AZURE_PROJECT_ENDPOINT are required.");
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
    if (audio.size <= 0) return jsonError("빈 오디오 파일입니다.", 400, `File '${audio.name}' has size ${audio.size}.`);

    const endpoints = azureEndpointCandidates(projectEndpoint);
    let response: Response | null = null;
    let result: unknown = null;
    let usedEndpoint = "";
    const failures: string[] = [];

    for (const endpoint of endpoints) {
      usedEndpoint = endpoint;
      response = await requestAzureTranscription(endpoint, apiKey, audio, mimeType);
      const rawText = await response.text().catch(() => "");
      try {
        result = rawText ? JSON.parse(rawText) : null;
      } catch {
        result = rawText;
      }
      if (response.ok) break;
      failures.push(`${response.status} ${response.statusText}: ${stringifyErrorDetail(result)}`);
    }

    if (!response || !response.ok) {
      console.error("Azure STT failed", { usedEndpoint, failures, fileName: audio.name, rawMimeType, mimeType, size: audio.size });
      return jsonError("Azure 음성 변환에 실패했습니다.", 502, failures.join(" | ") || "Azure STT request failed.");
    }

    const transcript = normalizeTranscriptTurns(parseAzureTranscript(result));
    const text = transcript.map((turn) => `${turn.speaker}: ${turn.text}`).join("\n").trim();
    if (!transcript.length || !text) {
      console.error("Azure STT returned empty transcript", { usedEndpoint, result });
      return jsonError("음성에서 대화록을 추출하지 못했습니다.", 502, stringifyErrorDetail(result));
    }

    return NextResponse.json({ success: true, source: "azure", azureUsed: true, geminiUsed: false, transcript, text });
  } catch (error) {
    console.error("Azure transcription route failed", error);
    return jsonError("음성 변환 중 오류가 발생했습니다.", 500, error instanceof Error ? error.message : String(error));
  }
}
