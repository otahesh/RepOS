// Plain-fetch client for the Gemini image API (generativelanguage.googleapis.com).
// Retries 429/5xx with jittered exponential backoff per the repo's API-reliability
// rule; never puts the API key in error messages.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiImage = { mimeType: string; data: Buffer };

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function backoffMs(attempt: number): number {
  return Math.min(60_000, 2 ** attempt * 1000) + Math.floor(Math.random() * 1000);
}

export function extractImage(body: unknown): GeminiImage {
  const candidates = (body as { candidates?: unknown[] })?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error(`Gemini returned no candidates (blocked or empty): ${JSON.stringify(body).slice(0, 300)}`);
  }
  const parts =
    (candidates[0] as { content?: { parts?: Array<Record<string, unknown>> } })?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part.inlineData as { mimeType?: string; data?: string } | undefined;
    if (inline?.data) {
      return { mimeType: inline.mimeType ?? 'image/png', data: Buffer.from(inline.data, 'base64') };
    }
  }
  const text = parts.map((p) => p.text).filter(Boolean).join(' ');
  throw new Error(`Gemini returned no image. Text response: ${text || '(none)'}`);
}

export async function generateImage(opts: {
  apiKey: string;
  model: string;
  prompt: string;
  maxAttempts?: number;
}): Promise<GeminiImage> {
  const max = opts.maxAttempts ?? 5;
  for (let attempt = 0; ; attempt++) {
    // Network-level failures (ECONNRESET, DNS blip, TLS reset) are as
    // transient as a 503 — over an 88-image batch one WILL happen. Retry them
    // with the same backoff instead of failing the image.
    let res: Response | undefined;
    try {
      res = await fetch(`${API_BASE}/${opts.model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: opts.prompt }] }],
          generationConfig: {
            // TEXT+IMAGE, not IMAGE-only: image models have a history of
            // rejecting IMAGE-only modality (400), and interleaved models
            // (gemini-3-pro-image-preview) document TEXT+IMAGE as the mode.
            // extractImage() skips text parts, so this costs nothing.
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '4:3' },
          },
        }),
      });
    } catch (err) {
      if (attempt + 1 >= max) {
        throw new Error(
          `Gemini network failure after ${max} attempts on ${opts.model}: ${(err as Error).message}`,
        );
      }
    }
    if (res?.ok) return extractImage(await res.json());
    if (res) {
      const detail = (await res.text().catch(() => '')).slice(0, 400);
      if (!isRetryable(res.status) || attempt + 1 >= max) {
        throw new Error(
          `Gemini ${res.status} on ${opts.model} (attempt ${attempt + 1}/${max}): ${detail}. ` +
            'Check the model id (`npm run generate -- --smoke` lists available image models) and the API key.',
        );
      }
    }
    const wait = backoffMs(attempt);
    console.warn(`  retryable failure; waiting ${Math.round(wait / 1000)}s…`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** Free call: verifies the key + finds usable image-model ids. */
export async function listImageModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) {
    throw new Error(`Gemini model listing failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}. The key may be invalid or rotated.`);
  }
  const body = (await res.json()) as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  return (body.models ?? [])
    // imagen-* ids are :predict-only — they'd 400 on :generateContent, so
    // don't offer them to the operator.
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name?.replace(/^models\//, '') ?? '')
    .filter((n) => /image/i.test(n));
}
