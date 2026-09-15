/**
 * Shared Gemini call. The API key is read here and only here, server-side, and
 * never reaches the browser or the extension.
 *
 * The free tier returns 503 UNAVAILABLE whenever a model is in demand, which is
 * common on whatever model shipped most recently. Two defences: the default
 * chain leads with a mature model rather than the newest one, and every model
 * is retried with backoff before moving down the chain. A whole chain failing
 * is reported as overload, not as a broken key.
 */
const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/** Override with GEMINI_MODELS, a comma-separated list, strongest-preference first. */
const DEFAULT_CHAIN = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.8-flash"];

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const ATTEMPTS_PER_MODEL = 3;

export type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function models(): string[] {
  const configured = process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL;
  const list = (configured ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_CHAIN;
}

export async function generateJson(parts: GeminiPart[], responseSchema: unknown): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set on the server", 500);

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0 },
  });

  const chain = models();
  let lastTransient = "";

  for (const model of chain) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        res = await fetch(ENDPOINT(model), {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body,
        });
      } catch (e) {
        lastTransient = `${model}: ${e instanceof Error ? e.message : "network error"}`;
        await sleep(400 * attempt);
        continue;
      }

      if (res.ok) {
        const parsed = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return (parsed.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      }

      const detail = (await res.text()).slice(0, 300);

      // A bad key or a malformed request will fail identically on every model,
      // so stop immediately rather than burning the chain on it.
      if (!RETRY_STATUSES.has(res.status)) {
        if (res.status === 404) {
          lastTransient = `${model}: not available to this key`;
          break; // try the next model — this one simply does not exist for them
        }
        throw new GeminiError(`Gemini (${model}): ${detail}`, res.status === 400 || res.status === 403 ? 400 : 502);
      }

      lastTransient = `${model}: ${res.status}`;
      // 0.6s, 1.2s, 2.4s — enough to ride out a demand spike without stalling.
      if (attempt < ATTEMPTS_PER_MODEL) await sleep(600 * 2 ** (attempt - 1));
    }
  }

  throw new GeminiError(
    `Every model was busy or unavailable (${lastTransient}). This is Gemini's free tier under load — wait a minute and try again.`,
    503,
  );
}

/** Even with a response schema the reply is untrusted input — parse defensively. */
export function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const stop = raw.lastIndexOf("}");
  if (start === -1 || stop <= start) throw new Error("model did not return JSON");
  return JSON.parse(raw.slice(start, stop + 1)) as Record<string, unknown>;
}
