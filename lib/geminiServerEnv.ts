export function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return apiKey || null;
}
