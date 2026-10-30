/**
 * Non-React singletons the editor shares: the Konva stage, async-work
 * tracking (so export can wait for images/basemaps), and caches for images,
 * fonts and parsed GPX routes.
 */
import { useSyncExternalStore } from 'react';
import type Konva from 'konva';
import type { RouteDoc } from '@/lib/types';
import {
  checkpointsOnRoute,
  parseGpxDistPoints,
  parseGpxWaypoints,
  type RouteCp,
  type RouteDistPoint,
} from '@/lib/gpx';

export const runtime: {
  stage: Konva.Stage | null;
  /** Group holding the page content (background + elements), in page coords. */
  page: Konva.Group | null;
} = { stage: null, page: null };

// ---- Pending async work -----------------------------------------------------

const pending = new Set<Promise<unknown>>();

/** Register async work that must finish before a page can be exported. */
export function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  const done = () => pending.delete(p);
  p.then(done, done);
  return p;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Resolve once React has rendered and every tracked load has settled. */
export async function waitForIdle(maxMs = 15000) {
  const start = Date.now();
  for (;;) {
    await nextFrame();
    await nextFrame();
    if (!pending.size) {
      await nextFrame();
      if (!pending.size) return;
    }
    if (Date.now() - start > maxMs) return;
    await Promise.allSettled([...pending]);
  }
}

// ---- Change notifications (route geometry, fonts) ----------------------------

let assetVersion = 0;
const listeners = new Set<() => void>();
function bump() {
  assetVersion++;
  listeners.forEach((l) => l());
}
/** Re-render when a route finishes loading or a web font becomes available. */
export function useAssetVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => assetVersion,
    () => 0,
  );
}

// ---- Images ---------------------------------------------------------------------

const images = new Map<string, Promise<HTMLImageElement>>();

function loadOnce(src: string, cors: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

/**
 * Load (and cache) an image. Remote images are requested with CORS so the
 * canvas stays exportable; if the server refuses, fall back to a plain load —
 * it still displays, but export will report a tainted canvas.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    const remote = !src.startsWith('data:') && !src.startsWith('blob:');
    p = track(remote ? loadOnce(src, true).catch(() => loadOnce(src, false)) : loadOnce(src, false));
    images.set(src, p);
    p.catch(() => images.delete(src));
  }
  return p;
}

// ---- Fonts ----------------------------------------------------------------------

const fonts = new Map<string, Promise<void>>();

/** Make sure a web font is loaded before Konva measures text with it. */
export function ensureFont(family: string) {
  if (typeof document === 'undefined' || !document.fonts) return;
  if (fonts.has(family)) return;
  const p = track(
    Promise.all([
      document.fonts.load(`400 32px "${family}"`, 'กขAa'),
      document.fonts.load(`700 32px "${family}"`, 'กขAa'),
      document.fonts.load(`italic 400 32px "${family}"`, 'กขAa'),
    ])
      .then(() => bump())
      .catch(() => undefined),
  );
  fonts.set(family, p);
}

// ---- Routes -----------------------------------------------------------------------

export interface RouteGeom {
  id: string;
  pts: RouteDistPoint[];
  /** Web-Mercator coordinates (0–1), index-aligned with `pts`. */
  wx: Float64Array;
  wy: Float64Array;
  cps: RouteCp[];
  total: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export const mercX = (lng: number) => (lng + 180) / 360;
export const mercY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

const geoms = new Map<string, RouteGeom>();
const geomLoads = new Map<string, Promise<RouteGeom | null>>();

export const getGeom = (id: string) => geoms.get(id) ?? null;

/** Fetch + parse a route's GPX once; resolves null if it can't be loaded. */
export function ensureRouteGeom(route: RouteDoc): Promise<RouteGeom | null> {
  const cached = geoms.get(route._id);
  if (cached) return Promise.resolve(cached);
  let p = geomLoads.get(route._id);
  if (!p) {
    p = track(
      fetch(route.url)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((text) => {
          const pts = parseGpxDistPoints(text);
          if (pts.length < 2) return null;
          const wx = new Float64Array(pts.length);
          const wy = new Float64Array(pts.length);
          const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
          pts.forEach((p, i) => {
            wx[i] = mercX(p.lng);
            wy[i] = mercY(p.lat);
            bbox.minX = Math.min(bbox.minX, wx[i]);
            bbox.maxX = Math.max(bbox.maxX, wx[i]);
            bbox.minY = Math.min(bbox.minY, wy[i]);
            bbox.maxY = Math.max(bbox.maxY, wy[i]);
          });
          const g: RouteGeom = {
            id: route._id,
            pts,
            wx,
            wy,
            cps: checkpointsOnRoute(pts, parseGpxWaypoints(text)),
            total: pts[pts.length - 1].d,
            bbox,
          };
          geoms.set(route._id, g);
          bump();
          return g;
        })
        .catch(() => null),
    );
    geomLoads.set(route._id, p);
  }
  return p;
}
