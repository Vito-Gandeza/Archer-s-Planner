/**
 * Shared Gemini call. The API key is read here and only here, server-side, and
 * never reaches the browser or the extension.
 */
const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function generateJson(parts: GeminiPart[], responseSchema: unknown): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set on the server", 500);

  const res = await fetch(ENDPOINT(process.env.GEMINI_MODEL ?? "gemini-3.8-flash"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new GeminiError(`Gemini: ${detail.slice(0, 300)}`, res.status === 429 ? 429 : 502);
  }

  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

/** Even with a response schema the reply is untrusted input — parse defensively. */
export function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const stop = raw.lastIndexOf("}");
  if (start === -1 || stop <= start) throw new Error("model did not return JSON");
  return JSON.parse(raw.slice(start, stop + 1)) as Record<string, unknown>;
}
