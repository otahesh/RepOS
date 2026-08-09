export type SheetEntry = {
  slug: string;
  name: string;
  frames: { start?: string; end?: string }; // staging filenames
  prompts: { start?: string; end?: string };
};

/** Static review page written to staging/index.html — open in a browser, no server. */
export function renderContactSheet(entries: SheetEntry[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cell = (file: string | undefined, prompt: string | undefined, label: string) =>
    file
      ? `<figure><img src="${file}" loading="lazy"><figcaption>${label}</figcaption>` +
        (prompt ? `<details><summary>prompt</summary><pre>${esc(prompt)}</pre></details>` : '') +
        `</figure>`
      : `<figure class="missing"><div class="ph">missing</div><figcaption>${label}</figcaption></figure>`;
  const rows = entries
    .map(
      (e) => `<section>
<h2>${esc(e.name)} <code>${e.slug}</code></h2>
<div class="pair">${cell(e.frames.start, e.prompts.start, 'start')}${cell(e.frames.end, e.prompts.end, 'end')}</div>
<p class="hint">regen: <code>npm run generate -- --slug ${e.slug} --force</code></p>
</section>`,
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>exercise-media review</title>
<style>
body{background:#0A0D12;color:#e8e8e8;font:14px/1.4 system-ui;margin:24px;max-width:1100px}
h2{font-size:15px}code{color:#4D8DFF;font-size:12px}
.pair{display:flex;gap:12px}figure{margin:0;flex:1}img{width:100%;border-radius:8px}
.ph{aspect-ratio:4/3;border:1px dashed #444;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#888}
figcaption{font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-top:4px}
details pre{white-space:pre-wrap;font-size:11px;color:#aaa}
.hint{color:#777;font-size:12px}section{margin-bottom:32px;border-bottom:1px solid #222;padding-bottom:16px}
</style>
<h1>exercise-media staging review (${entries.length} exercises)</h1>
${rows}`;
}
