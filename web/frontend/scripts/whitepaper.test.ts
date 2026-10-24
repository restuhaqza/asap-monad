/**
 * Tests for the markdown → whitepaper.html converter.
 *
 * The page is generated, so a converter regression is a silent regression on a
 * public URL. These assertions are deliberately about the constructs the
 * whitepaper actually uses, not about markdown in general.
 */

import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain ESM build script, no type declarations on purpose
import { build, convert, convertMasthead } from './whitepaper.mjs';

describe('convert', () => {
  it('renders headings with stable anchors and a table of contents', () => {
    const { html, toc } = convert('## 4.1 `HotspotRegistry` — facts\n\ntext');
    expect(html).toContain('<h2 id="s1-4-1-hotspotregistry-facts">');
    expect(html).toContain('<code>HotspotRegistry</code>');
    expect(toc).toEqual([{ level: 2, id: 's1-4-1-hotspotregistry-facts', text: '4.1 HotspotRegistry — facts' }]);
  });

  it('drops the `---` rules instead of doubling the h2 border', () => {
    const { html } = convert('para\n\n---\n\n## Next\n\nmore');
    expect(html).not.toContain('<hr');
    expect(html.match(/<h2/g)).toHaveLength(1);
  });

  it('builds tables with real header cells and keeps inline code intact', () => {
    const { html } = convert('| A | B |\n|---|---|\n| `x` | **y** |');
    expect(html).toContain('<thead><tr><th>A</th><th>B</th></tr></thead>');
    expect(html).toContain('<td><code>x</code></td><td><strong>y</strong></td>');
  });

  it('skips an empty header row, as used by the front-matter table', () => {
    const { html } = convert('| | |\n|---|---|\n| key | value |');
    expect(html).not.toContain('<thead>');
    expect(html).toContain('<td>key</td><td>value</td>');
  });

  it('keeps asterisks inside code spans out of the emphasis pass', () => {
    const { html } = convert('use `contracts/src/*.sol`, not *this*');
    expect(html).toContain('<code>contracts/src/*.sol</code>');
    expect(html).toContain('<em>this</em>');
  });

  it('maps repo-relative markdown links to the GitHub copy', () => {
    const { html } = convert('see [`SPEC.md`](SPEC.md) §1');
    expect(html).toContain('href="https://github.com/restuhaqza/asap-monad/blob/main/docs/SPEC.md"');
  });

  it('leaves mermaid as readable source so the CDN failure mode is not an empty box', () => {
    const { html } = convert('```mermaid\nflowchart TB\n  A-->B\n```');
    expect(html).toContain('<div class="diagram"><div class="mermaid">flowchart TB');
    expect(html).toContain('A--&gt;B');
  });

  it('renders ordered lists and blockquotes', () => {
    const { html } = convert('> **the line**\n\n1. one\n2. two');
    expect(html).toContain('<blockquote><p><strong>the line</strong></p></blockquote>');
    expect(html).toContain('<ol><li>one</li><li>two</li></ol>');
  });
});

describe('convertMasthead', () => {
  const markdown = [
    '# ASAP — Title',
    '',
    '**Satellites find the fire.**',
    '',
    '| | |',
    '|---|---|',
    '| **Chain** | `10143` |',
    '',
    'Every number was read.',
    '',
    '## 1. The problem',
    '',
    'body',
  ].join('\n');

  it('pulls the title, tagline, metadata and note out of the front matter', () => {
    const masthead = convertMasthead(markdown);
    expect(masthead.title).toBe('ASAP — Title');
    expect(masthead.tagline).toBe('Satellites find the fire.');
    expect(masthead.note).toBe('Every number was read.');
    expect(masthead.meta).toHaveLength(1);
    expect(masthead.meta[0]).toContain('<dt>Chain</dt>');
    expect(masthead.meta[0]).toContain('<code>10143</code>');
    expect(masthead.body.startsWith('## 1. The problem')).toBe(true);
  });
});

describe('build', () => {
  it('produces a self-contained page with the contents list and no raw markdown', () => {
    const html = build('# T\n\n**tag**\n\n| | |\n|---|---|\n| **Chain** | `1` |\n\n## 1. Section\n\nbody **bold**\n');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<h2>Contents</h2>');
    expect(html).toContain('href="#s1-1-section"');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toMatch(/\*\*[^*]+\*\*/);
  });
});
