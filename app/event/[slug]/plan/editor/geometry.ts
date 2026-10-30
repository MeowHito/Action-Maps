/**
 * Pure geometry for the editor: map-element projection, basemap tiles,
 * snapping a point onto a route, connector paths and element bounding boxes.
 */
import type { ConnectorElement, MapElement, PlanElement } from './types';
import { getGeom, track, type RouteGeom } from './runtime';

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

// ---- Element transforms -----------------------------------------------------

/** Element-local point → page point (rotation pivots on the element's x/y). */
export function localToPage(el: { x: number; y: number; rotation: number }, p: Pt): Pt {
  const r = (el.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: el.x + p.x * c - p.y * s, y: el.y + p.x * s + p.y * c };
}

export function pageToLocal(el: { x: number; y: number; rotation: number }, p: Pt): Pt {
  const r = (-el.rotation * Math.PI) / 180;
  const dx = p.x - el.x;
  const dy = p.y - el.y;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

/** Axis-aligned bounds of a (possibly rotated) element box. */
export function elementBox(el: PlanElement): Box {
  const corners = [
    { x: 0, y: 0 },
    { x: el.width, y: 0 },
    { x: el.width, y: el.height },
    { x: 0, y: el.height },
  ].map((p) => localToPage(el, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const b = Math.max(...boxes.map((bb) => bb.y + bb.height));
  return { x, y, width: r - x, height: b - y };
}

// ---- Map projection ------------------------------------------------------------

export interface MapView {
  /** World (Mercator 0–1) point drawn at the centre of the element. */
  cx: number;
  cy: number;
  /** Element pixels per world unit. */
  s: number;
  w: number;
  h: number;
}

export function mapGeoms(el: MapElement): RouteGeom[] {
  return el.routeIds.map(getGeom).filter((g): g is RouteGeom => !!g);
}

/** Fit the element's routes into its box, then apply zoom / pan. */
export function mapView(el: MapElement, geoms = mapGeoms(el)): MapView | null {
  if (!geoms.length) return null;
  const minX = Math.min(...geoms.map((g) => g.bbox.minX));
  const maxX = Math.max(...geoms.map((g) => g.bbox.maxX));
  const minY = Math.min(...geoms.map((g) => g.bbox.minY));
  const maxY = Math.max(...geoms.map((g) => g.bbox.maxY));
  const bw = Math.max(maxX - minX, 1e-9);
  const bh = Math.max(maxY - minY, 1e-9);
  const pad = Math.min(el.width, el.height) * 0.08;
  const s =
    Math.min((el.width - pad * 2) / bw, (el.height - pad * 2) / bh) * Math.max(0.2, el.zoom);
  return {
    cx: (minX + maxX) / 2 + el.panX * bw,
    cy: (minY + maxY) / 2 + el.panY * bh,
    s: Math.max(s, 1e-6),
    w: el.width,
    h: el.height,
  };
}

export const project = (v: MapView, wx: number, wy: number): Pt => ({
  x: (wx - v.cx) * v.s + v.w / 2,
  y: (wy - v.cy) * v.s + v.h / 2,
});

/** World point at distance `d` (km) along a route. */
export function worldAt(g: RouteGeom, d: number): { wx: number; wy: number; i: number } {
  const pts = g.pts;
  if (d <= pts[0].d) return { wx: g.wx[0], wy: g.wy[0], i: 0 };
  const last = pts.length - 1;
  if (d >= pts[last].d) return { wx: g.wx[last], wy: g.wy[last], i: last };
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const span = pts[hi].d - pts[lo].d;
  const f = span > 0 ? (d - pts[lo].d) / span : 0;
  return {
    wx: g.wx[lo] + (g.wx[hi] - g.wx[lo]) * f,
    wy: g.wy[lo] + (g.wy[hi] - g.wy[lo]) * f,
    i: lo,
  };
}

/** Projected polyline, decimated to drop points closer than `minPx`. */
export function projectRoute(v: MapView, g: RouteGeom, minPx = 0.75): number[] {
  const out: number[] = [];
  let lx = Infinity;
  let ly = Infinity;
  const n = g.pts.length;
  for (let i = 0; i < n; i++) {
    const x = (g.wx[i] - v.cx) * v.s + v.w / 2;
    const y = (g.wy[i] - v.cy) * v.s + v.h / 2;
    if (i === n - 1 || Math.abs(x - lx) + Math.abs(y - ly) >= minPx) {
      out.push(x, y);
      lx = x;
      ly = y;
    }
  }
  return out;
}

/** Page position of a route anchor, or null if its map/route is gone. */
export function anchorToPage(
  anchor: { mapId: string; routeId: string; d: number },
  elements: PlanElement[],
): Pt | null {
  const map = elements.find((e) => e.id === anchor.mapId);
  if (!map || map.type !== 'map' || !map.routeIds.includes(anchor.routeId)) return null;
  const g = getGeom(anchor.routeId);
  const v = mapView(map);
  if (!g || !v) return null;
  const w = worldAt(g, anchor.d);
  return localToPage(map, project(v, w.wx, w.wy));
}

export interface RouteSnap {
  mapId: string;
  routeId: string;
  d: number;
  x: number;
  y: number;
  /** Distance from the query point, in page px. */
  dist: number;
}

/** Nearest point on any route of any visible map on the page. */
export function snapToRoutes(p: Pt, elements: PlanElement[]): RouteSnap | null {
  let best: RouteSnap | null = null;
  for (const el of elements) {
    if (el.type !== 'map' || el.hidden) continue;
    const v = mapView(el);
    if (!v) continue;
    const q = pageToLocal(el, p);
    for (const id of el.routeIds) {
      const g = getGeom(id);
      if (!g) continue;
      let ax = (g.wx[0] - v.cx) * v.s + v.w / 2;
      let ay = (g.wy[0] - v.cy) * v.s + v.h / 2;
      for (let i = 1; i < g.pts.length; i++) {
        const bx = (g.wx[i] - v.cx) * v.s + v.w / 2;
        const by = (g.wy[i] - v.cy) * v.s + v.h / 2;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const f = len2 > 0 ? Math.min(1, Math.max(0, ((q.x - ax) * dx + (q.y - ay) * dy) / len2)) : 0;
        const px = ax + dx * f;
        const py = ay + dy * f;
        const dist = Math.hypot(q.x - px, q.y - py);
        // Clip to the visible map area.
        const inside = px >= 0 && py >= 0 && px <= el.width && py <= el.height;
        if (inside && (!best || dist < best.dist)) {
          const pg = localToPage(el, { x: px, y: py });
          best = {
            mapId: el.id,
            routeId: id,
            d: g.pts[i - 1].d + (g.pts[i].d - g.pts[i - 1].d) * f,
            x: pg.x,
            y: pg.y,
            dist,
          };
        }
        ax = bx;
        ay = by;
      }
    }
  }
  return best;
}

// ---- Connectors ---------------------------------------------------------------

/** Points of a connector path plus its two ends, in page coords. */
export function connectorPath(
  c: ConnectorElement,
  elements: PlanElement[],
): { points: number[]; start: Pt; end: Pt } | null {
  const from = elements.find((e) => e.id === c.fromId);
  const end = anchorToPage(c.to, elements);
  if (!from || !end || from.hidden) return null;

  let side = c.fromSide;
  if (side === 'auto') {
    const b = elementBox(from);
    if (end.x >= b.x + b.width) side = 'right';
    else if (end.x <= b.x) side = 'left';
    else side = end.y < b.y ? 'top' : 'bottom';
  }
  const local =
    side === 'left'
      ? { x: 0, y: from.height / 2 }
      : side === 'right'
        ? { x: from.width, y: from.height / 2 }
        : side === 'top'
          ? { x: from.width / 2, y: 0 }
          : { x: from.width / 2, y: from.height };
  const s = localToPage(from, local);

  let pts: Pt[];
  switch (c.routing) {
    case 'hv':
      pts = [s, { x: end.x, y: s.y }, end];
      break;
    case 'vh':
      pts = [s, { x: s.x, y: end.y }, end];
      break;
    case 'hvh': {
      const mx = s.x + (end.x - s.x) * c.bend;
      pts = [s, { x: mx, y: s.y }, { x: mx, y: end.y }, end];
      break;
    }
    case 'vhv': {
      const my = s.y + (end.y - s.y) * c.bend;
      pts = [s, { x: s.x, y: my }, { x: end.x, y: my }, end];
      break;
    }
    default:
      pts = [s, end];
  }
  return { points: pts.flatMap((p) => [p.x, p.y]), start: s, end };
}

// ---- Basemap tiles ---------------------------------------------------------------

const TILE_SOURCES: Record<string, { url: string; maxZoom: number; credit: string }> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    credit: '© Esri',
  },
  topo: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 18,
    credit: '© Esri',
  },
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    credit: '© OpenStreetMap',
  },
  // Keyless gray canvas basemaps; they have no data past zoom 16.
  light: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
    credit: '© Esri',
  },
  dark: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
    credit: '© Esri',
  },
};

export const basemapCredit = (b: string) => TILE_SOURCES[b]?.credit ?? '';

const tileImgs = new Map<string, Promise<HTMLImageElement | null>>();
function loadTile(url: string) {
  let p = tileImgs.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    tileImgs.set(url, p);
  }
  return p;
}

const basemaps = new Map<string, Promise<HTMLCanvasElement | null>>();

/** Stable cache key for a basemap render. */
export function basemapKey(el: MapElement, v: MapView) {
  return [
    el.basemap,
    el.basemapGray ? 1 : 0,
    Math.round(v.w),
    Math.round(v.h),
    v.cx.toFixed(8),
    v.cy.toFixed(8),
    v.s.toFixed(2),
  ].join('|');
}

/**
 * Stitch map tiles covering the element into an offscreen canvas (at up to
 * 2× for crisp export), optionally converted to grayscale.
 */
export function renderBasemap(el: MapElement, v: MapView): Promise<HTMLCanvasElement | null> {
  const src = TILE_SOURCES[el.basemap];
  if (!src) return Promise.resolve(null);
  const key = basemapKey(el, v);
  const hit = basemaps.get(key);
  if (hit) return hit;

  const job = (async () => {
    const q = Math.min(2, 4096 / Math.max(v.w, v.h));
    const cw = Math.max(1, Math.round(v.w * q));
    const ch = Math.max(1, Math.round(v.h * q));
    const pxPerWorld = v.s * q;
    let z = Math.min(src.maxZoom, Math.max(1, Math.ceil(Math.log2(pxPerWorld / 256))));
    const x0 = v.cx - v.w / 2 / v.s;
    const x1 = v.cx + v.w / 2 / v.s;
    const y0 = v.cy - v.h / 2 / v.s;
    const y1 = v.cy + v.h / 2 / v.s;
    const range = (zz: number) => {
      const n = 2 ** zz;
      return {
        n,
        tx0: Math.floor(x0 * n),
        tx1: Math.floor(x1 * n),
        ty0: Math.max(0, Math.floor(y0 * n)),
        ty1: Math.min(n - 1, Math.floor(y1 * n)),
      };
    };
    let r = range(z);
    while (z > 1 && (r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1) > 120) r = range(--z);

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const tilePx = pxPerWorld / r.n;
    const jobs: Promise<void>[] = [];
    for (let ty = r.ty0; ty <= r.ty1; ty++) {
      for (let tx = r.tx0; tx <= r.tx1; tx++) {
        const wrapped = ((tx % r.n) + r.n) % r.n;
        const url = src.url
          .replace('{z}', String(z))
          .replace('{x}', String(wrapped))
          .replace('{y}', String(ty));
        const dx = ((tx / r.n - v.cx) * v.s + v.w / 2) * q;
        const dy = ((ty / r.n - v.cy) * v.s + v.h / 2) * q;
        jobs.push(
          loadTile(url).then((img) => {
            if (img) ctx.drawImage(img, Math.floor(dx), Math.floor(dy), Math.ceil(tilePx) + 1, Math.ceil(tilePx) + 1);
          }),
        );
      }
    }
    await Promise.all(jobs);
    if (el.basemapGray) {
      try {
        const data = ctx.getImageData(0, 0, cw, ch);
        const d = data.data;
        for (let i = 0; i < d.length; i += 4) {
          const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          d[i] = d[i + 1] = d[i + 2] = l;
        }
        ctx.putImageData(data, 0, 0);
      } catch {
        /* tile server without CORS — keep colour */
      }
    }
    return canvas;
  })();

  basemaps.set(key, job);
  // Keep the cache small: basemap canvases are large.
  if (basemaps.size > 24) basemaps.delete(basemaps.keys().next().value as string);
  return track(job);
}
