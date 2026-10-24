/**
 * Builds `whitepaper.html` from `docs/WHITEPAPER.md`.
 *
 * The markdown in `docs/` is the single source of truth — the deployable page is
 * generated, never hand-edited, so the two can never disagree about a number.
 * Supports exactly the markdown subset the whitepaper uses (headings, tables,
 * fenced code, lists, blockquotes, inline code/bold/italic/links) and nothing
 * else, on purpose: a small converter that is obviously correct beats a
 * dependency that silently changes rendering between versions.
 *
 *   node scripts/whitepaper.mjs          # write whitepaper.html
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolved lazily and defensively: the test runner imports this module through
 * its own module graph, where `import.meta.url` is not a file URL.
 */
const SCRIPT_DIR = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const SOURCE = resolve(SCRIPT_DIR, '../../../docs/WHITEPAPER.md');
const TARGET = resolve(SCRIPT_DIR, '../whitepaper.html');

/* ── inline ──────────────────────────────────────────────────────────────── */

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The rendered page lives at /whitepaper, so a relative `docs/x.md` link would
 * 404 there. Repo-relative markdown links point at the GitHub copy instead.
 */
const GITHUB_DOCS = 'https://github.com/restuhaqza/asap-monad/blob/main/docs/';

function resolveHref(href) {
  if (/^(https?:|#|\/)/.test(href)) return href;
  const file = href.replace(/^\.?\//, '').split('/').pop() ?? href;
  return file.endsWith('.md') ? `${GITHUB_DOCS}${file}` : href;
}

/**
 * Code spans are pulled out before anything else is escaped or emphasised, so a
 * `*` or `_` inside backticks can never be mistaken for markup.
 */
function inline(text, spans) {
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });

  out = escapeHtml(out);

  // [label](href) — the label may contain a restored code token, so it is left
  // untouched here and substituted at the end.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
    `<a href="${resolveHref(href)}">${label}</a>`,
  );

  // Bare URLs in the references list. Skip anything already inside an href.
  out = out.replace(/(?<!["'>])(https?:\/\/[^\s<)]+)/g, '<a href="$1">$1</a>');

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => spans[Number(index)]);
}

const render = (text) => inline(text, []);

/* ── blocks ──────────────────────────────────────────────────────────────── */

const slug = (text) =>
  text
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const isTableRow = (line) => line.startsWith('|');
const isTableRule = (line) => /^\|[\s:|-]+\|$/.test(line.trim());

function cellHtml(row, tag = 'td') {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => `<${tag}>${render(cell.trim())}</${tag}>`);
}

function tableHtml(rows) {
  const header = cellHtml(rows[0], 'th');
  const body = rows.slice(2).map((row) => `<tr>${cellHtml(row).join('')}</tr>`);
  const head =
    header.every((cell) => cell === '<th></th>')
      ? ''
      : `<thead><tr>${header.join('')}</tr></thead>`;
  return `<div class="tw"><table>${head}<tbody>${body.join('')}</tbody></table></div>`;
}

function codeHtml(lang, lines) {
  const source = escapeHtml(lines.join('\n'));
  if (lang === 'mermaid') return `<div class="diagram"><div class="mermaid">${source}</div></div>`;
  const label = lang ? `<span class="lang">${escapeHtml(lang)}</span>` : '';
  return `<div class="pre">${label}<pre><code>${source}</code></pre></div>`;
}

/** Converts the body (everything after the title block) to HTML + a TOC. */
export function convert(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  const toc = [];
  let heading = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    // `---` rules are dropped: every h2 already carries a top border, and the
    // markdown uses both, which renders as two lines with a gap between them.
    if (trimmed === '---') continue;

    const fence = trimmed.match(/^```(\w*)$/);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i]);
        i += 1;
      }
      blocks.push(codeHtml(fence[1], body));
      continue;
    }

    const headingMatch = trimmed.match(/^(#{2,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      // Only numbered sections get an anchor + TOC row; "Abstract",
      // "References" and the appendices are h2 but still worth anchoring.
      heading += 1;
      const id = `s${heading}-${slug(text)}`;
      blocks.push(`<h${level} id="${id}">${render(text)}</h${level}>`);
      toc.push({ level, id, text: text.replace(/`/g, '') });
      continue;
    }

    if (isTableRow(trimmed)) {
      const rows = [];
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(lines[i].trim());
        i += 1;
      }
      i -= 1;
      if (rows.length >= 3 && isTableRule(rows[1])) blocks.push(tableHtml(rows));
      continue;
    }

    if (trimmed.startsWith('> ')) {
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quote.push(lines[i].trim().slice(2));
        i += 1;
      }
      i -= 1;
      blocks.push(`<blockquote><p>${render(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    const ordered = /^\d+\.\s+/.test(trimmed);
    const bullet = /^[-*]\s+/.test(trimmed);
    if (ordered || bullet) {
      const items = [];
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lines.length) {
        const current = lines[i].trim();
        if (pattern.test(current)) {
          items.push(current.replace(pattern, ''));
        } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
          // Continuation of the previous item.
          items[items.length - 1] += ` ${current}`;
        } else {
          break;
        }
        i += 1;
      }
      i -= 1;
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.map((item) => `<li>${render(item)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph = [];
    while (i < lines.length) {
      const current = lines[i].trim();
      if (
        !current ||
        current === '---' ||
        current.startsWith('```') ||
        current.startsWith('#') ||
        current.startsWith('> ') ||
        isTableRow(current) ||
        /^\d+\.\s+/.test(current) ||
        /^[-*]\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      i += 1;
    }
    i -= 1;
    if (paragraph.length) blocks.push(`<p>${render(paragraph.join(' '))}</p>`);
  }

  return { html: blocks.join('\n'), toc };
}

/** The masthead: everything before the first `## `. */
export function convertMasthead(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split(/\n(?=## )/);
  const head = lines.shift() ?? '';
  const body = lines.join('\n');

  let title = 'ASAP';
  let tagline = '';
  let note = '';
  const meta = [];

  const rows = head.split('\n').map((line) => line.trim());
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row === '---') continue;

    const h1 = row.match(/^#\s+(.*)$/);
    if (h1) {
      title = h1[1];
      continue;
    }

    if (isTableRow(row)) {
      while (i < rows.length && isTableRow(rows[i])) {
        if (!isTableRule(rows[i])) {
          const cells = cellHtml(rows[i]);
          if (cells.length === 2 && cells[0] !== '<td></td>') {
            meta.push(
              `<div><dt>${cells[0].replace(/<\/?td>/g, '').replace(/<\/?strong>/g, '')}</dt><dd>${cells[1].replace(/<\/?td>/g, '')}</dd></div>`,
            );
          }
        }
        i += 1;
      }
      i -= 1;
      continue;
    }

    if (/^\*\*[^*]+\*\*$/.test(row)) {
      tagline = render(row.replace(/^\*\*|\*\*$/g, ''));
      continue;
    }

    note = note ? `${note} ${render(row)}` : render(row);
  }

  return { title, tagline, note, meta, body };
}

/* ── page ────────────────────────────────────────────────────────────────── */

const CSS = `
:root{
  --ink:#0b0a0f; --panel:#12101a; --line:#241f33; --monad:#836ef9;
  --haze:#f5a524; --ok:#3dd68c; --dead:#ff5c5c; --blue:#5b9dff; --muted:#8b849e;
  --text:#edeaf6;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
html,body{max-width:100%;overflow-x:hidden}
body{margin:0;background:var(--ink);color:var(--text);
  font-family:Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;
  line-height:1.62;overflow-x:hidden}
a{color:inherit}
.mono,code,pre,.lang{font-family:'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.wrap{width:100%;max-width:1180px;margin:0 auto;padding:0 24px;min-width:0}
.glow{position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(720px 380px at 82% -8%,rgba(131,110,249,.18),transparent 62%),
             radial-gradient(520px 300px at 4% 4%,rgba(245,165,36,.08),transparent 60%)}
.page{position:relative;z-index:1}

nav{display:flex;align-items:center;gap:12px;padding:20px 0;flex-wrap:wrap;min-width:0}
.mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none;
  background:linear-gradient(135deg,#836ef9,#5b3fd1);box-shadow:0 8px 28px -12px rgba(131,110,249,.9)}
.mark svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round}
.brand a{text-decoration:none}
.brand h1{font-size:14px;letter-spacing:.22em;margin:0;font-weight:800}
.brand p{font-size:9px;letter-spacing:.12em;margin:0;color:var(--muted)}
nav .spacer{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border:1px solid var(--line);background:var(--panel);color:var(--text);border-radius:10px;
  padding:10px 16px;font-size:12.5px;font-weight:600;text-decoration:none;transition:.16s}
.btn:hover{border-color:#3a3350;background:#191523;transform:translateY(-1px)}
.btn-primary{background:var(--monad);border-color:var(--monad);color:#fff;
  box-shadow:0 10px 30px -14px rgba(131,110,249,.9)}
.btn-primary:hover{background:#8f7dff;border-color:#8f7dff}

/* masthead */
.mast{padding:44px 0 0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:10.5px;color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:6px 12px;margin-bottom:22px;
  font-family:'JetBrains Mono',monospace;letter-spacing:.02em}
h1.title{font-size:clamp(30px,4.6vw,50px);line-height:1.06;letter-spacing:-.03em;margin:0 0 16px;font-weight:800;max-width:22ch;overflow-wrap:break-word}
.tagline{font-size:clamp(15px,2vw,19px);color:var(--haze);margin:0 0 26px;font-weight:600;max-width:52ch}
dl.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:0 0 22px}
dl.meta>div{background:var(--panel);padding:13px 16px;min-width:0}
dl.meta dt{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:4px}
dl.meta dd{margin:0;font-size:12px;color:#c9c3d9;overflow-wrap:anywhere}
dl.meta dd code{font-size:11.5px;overflow-wrap:anywhere}
.provenance{font-size:12px;color:var(--muted);max-width:80ch;margin:0 0 8px;padding-left:14px;
  border-left:2px solid var(--monad)}

/* layout */
.doc{display:grid;grid-template-columns:232px minmax(0,1fr);gap:56px;padding:44px 0 72px;
  border-top:1px solid var(--line);margin-top:34px}
.toc{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;
  font-size:11.5px;padding-right:8px}
.toc h2{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);
  margin:0 0 12px;font-weight:700;border:0;padding:0}
.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.toc a{text-decoration:none;color:#a79fbd;display:block;border-left:2px solid transparent;padding-left:10px;line-height:1.4}
.toc a:hover{color:var(--text);border-color:var(--monad)}
.toc .sub a{padding-left:22px;font-size:11px;color:#857e99}

/* prose */
.prose{min-width:0;max-width:78ch;font-size:14.5px;color:#d7d2e4;overflow-wrap:break-word}
.prose>*:first-child{margin-top:0}
.prose h2{font-size:clamp(19px,2.4vw,25px);letter-spacing:-.02em;margin:52px 0 14px;font-weight:750;
  padding-top:22px;border-top:1px solid var(--line);color:var(--text);scroll-margin-top:18px}
.prose h2:first-of-type{border-top:0;padding-top:0;margin-top:0}
.prose h3{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);
  margin:34px 0 12px;font-weight:700;scroll-margin-top:18px}
.prose p{margin:0 0 16px}
.prose strong{color:var(--text);font-weight:650}
.prose em{color:var(--haze);font-style:normal}
.prose a{color:#b9a9ff;text-decoration:none;border-bottom:1px solid rgba(131,110,249,.35)}
.prose a:hover{border-color:var(--monad);color:#fff}
.prose ul,.prose ol{margin:0 0 18px;padding-left:22px}
.prose li{margin:0 0 8px}
.prose li::marker{color:var(--monad)}
.prose code{background:#171327;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12.5px;color:#c3b6ff}
.prose blockquote{margin:22px 0;padding:18px 22px;border-left:2px solid var(--haze);border-radius:0 12px 12px 0;
  background:linear-gradient(90deg,rgba(245,165,36,.08),transparent)}
.prose blockquote p{margin:0;font-size:15.5px;color:var(--text);font-weight:650}
.prose hr{border:0;border-top:1px solid var(--line);margin:40px 0}
.tw{max-width:100%;overflow-x:auto;margin:0 0 22px;border:1px solid var(--line);border-radius:12px}
.prose table{border-collapse:collapse;width:100%;font-size:12.5px;min-width:560px}
.prose thead th{position:sticky;top:0;padding:10px 14px;text-align:left;font-size:9.5px;
  letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;
  background:#171422;border-bottom:1px solid var(--line);white-space:nowrap}
.prose tbody tr{background:var(--panel)}
.prose tbody tr:nth-child(even){background:#15121f}
.prose tbody td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top;color:#c9c3d9;overflow-wrap:break-word}
.prose tbody tr:last-child td{border-bottom:0}
.prose tbody td:first-child{color:var(--text);font-weight:600}
.pre{position:relative;margin:0 0 22px;border:1px solid var(--line);border-radius:12px;background:#0f0d16;overflow:hidden}
.pre .lang{position:absolute;top:8px;right:12px;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#5f5880}
.pre pre{margin:0;padding:16px 18px;overflow-x:auto;font-size:11.5px;line-height:1.85;color:#a99cf5}
.prose .diagram{margin:0 0 22px;border:1px solid var(--line);border-radius:12px;background:#0f0d16;padding:18px;max-width:100%;overflow-x:auto}
.mermaid{font-family:'JetBrains Mono',monospace;font-size:11px;line-height:1.8;color:#8b84a8;
  white-space:pre-wrap;word-break:break-word;margin:0;max-width:100%;overflow-x:auto}
.mermaid svg{max-width:100%;height:auto;display:block;margin:0 auto}
.mermaid.failed{color:#6f6885}
.mermaid.failed:before{content:'diagram source — rendering unavailable offline';display:block;
  font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:#5f5880;margin-bottom:10px}

footer{border-top:1px solid var(--line);padding:34px 0 56px;color:var(--muted);font-size:11.5px}
.links{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:18px}
.links a{text-decoration:none;color:#c9c3d9;border-bottom:1px solid transparent;padding-bottom:1px}
.links a:hover{border-color:var(--monad);color:var(--text)}
.contracts{font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.9;color:#6f6885;word-break:break-all}

@media (max-width:980px){
  .doc{grid-template-columns:1fr;gap:0}
  .toc{position:static;max-height:none;margin-bottom:34px;padding:16px 18px;
    border:1px solid var(--line);border-radius:12px;background:var(--panel)}
  dl.meta{grid-template-columns:1fr}
}
@media (max-width:520px){
  .wrap{padding:0 18px}
  nav{gap:8px}
  .brand p{display:none}
  nav .btn{padding:8px 11px;font-size:11.5px}
}
@media print{
  .glow,nav,.toc,footer{display:none}
  body{background:#fff;color:#111}
  .doc{display:block;border:0;padding-top:0}
  .prose{max-width:none;color:#111}
  .prose h2,.prose h3{color:#111;border-color:#ddd}
  .prose tbody tr,.prose tbody tr:nth-child(even){background:#fff}
  .prose tbody td{color:#111;border-color:#ddd}
  .pre,.prose .diagram{background:#f6f6f8;border-color:#ddd}
}
`;

function page({ title, tagline, note, meta, html, toc }) {
  const tocHtml = toc
    .map((entry) =>
      entry.level === 2
        ? `<li class="top"><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`
        : `<li class="sub"><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="ASAP whitepaper: satellites detect a fire, a bounty opens for it, and the first responder who can prove they got there is paid on Monad." />
<meta name="theme-color" content="#0b0a0f" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(tagline)}" />
<meta property="og:url" content="https://asapmonad.web.id/whitepaper" />
<meta property="og:image" content="https://asapmonad.web.id/brand/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>${CSS}</style>
</head>
<body>
<div class="glow"></div>
<div class="page">
<div class="wrap">

  <nav>
    <div class="mark">
      <svg viewBox="0 0 24 24"><path d="M12 3c0 4-4 4.5-4 8a4 4 0 0 0 8 0c0-1.5-1-2.5-1-2.5S16 10 16 12a4 4 0 1 1-8 0"/><path d="M4 20h16" opacity=".4"/></svg>
    </div>
    <div class="brand">
      <a href="/"><h1>ASAP</h1></a>
      <p>FIRE RESPONSE BOUNTY · MONAD</p>
    </div>
    <span class="spacer"></span>
    <a class="btn" href="/">Landing</a>
    <a class="btn btn-primary" href="/portal">Open the app</a>
  </nav>

  <header class="mast">
    <div class="eyebrow"><span class="live"></span> Whitepaper · v1.0 · build of record</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    ${tagline ? `<p class="tagline">${tagline}</p>` : ''}
    ${meta.length ? `<dl class="meta">${meta.join('')}</dl>` : ''}
    ${note ? `<p class="provenance">${note}</p>` : ''}
  </header>

  <div class="doc">
    <aside class="toc">
      <h2>Contents</h2>
      <ol>
${tocHtml}
      </ol>
    </aside>
    <main class="prose">
${html}
    </main>
  </div>

</div>

<footer>
  <div class="wrap">
    <div class="links">
      <a href="/">Landing</a>
      <a href="/portal">Live app</a>
      <a href="https://github.com/restuhaqza/asap-monad/blob/main/docs/WHITEPAPER.md" target="_blank" rel="noreferrer">Markdown source</a>
      <a href="https://github.com/restuhaqza/asap-monad" target="_blank" rel="noreferrer">GitHub</a>
      <a href="https://testnet.monadscan.com" target="_blank" rel="noreferrer">Monadscan</a>
    </div>
    <div class="contracts">
      HotspotRegistry · 0xe691172812761cd8c1efcdbeb89192b35cacb9e7<br>
      FireBounty · 0x6ec281aac8f6bec24ba84c56800879b66c13097a<br>
      Monad testnet · chain 10143 · source-verified
    </div>
    <p style="margin:18px 0 0;font-size:10.5px;color:#5b556b">
      Rendered from <span class="mono">docs/WHITEPAPER.md</span> at build time — the markdown is the source of truth.
    </p>
  </div>
</footer>

</div>
<script type="module">
  const diagrams = [...document.querySelectorAll('.mermaid')];

  // Diagrams are progressive enhancement: if the CDN is unreachable the source
  // stays readable instead of leaving four empty boxes on the page.
  try {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      fontFamily: 'Inter, system-ui, sans-serif',
      flowchart: { htmlLabels: true, curve: 'basis', padding: 14 },
      themeVariables: {
        darkMode: true,
        background: '#0f0d16',
        primaryColor: '#221c3a',
        primaryTextColor: '#edeaf6',
        primaryBorderColor: '#6b5fd0',
        secondaryColor: '#171327',
        tertiaryColor: '#12101a',
        mainBkg: '#221c3a',
        nodeBorder: '#6b5fd0',
        nodeTextColor: '#edeaf6',
        textColor: '#d7d2e4',
        titleColor: '#edeaf6',
        lineColor: '#8b84a8',
        clusterBkg: '#15121f',
        clusterBorder: '#3a3350',
        edgeLabelBackground: '#0f0d16',
        noteBkgColor: '#171327',
        noteTextColor: '#c9c3d9',
        noteBorderColor: '#3a3350',
        fontSize: '15px',
      },
    });
    let n = 0;
    for (const el of diagrams) {
      try {
        const { svg } = await mermaid.render('diagram' + n++, el.textContent.trim());
        el.innerHTML = svg;
      } catch {
        el.classList.add('failed');
      }
    }
  } catch {
    diagrams.forEach((el) => el.classList.add('failed'));
  }
</script>
</body>
</html>
`;
}

/* ── run ─────────────────────────────────────────────────────────────────── */

export function build(markdown) {
  const { title, tagline, note, meta, body } = convertMasthead(markdown);
  const { html, toc } = convert(body);
  return page({ title, tagline, note, meta, html, toc });
}

// Only write the file when run as a script, never when imported by a test.
if (process.argv[1]?.endsWith('whitepaper.mjs')) {
  const markdown = readFileSync(SOURCE, 'utf8');
  const output = build(markdown);
  writeFileSync(TARGET, output);
  console.log(`whitepaper.html ← docs/WHITEPAPER.md (${output.split('\n').length} lines)`);
}
