import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, inject } from '@angular/core';
import { CompletionContext, CompletionResult, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, MatchDecorator, ViewPlugin, ViewUpdate, keymap, placeholder } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '650' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '650' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontSize: '1.1em', fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent-text)' },
  { tag: t.monospace, fontFamily: 'var(--mono)', fontSize: '.92em' },
  { tag: t.quote, color: 'var(--text-2)' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--text-3)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '15px', backgroundColor: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font)', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { padding: '20px 0 40vh', caretColor: 'var(--accent)', maxWidth: '760px', margin: '0 auto' },
  '.cm-line': { padding: '0 28px' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-wikilink': { color: 'var(--accent-text)' },
  '.cm-hashtag': { color: 'var(--accent-text)', backgroundColor: 'var(--accent-soft)', borderRadius: '8px', padding: '0 4px' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-3)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: 'var(--shadow)', color: 'var(--text)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font)', fontSize: '13.5px', maxHeight: '220px', minWidth: '220px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '5px 10px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700' },
  '.cm-placeholder': { color: 'var(--text-3)' },
});

const decorate = (regexp: RegExp, cls: string) => {
  const matcher = new MatchDecorator({ regexp, decoration: Decoration.mark({ class: cls }) });
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = matcher.createDeco(view); }
    update(u: ViewUpdate) { this.decorations = matcher.updateDeco(u, this.decorations); }
  }, { decorations: v => v.decorations });
};

/** Editor Markdown (CodeMirror 6) con resaltado y autocompletado de [[enlaces]]. */
@Component({
  selector: 'app-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styles: [':host { display: block; height: 100%; min-height: 0; }'],
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  private el = inject(ElementRef<HTMLElement>);
  private zone = inject(NgZone);
  private view?: EditorView;
  private pending = '';

  /** Títulos de notas para el autocompletado tras «[[». */
  @Input() titles: string[] = [];
  @Output() changed = new EventEmitter<string>();
  @Output() save = new EventEmitter<void>();

  /** Sustituye el documento solo si difiere (los cambios que vienen del propio editor no mueven el cursor). */
  @Input() set doc(value: string) {
    this.pending = value;
    if (this.view && this.view.state.doc.toString() !== value) {
      this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: value } });
    }
  }

  ngAfterViewInit() {
    const complete = (ctx: CompletionContext): CompletionResult | null => {
      const m = ctx.matchBefore(/\[\[[^\[\]|#\n]*/);
      if (!m) return null;
      return {
        from: m.from + 2,
        validFor: /^[^\[\]|#\n]*$/,
        options: this.titles.map(title => ({
          label: title, type: 'text',
          apply: (view: EditorView, _c: unknown, from: number, to: number) => {
            const closed = view.state.sliceDoc(to, to + 2) === ']]';
            view.dispatch({ changes: { from, to, insert: closed ? title : `${title}]]` }, selection: { anchor: from + title.length + 2 } });
          },
        })),
      };
    };
    // Fuera de la zona de Angular: teclear no dispara detección de cambios en toda la app
    this.zone.runOutsideAngular(() => {
      this.view = new EditorView({
        parent: this.el.nativeElement,
        state: EditorState.create({
          doc: this.pending,
          extensions: [
            history(), closeBrackets(), EditorView.lineWrapping,
            markdown({ base: markdownLanguage }),
            syntaxHighlighting(highlight), theme,
            decorate(/\[\[[^\[\]\n]+\]\]/g, 'cm-wikilink'),
            decorate(/(?<![\w/#&])#[A-Za-zÀ-ÿ_][\w/\-À-ÿ]*/g, 'cm-hashtag'),
            autocompletion({ override: [complete], icons: false }),
            placeholder('Empieza a escribir… Usa [[ para enlazar otra nota y #etiquetas para clasificar.'),
            keymap.of([
              { key: 'Mod-s', preventDefault: true, run: () => { this.zone.run(() => this.save.emit()); return true; } },
              ...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap,
            ]),
            EditorView.updateListener.of(u => {
              if (!u.docChanged) return;
              const text = u.state.doc.toString();
              if (text === this.pending) return;  // cambio programático desde `doc`
              this.pending = text;
              this.zone.run(() => this.changed.emit(text));
            }),
            EditorView.contentAttributes.of({ 'aria-label': 'Contenido de la nota', spellcheck: 'true' }),
          ],
        }),
      });
    });
  }

  focus() { this.view?.focus(); }
  scrollToLine(line: number) {
    if (!this.view) return;
    const pos = this.view.state.doc.line(Math.min(line + 1, this.view.state.doc.lines)).from;
    this.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 20 }) });
    this.view.focus();
  }
  ngOnDestroy() { this.view?.destroy(); }
}
