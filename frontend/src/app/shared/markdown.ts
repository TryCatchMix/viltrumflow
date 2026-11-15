import DOMPurify from 'dompurify';
import { Marked } from 'marked';

/** Mismas reglas que el backend (services/markdown.py) para que enlaces, etiquetas y casillas coincidan. */
const WIKILINK = /^\[\[([^\[\]|#\n]+)(#[^\[\]|\n]*)?(?:\|([^\[\]\n]*))?\]\]/;
const TAG = /^#([A-Za-zÀ-ÿ_][\w/\-À-ÿ]*)/;
export const CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/;
const FENCE = /^\s*(```|~~~)/;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  extensions: [
    {
      name: 'wikilink', level: 'inline',
      start: (src: string) => { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
      tokenizer(src: string) {
        const m = WIKILINK.exec(src);
        if (!m) return undefined;
        const title = m[1].trim().replace(/\s+/g, ' ');
        return { type: 'wikilink', raw: m[0], title, text: (m[3] ?? '').trim() || title + (m[2] ?? '') };
      },
      renderer: (t: any) => `<a class="wikilink" data-title="${esc(t.title)}">${esc(t.text)}</a>`,
    },
    {
      name: 'hashtag', level: 'inline',
      // Solo cuenta como etiqueta si va al inicio o tras un espacio ("a#b" o "#123" no lo son)
      start: (src: string) => { const m = /(^|\s)#[A-Za-zÀ-ÿ_]/.exec(src); return m ? m.index + m[1].length : undefined; },
      tokenizer(src: string) {
        const m = TAG.exec(src);
        return m ? { type: 'hashtag', raw: m[0], tag: m[1].toLowerCase() } : undefined;
      },
      renderer: (t: any) => `<a class="hashtag" data-tag="${esc(t.tag)}">#${esc(t.tag)}</a>`,
    },
  ],
});

/** Líneas (índice base 0) que contienen una casilla, ignorando bloques de código. */
export function checkboxLines(src: string): number[] {
  const out: number[] = [];
  let fence = false;
  src.split('\n').forEach((line, i) => {
    if (FENCE.test(line)) { fence = !fence; return; }
    if (!fence && CHECKBOX.test(line)) out.push(i);
  });
  return out;
}

export function toggleCheckboxLine(src: string, line: number, checked: boolean): string {
  const lines = src.split('\n');
  lines[line] = lines[line].replace(CHECKBOX, (_m, a, _b, c, d) => `${a}${checked ? 'x' : ' '}${c}${d}`);
  return lines.join('\n');
}

export interface Heading { level: number; text: string; line: number; }
export function headings(src: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  src.split('\n').forEach((line, i) => {
    if (FENCE.test(line)) { fence = !fence; return; }
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_x, a, b) => b ?? a).replace(/[*_`]/g, ''), line: i });
  });
  return out;
}

/**
 * Markdown → HTML saneado. `exists` indica si una nota existe (los enlaces sin resolver se atenúan).
 * El HTML del usuario pasa siempre por DOMPurify antes de llegar al DOM.
 */
export function renderMarkdown(src: string, exists: (title: string) => boolean): string {
  const html = DOMPurify.sanitize(marked.parse(src, { async: false }) as string, {
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'onerror', 'onclick'],
  });
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const lines = checkboxLines(src);
  tpl.content.querySelectorAll<HTMLInputElement>('li > input[type=checkbox], li > p > input[type=checkbox]').forEach((box, i) => {
    box.removeAttribute('disabled');
    if (lines[i] === undefined) { box.disabled = true; return; }
    box.dataset['line'] = String(lines[i]);
    const li = box.closest('li')!;
    li.classList.add('task');
    if (box.checked) li.classList.add('done');
  });
  tpl.content.querySelectorAll<HTMLAnchorElement>('a.wikilink').forEach(a => {
    if (!exists(a.dataset['title'] ?? '')) a.classList.add('missing');
    a.setAttribute('role', 'link');
    a.tabIndex = 0;
  });
  tpl.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  return tpl.innerHTML;
}
