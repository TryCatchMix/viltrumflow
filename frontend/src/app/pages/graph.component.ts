import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Simulation, SimulationLinkDatum, SimulationNodeDatum, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { ApiService } from '../core/api.service';
import { Graph, GraphNode } from '../core/models';
import { ThemeService } from '../core/theme.service';
import { ToastService } from '../core/toast.service';
import { IconComponent } from '../shared/icon.component';

interface N extends GraphNode, SimulationNodeDatum { r: number; }
type L = SimulationLinkDatum<N> & { kind: string };

@Component({
  selector: 'app-graph',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
  <div class="wrap">
    <div class="panel card">
      <h1>Grafo</h1>
      <p class="muted">{{ counts().notes }} notas · {{ counts().links }} enlaces</p>
      <input class="input" [ngModel]="query()" (ngModelChange)="query.set($event); draw()" placeholder="Resaltar notas…" aria-label="Resaltar notas" />
      <label class="row"><input type="checkbox" [ngModel]="showTags()" (ngModelChange)="showTags.set($event); load()" /> Etiquetas</label>
      <label class="row"><input type="checkbox" [ngModel]="showGhosts()" (ngModelChange)="showGhosts.set($event); rebuild()" /> Notas sin crear</label>
      <label class="row"><input type="checkbox" [ngModel]="showOrphans()" (ngModelChange)="showOrphans.set($event); rebuild()" /> Notas sin enlaces</label>
      <button class="btn sm" (click)="fit()"><app-icon name="sync" [size]="13" /> Centrar</button>
      <div class="legend">
        <span><i class="note"></i> Nota</span><span><i class="ghost"></i> Sin crear</span>
        @if (showTags()) { <span><i class="tag"></i> Etiqueta</span> }
      </div>
      <p class="muted hint">Rueda para ampliar, arrastra para mover. Clic en una nota para abrirla.</p>
    </div>
    <canvas #canvas role="img" aria-label="Grafo de notas enlazadas"
      (wheel)="onWheel($event)" (pointerdown)="onDown($event)" (pointermove)="onMove($event)" (pointerup)="onUp($event)" (pointerleave)="onLeave()"></canvas>
    @if (empty()) {
      <div class="empty over"><h3>Nada que mostrar todavía</h3><p>Enlaza notas con <code>[[dobles corchetes]]</code> y aparecerán conectadas aquí.</p></div>
    }
  </div>`,
  styles: [`
    :host { display: block; height: 100%; min-height: 0; }
    .wrap { position: relative; height: 100%; overflow: hidden; }
    canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
    .panel { position: absolute; top: 16px; left: 16px; z-index: 2; width: 220px; padding: 14px; display: grid; gap: 9px; font-size: 13px; }
    h1 { font-size: 16px; } label { cursor: pointer; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--text-2); border-top: 1px solid var(--border); padding-top: 9px;
      span { display: inline-flex; align-items: center; gap: 5px; } i { width: 9px; height: 9px; border-radius: 50%; }
      .note { background: var(--text-2); } .ghost { border: 1.5px dashed var(--text-3); } .tag { background: var(--series-3); border-radius: 2px; } }
    .hint { font-size: 12px; }
    .over { position: absolute; inset: 0; display: grid; place-content: center; pointer-events: none; }
    code { font: 12px var(--mono); background: var(--surface-2); padding: 1px 5px; border-radius: 4px; }
    @media (max-width: 820px) { .panel { top: 52px; left: 10px; width: 190px; } .hint, .legend { display: none; } }
  `],
})
export class GraphComponent implements AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private zone = inject(NgZone);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  private theme = inject(ThemeService);
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  query = signal('');
  showTags = signal(false);
  showGhosts = signal(true);
  showOrphans = signal(true);
  counts = signal({ notes: 0, links: 0 });
  empty = signal(false);

  private data: Graph = { nodes: [], edges: [] };
  private nodes: N[] = [];
  private links: L[] = [];
  private adj = new Map<string, Set<string>>();
  private sim?: Simulation<N, L>;
  private ro?: ResizeObserver;
  private ctx!: CanvasRenderingContext2D;
  private size = { w: 0, h: 0 };
  private view = { k: 1, x: 0, y: 0 };
  private hover: N | null = null;
  private focusId: string | null = null;
  private drag: { node: N | null; x: number; y: number; moved: boolean } | null = null;
  private colors: Record<string, string> = {};
  private fitted = false;
  private raf = 0;

  constructor() {
    const focus = this.route.snapshot.queryParamMap.get('focus');
    if (focus) this.focusId = 'n' + focus;
    effect(() => { this.theme.effective(); setTimeout(() => { this.readColors(); this.draw(); }); });
  }

  ngAfterViewInit() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.readColors();
    this.load();
  }
  ngOnDestroy() { this.sim?.stop(); this.ro?.disconnect(); cancelAnimationFrame(this.raf); }

  load() {
    this.api.graph(this.showTags()).subscribe({
      next: g => { this.data = g; this.rebuild(); },
      error: e => this.toast.error(e, 'No se pudo cargar el grafo'),
    });
  }

  /** Reconstruye la simulación conservando las posiciones de los nodos que siguen visibles. */
  rebuild() {
    const prev = new Map(this.nodes.map(n => [n.id, n]));
    const keep = this.data.nodes.filter(n => (this.showGhosts() || n.kind !== 'ghost') && (this.showOrphans() || n.degree > 0 || n.id === this.focusId));
    const ids = new Set(keep.map(n => n.id));
    this.nodes = keep.map(n => {
      const p = prev.get(n.id);
      return { ...n, r: 4 + Math.sqrt(n.degree) * 2.2, x: p?.x, y: p?.y };
    });
    this.links = this.data.edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e }));
    this.adj = new Map(this.nodes.map(n => [n.id, new Set<string>()]));
    for (const l of this.links) { this.adj.get(l.source as string)!.add(l.target as string); this.adj.get(l.target as string)!.add(l.source as string); }
    this.counts.set({ notes: this.data.nodes.filter(n => n.kind === 'note').length, links: this.data.edges.filter(e => e.kind === 'link').length });
    this.empty.set(!this.nodes.length);

    this.sim?.stop();
    this.fitted = false;
    this.zone.runOutsideAngular(() => {
      this.sim = forceSimulation<N, L>(this.nodes)
        .force('link', forceLink<N, L>(this.links).id(d => d.id).distance(l => (l.kind === 'tag' ? 50 : 70)).strength(0.5))
        .force('charge', forceManyBody<N>().strength(-220).distanceMax(500))
        .force('x', forceX<N>(0).strength(0.06))
        .force('y', forceY<N>(0).strength(0.06))
        .force('collide', forceCollide<N>(d => d.r + 6))
        .on('tick', () => {
          // Encaja la vista una vez que el grafo se ha desplegado
          if (!this.fitted && this.sim!.alpha() < 0.25) { this.fitted = true; this.fit(); }
          this.draw();
        });
    });
  }

  fit() {
    if (!this.nodes.length || !this.size.w) return;
    const focus = this.focusId && this.nodes.find(n => n.id === this.focusId);
    const set = focus ? [focus, ...this.nodes.filter(n => this.adj.get(focus.id)?.has(n.id))] : this.nodes;
    const xs = set.map(n => n.x ?? 0), ys = set.map(n => n.y ?? 0);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 90;
    const k = Math.min(2, Math.max(0.2, Math.min((this.size.w - pad * 2) / Math.max(x1 - x0, 1), (this.size.h - pad * 2) / Math.max(y1 - y0, 1))));
    this.view = { k, x: this.size.w / 2 - k * (x0 + x1) / 2, y: this.size.h / 2 - k * (y0 + y1) / 2 };
    this.draw();
  }

  // ---- Dibujo ----
  private readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const v of ['--text', '--text-2', '--text-3', '--border', '--accent', '--series-3', '--bg', '--surface-3']) this.colors[v] = cs.getPropertyValue(v).trim();
  }
  private resize() {
    const canvas = this.canvasRef.nativeElement, box = canvas.parentElement!.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const first = !this.size.w;
    this.size = { w: box.width, h: box.height };
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    if (first) this.view = { k: 1, x: box.width / 2, y: box.height / 2 };
    this.draw();
  }

  draw() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.paint());
  }

  private paint() {
    const ctx = this.ctx, c = this.colors, dpr = devicePixelRatio || 1, { k, x, y } = this.view;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.size.w, this.size.h);
    ctx.translate(x, y);
    ctx.scale(k, k);

    const q = this.query().trim().toLowerCase();
    const active = this.hover ?? (this.focusId ? this.nodes.find(n => n.id === this.focusId) ?? null : null);
    const near = active ? this.adj.get(active.id)! : null;
    const lit = (n: N) => (active ? n === active || near!.has(n.id) : q ? n.label.toLowerCase().includes(q) : true);

    ctx.lineWidth = 1 / k;
    for (const l of this.links) {
      const s = l.source as N, t = l.target as N;
      const on = active ? s === active || t === active : !q;
      ctx.strokeStyle = on && active ? c['--accent'] : c['--text-3'];
      ctx.globalAlpha = on ? (active ? 0.9 : 0.35) : 0.08;
      ctx.beginPath(); ctx.moveTo(s.x!, s.y!); ctx.lineTo(t.x!, t.y!); ctx.stroke();
    }
    for (const n of this.nodes) {
      const on = lit(n);
      ctx.globalAlpha = on ? 1 : 0.18;
      ctx.beginPath();
      if (n.kind === 'tag') ctx.roundRect(n.x! - n.r, n.y! - n.r, n.r * 2, n.r * 2, 2);
      else ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
      if (n.kind === 'ghost') {
        ctx.fillStyle = c['--bg']; ctx.fill(); ctx.setLineDash([3 / k, 3 / k]); ctx.lineWidth = 1.5 / k; ctx.strokeStyle = n === active ? c['--accent'] : c['--text-3']; ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = n === active || (q && on && !active) ? c['--accent'] : n.kind === 'tag' ? c['--series-3'] : c['--text-2'];
        ctx.fill();
        ctx.lineWidth = 2 / k; ctx.strokeStyle = c['--bg']; ctx.stroke();  // anillo: separa nodos solapados
      }
    }
    // Etiquetas: siempre las destacadas; el resto según el zoom y la importancia del nodo
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of this.nodes) {
      const on = lit(n), strong = (active || q) && on;
      if (!strong && (k < 0.55 || (k < 1.1 && n.degree < 3) || !on)) continue;
      ctx.globalAlpha = strong ? 1 : Math.min(1, (k - 0.45) * 1.6);
      ctx.font = `${n === active ? 600 : 400} ${12 / k}px ${getComputedStyle(document.body).fontFamily}`;
      const label = n.label.length > 32 ? n.label.slice(0, 31) + '…' : n.label;
      ctx.fillStyle = n.kind === 'ghost' ? c['--text-3'] : c['--text'];
      ctx.fillText(label, n.x!, n.y! + n.r + 4 / k);
    }
    ctx.globalAlpha = 1;
  }

  // ---- Interacción ----
  private at(e: PointerEvent | WheelEvent) {
    const r = this.canvasRef.nativeElement.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k };
  }
  private pick(x: number, y: number): N | null {
    let best: N | null = null, bd = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x! - x, n.y! - y), hit = n.r + 6 / this.view.k;  // diana mayor que el nodo
      if (d < hit && d < bd) { best = n; bd = d; }
    }
    return best;
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.at(e), k = Math.min(4, Math.max(0.15, this.view.k * Math.exp(-e.deltaY * 0.0015)));
    this.view = { k, x: p.sx - p.x * k, y: p.sy - p.y * k };
    this.draw();
  }
  onDown(e: PointerEvent) {
    const p = this.at(e), node = this.pick(p.x, p.y);
    this.drag = { node, x: e.clientX, y: e.clientY, moved: false };
    this.canvasRef.nativeElement.setPointerCapture(e.pointerId);
  }
  onMove(e: PointerEvent) {
    const p = this.at(e), d = this.drag, canvas = this.canvasRef.nativeElement;
    if (d) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.moved = true;
      if (!d.moved) return;
      if (d.node) { d.node.fx = p.x; d.node.fy = p.y; this.sim?.alphaTarget(0.3).restart(); }
      else { this.view.x += e.movementX; this.view.y += e.movementY; this.draw(); }
      canvas.style.cursor = 'grabbing';
      return;
    }
    const h = this.pick(p.x, p.y);
    if (h !== this.hover) { this.hover = h; canvas.style.cursor = h && h.kind !== 'tag' ? 'pointer' : 'grab'; this.draw(); }
  }
  onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    this.canvasRef.nativeElement.style.cursor = 'grab';
    if (!d) return;
    if (d.node) { d.node.fx = d.node.fy = null; this.sim?.alphaTarget(0); }
    if (d.moved) return;
    if (!d.node) { if (this.focusId) { this.focusId = null; this.draw(); } return; }
    const n = d.node;
    this.zone.run(() => {
      if (n.kind === 'note') this.router.navigate(['/notes', n.note_id]);
      else if (n.kind === 'ghost') {
        this.api.createNote({ title: n.label }).subscribe({ next: c => this.router.navigate(['/notes', c.id], { queryParams: { edit: 1 } }), error: err => this.toast.error(err) });
      }
    });
  }
  onLeave() { if (this.hover && !this.drag) { this.hover = null; this.draw(); } }
}
