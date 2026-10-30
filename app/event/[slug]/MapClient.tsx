'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet-gpx';
import { api } from '@/lib/api';
import { getSocket, joinEvent } from '@/lib/socket';
import { extractGps, extractTakenAt, processForUpload } from '@/lib/image';
import type { EventDoc, EventRole, PhotoDoc, RouteDoc } from '@/lib/types';
import {
  checkpointsOnRoute,
  locateOnRoute,
  parseGpxDistPoints,
  parseGpxWaypoints,
  pointAtDistance,
  type RouteCp,
  type RouteDistPoint,
} from '@/lib/gpx';

type MarkerClusterGroup = L.MarkerClusterGroup;
type AnyMarker = L.Marker & { _photoId?: string; options: L.MarkerOptions & { imgUrl?: string } };

type RoutePoint = { lat: number; lng: number; t: number };

function kilometerMarkers(
  pts: RouteDistPoint[],
): { km: number; lat: number; lng: number }[] {
  if (pts.length < 2) return [];
  const total = pts[pts.length - 1].d;
  const out: { km: number; lat: number; lng: number }[] = [];
  let idx = 1;
  for (let km = 1; km <= Math.floor(total); km++) {
    while (idx < pts.length && pts[idx].d < km) idx++;
    if (idx >= pts.length) break;
    const a = pts[idx - 1];
    const b = pts[idx];
    const span = b.d - a.d;
    const f = span > 0 ? (km - a.d) / span : 0;
    out.push({
      km,
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
    });
  }
  return out;
}

/** Linearly interpolated elevation at `d` km on a distance-sorted profile. */
function eleAt(profile: { d: number; e: number }[], d: number): number {
  if (!profile.length) return 0;
  if (d <= profile[0].d) return profile[0].e;
  const last = profile[profile.length - 1];
  if (d >= last.d) return last.e;
  let lo = 0;
  let hi = profile.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = profile[lo];
  const b = profile[hi];
  const span = b.d - a.d;
  return span > 0 ? a.e + ((b.e - a.e) * (d - a.d)) / span : a.e;
}

/**
 * Google-Maps-style one-finger zoom: double-tap, keep the finger down and drag
 * up to zoom in / down to zoom out. A plain double-tap still zooms in. This
 * replaces Leaflet's doubleClickZoom so the two never both fire on touch.
 * Mirrors Leaflet's own TouchZoom handler (private _move/_animateZoom API).
 */
function enableOneFingerZoom(map: L.Map): () => void {
  const el = map.getContainer();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  const PX_PER_ZOOM_LEVEL = 100;
  const DOUBLE_TAP_MS = 300;
  const DOUBLE_TAP_PX = 40;
  const activeTouches = new Set<number>();
  let lastTouchTs = 0;
  let lastTap: { t: number; x: number; y: number } | null = null;
  let down: { id: number; t: number; x: number; y: number } | null = null;
  let gesture: {
    id: number;
    startY: number;
    startZoom: number;
    anchorPt: L.Point;
    anchor: L.LatLng;
    offset: L.Point;
    moved: boolean;
    zoom: number;
    center: L.LatLng;
    raf: number;
  } | null = null;

  const finish = () => {
    const g = gesture;
    gesture = null;
    if (!g) return;
    L.Util.cancelAnimFrame(g.raf);
    if (!g.moved) {
      map.setZoomAround(g.anchorPt, map.getZoom() + 1);
      return;
    }
    if (map.options.zoomAnimation) {
      m._animateZoom(g.center, m._limitZoom(g.zoom), true, map.options.zoomSnap);
    } else {
      m._resetView(g.center, m._limitZoom(g.zoom));
    }
  };

  // Capture phase on the container so the second tap never reaches Leaflet's
  // drag / pinch handlers (which listen on the container in bubble phase).
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    lastTouchTs = Date.now();
    activeTouches.add(e.pointerId);
    if (activeTouches.size > 1) {
      // A second finger means a pinch — let Leaflet handle it.
      down = null;
      lastTap = null;
      if (gesture) finish();
      return;
    }
    const now = Date.now();
    if (
      lastTap &&
      now - lastTap.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX
    ) {
      e.stopPropagation();
      e.preventDefault();
      lastTap = null;
      map.stop();
      const pt = map.mouseEventToContainerPoint(e);
      gesture = {
        id: e.pointerId,
        startY: e.clientY,
        startZoom: map.getZoom(),
        anchorPt: pt,
        anchor: map.containerPointToLatLng(pt),
        offset: pt.subtract(map.getSize().divideBy(2)),
        moved: false,
        zoom: map.getZoom(),
        center: map.getCenter(),
        raf: 0,
      };
      return;
    }
    down = { id: e.pointerId, t: now, x: e.clientX, y: e.clientY };
  };

  const onMove = (e: PointerEvent) => {
    const g = gesture;
    if (!g || e.pointerId !== g.id) return;
    e.preventDefault();
    const dy = g.startY - e.clientY;
    if (!g.moved) {
      if (Math.abs(dy) < 8) return;
      g.moved = true;
      m._moveStart(true, false);
    }
    const zoom = Math.min(
      map.getMaxZoom(),
      Math.max(map.getMinZoom(), g.startZoom + dy / PX_PER_ZOOM_LEVEL),
    );
    const center = map.unproject(map.project(g.anchor, zoom).subtract(g.offset), zoom);
    g.zoom = zoom;
    g.center = center;
    L.Util.cancelAnimFrame(g.raf);
    g.raf = L.Util.requestAnimFrame(() =>
      m._move(center, zoom, { pinch: true, round: false }),
    );
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    activeTouches.delete(e.pointerId);
    if (gesture && e.pointerId === gesture.id) {
      finish();
      return;
    }
    if (down && e.pointerId === down.id) {
      const isTap =
        e.type === 'pointerup' &&
        Date.now() - down.t < 250 &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10;
      lastTap = isTap ? { t: Date.now(), x: e.clientX, y: e.clientY } : null;
      down = null;
    }
  };

  // Mouse double-click keeps zooming in (shift = out); touch is handled above.
  const onDblClick = (e: L.LeafletMouseEvent) => {
    if (Date.now() - lastTouchTs < 1000) return;
    map.setZoomAround(e.containerPoint, map.getZoom() + (e.originalEvent.shiftKey ? -1 : 1));
  };

  map.doubleClickZoom.disable();
  map.on('dblclick', onDblClick);
  el.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  return () => {
    map.off('dblclick', onDblClick);
    el.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
  };
}

/** Parse `<trkpt lat lon><time>` into a time-sorted timeline for photo matching. */
function parseGpxTimeline(text: string): RoutePoint[] {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const pts = Array.from(doc.getElementsByTagName('trkpt'));
    const out: RoutePoint[] = [];
    for (const p of pts) {
      const lat = parseFloat(p.getAttribute('lat') || 'NaN');
      const lon = parseFloat(p.getAttribute('lon') || 'NaN');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const timeNode = p.getElementsByTagName('time')[0];
      if (!timeNode) continue;
      const t = Date.parse(timeNode.textContent || '');
      if (!Number.isFinite(t)) continue;
      out.push({ lat, lng: lon, t });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  } catch {
    return [];
  }
}

/**
 * Given a photo timestamp and all loaded GPX timelines, return the trkpt
 * closest in time across any track — but only if it's within 10 minutes.
 * Returns null otherwise (photo was taken outside the track window).
 */
function findTrackPointByTime(
  timelines: Map<string, RoutePoint[]>,
  takenAtIso: string,
): RoutePoint | null {
  const t = Date.parse(takenAtIso);
  if (!Number.isFinite(t)) return null;
  const MAX_DIFF_MS = 10 * 60 * 1000;
  let best: RoutePoint | null = null;
  let bestDiff = Infinity;
  for (const pts of timelines.values()) {
    if (!pts.length) continue;
    // Binary search for insertion point of `t` in sorted `pts`.
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const candidates = [pts[lo]];
    if (lo > 0) candidates.push(pts[lo - 1]);
    for (const p of candidates) {
      const diff = Math.abs(p.t - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
  }
  if (!best || bestDiff > MAX_DIFF_MS) return null;
  return best;
}

type RouteStats = {
  distanceKm: number;
  elevGain: number;
  elevLoss: number;
  minEle: number;
  maxEle: number;
  /** Sampled cumulative distance (km) + elevation (m) for the mini chart. */
  profile: { d: number; e: number }[];
  /** Full-resolution track for snapping photos / GPS onto the route. */
  track: RouteDistPoint[];
  /** GPX waypoints projected onto the track, sorted by distance. */
  cps: RouteCp[];
};

function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function parseGpxStats(text: string): Omit<RouteStats, 'track' | 'cps'> | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const pts = Array.from(doc.getElementsByTagName('trkpt'));
    if (pts.length < 2) return null;
    let dist = 0;
    let gain = 0;
    let loss = 0;
    let minE = Infinity;
    let maxE = -Infinity;
    const raw: { d: number; e: number }[] = [];
    let prevLatLng: [number, number] | null = null;
    let prevEle: number | null = null;
    for (const p of pts) {
      const lat = parseFloat(p.getAttribute('lat') || 'NaN');
      const lon = parseFloat(p.getAttribute('lon') || 'NaN');
      if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
      const eleNode = p.getElementsByTagName('ele')[0];
      const ele = eleNode ? parseFloat(eleNode.textContent || 'NaN') : NaN;
      if (prevLatLng) dist += haversineKm(prevLatLng, [lat, lon]);
      if (!Number.isNaN(ele)) {
        if (prevEle !== null) {
          const d = ele - prevEle;
          if (d > 0.5) gain += d;
          else if (d < -0.5) loss += -d;
        }
        if (ele < minE) minE = ele;
        if (ele > maxE) maxE = ele;
        prevEle = ele;
        raw.push({ d: dist, e: ele });
      }
      prevLatLng = [lat, lon];
    }
    // Downsample to ~1000 points; the chart thins further to what's visible,
    // so zooming in still shows detail.
    const maxPts = 1000;
    const step = Math.max(1, Math.ceil(raw.length / maxPts));
    const profile: { d: number; e: number }[] = [];
    for (let i = 0; i < raw.length; i += step) profile.push(raw[i]);
    if (raw.length && profile[profile.length - 1] !== raw[raw.length - 1])
      profile.push(raw[raw.length - 1]);
    return {
      distanceKm: dist,
      elevGain: Math.round(gain),
      elevLoss: Math.round(loss),
      minEle: Number.isFinite(minE) ? Math.round(minE) : 0,
      maxEle: Number.isFinite(maxE) ? Math.round(maxE) : 0,
      profile,
    };
  } catch {
    return null;
  }
}

type ChartView = { d0: number; d1: number } | null;

/** Clamp a [start, start+span) window to the route; null = fully zoomed out. */
function clampChartView(
  start: number,
  span: number,
  totalD: number,
  minSpan: number,
): ChartView {
  const s = Math.min(totalD, Math.max(minSpan, span));
  if (s >= totalD - 1e-9) return null;
  const d0 = Math.min(Math.max(0, start), totalD - s);
  return { d0, d1: d0 + s };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function ElevationChart({
  profile,
  color,
  minEle,
  maxEle,
  onDistanceHover,
  cps = [],
  userD = null,
}: {
  profile: { d: number; e: number }[];
  color: string;
  minEle: number;
  maxEle: number;
  onDistanceHover?: (distanceKm: number | null) => void;
  /** Checkpoints drawn as dashed vertical lines. */
  cps?: RouteCp[];
  /** Viewer's GPS position snapped onto this route (km), if on the route. */
  userD?: number | null;
}) {
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [view, setView] = useState<ChartView>(null);
  const [plotWidth, setPlotWidth] = useState(300);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  // Active touch/mouse pointers on the chart → clientX, for pinch zoom.
  const pointersRef = useRef<Map<number, number>>(new Map());
  const pinchRef = useRef<{ startGap: number; startSpan: number; anchorD: number } | null>(null);
  const navDragRef = useRef<{ pointerId: number; startX: number; startD0: number } | null>(null);
  const clipId = useId();

  const W = 300;
  const H = 60;
  const pad = 4;
  const totalD = profile[profile.length - 1]?.d || 1;
  const minSpan = Math.min(totalD, Math.max(0.1, totalD / 50));
  const d0 = view?.d0 ?? 0;
  const d1 = view?.d1 ?? totalD;
  const span = Math.max(1e-6, d1 - d0);
  const zoomed = view !== null;

  // Points inside the window (plus one either side so the line reaches the
  // edges), thinned to ~300 for drawing.
  let i0 = 0;
  while (i0 < profile.length - 1 && profile[i0 + 1].d < d0) i0++;
  let i1 = profile.length - 1;
  while (i1 > 0 && profile[i1 - 1].d > d1) i1--;
  const visible = profile.slice(i0, i1 + 1);
  const step = Math.max(1, Math.ceil(visible.length / 300));
  const drawn = visible.filter((_, i) => i % step === 0 || i === visible.length - 1);

  // Zoomed in → fit the elevation axis to the visible stretch for detail.
  let lo = minEle;
  let hi = maxEle;
  if (zoomed) {
    lo = Infinity;
    hi = -Infinity;
    for (const p of visible) {
      if (p.e < lo) lo = p.e;
      if (p.e > hi) hi = p.e;
    }
    lo = Math.floor(lo);
    hi = Math.ceil(hi);
  }
  const range = Math.max(1, hi - lo);
  const eleStep =
    range < 100 ? (range < 40 ? 10 : 25) : Math.ceil(range / 4 / 50) * 50;
  const yStart = Math.floor(lo / eleStep) * eleStep;
  const yEnd = Math.max(yStart + eleStep, Math.ceil(hi / eleStep) * eleStep);
  const yRange = Math.max(1, yEnd - yStart);
  const toX = (d: number) => pad + ((d - d0) / span) * (W - pad * 2);
  const toY = (e: number) => pad + (1 - (e - yStart) / yRange) * (H - pad * 2);
  const xy = drawn.map((p) => [toX(p.d), toY(p.e)] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = xy.length
    ? `${line} L${xy[xy.length - 1][0].toFixed(1)},${H - pad} L${xy[0][0].toFixed(1)},${H - pad} Z`
    : '';
  const xTicks = Array.from({ length: 6 }, (_, i) => d0 + (span / 5) * i);
  const xDecimals = span >= 10 ? 0 : span >= 1 ? 1 : 2;
  const yTicks = Array.from(
    { length: Math.max(2, Math.round(yRange / eleStep) + 1) },
    (_, i) => yStart + eleStep * i,
  );

  // Checkpoints in view; labels that would collide with the previous one are
  // dropped (zooming in reveals them).
  const visibleCps = cps.filter((cp) => cp.d >= d0 && cp.d <= d1);
  const cpMarks: { cp: RouteCp; leftPct: number; showLabel: boolean }[] = [];
  let lastLabelPct: number | null = null;
  for (const cp of visibleCps) {
    const leftPct = (toX(cp.d) / W) * 100;
    const showLabel =
      lastLabelPct === null || ((leftPct - lastLabelPct) / 100) * plotWidth >= 26;
    if (showLabel) lastLabelPct = leftPct;
    cpMarks.push({ cp, leftPct, showLabel });
  }

  const userInView = userD != null && userD >= d0 && userD <= d1;
  const userPoint = userInView
    ? { x: (toX(userD) / W) * 100, y: (toY(eleAt(profile, userD)) / H) * 100 }
    : null;

  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setPlotWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mouse wheel / trackpad: vertical = zoom at cursor, horizontal = pan.
  // Native listener because React's wheel handler is passive.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        setView(clampChartView(d0 + (ev.deltaX / rect.width) * span, span, totalD, minSpan));
        return;
      }
      const ratio = clamp01((ev.clientX - rect.left) / rect.width);
      const anchorD = d0 + ratio * span;
      const next = Math.min(totalD, Math.max(minSpan, span * Math.exp(ev.deltaY * 0.002)));
      setView(clampChartView(anchorD - ratio * next, next, totalD, minSpan));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [d0, span, totalD, minSpan]);

  const clearHover = () => {
    setHoverPoint(null);
    onDistanceHover?.(null);
  };

  const emitDistance = (clientX: number) => {
    const svg = svgRef.current;
    if (!onDistanceHover || !svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = clamp01((clientX - rect.left) / rect.width);
    const distanceKm = d0 + ratio * span;
    setHoverPoint({
      x: (toX(distanceKm) / W) * 100,
      y: (toY(eleAt(profile, distanceKm)) / H) * 100,
    });
    onDistanceHover(distanceKm);
  };

  const pinchState = () => {
    const svg = svgRef.current;
    const [a, b] = Array.from(pointersRef.current.values());
    if (!svg || a === undefined || b === undefined) return null;
    const rect = svg.getBoundingClientRect();
    return {
      gap: Math.max(20, Math.abs(a - b)),
      ratio: clamp01(((a + b) / 2 - rect.left) / rect.width),
    };
  };

  const zoomBy = (factor: number) => {
    const next = Math.min(totalD, Math.max(minSpan, span / factor));
    const mid = d0 + span / 2;
    setView(clampChartView(mid - next / 2, next, totalD, minSpan));
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current) {
      // Stay in pinch mode until every finger is lifted, so the last finger
      // doesn't suddenly start scrubbing.
      if (pointersRef.current.size === 0) pinchRef.current = null;
    } else if (e.type === 'pointerup') {
      emitDistance(e.clientX);
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const navStartDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const nav = navRef.current;
    if (!nav || !zoomed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = nav.getBoundingClientRect();
    const clickD = clamp01((e.clientX - rect.left) / rect.width) * totalD;
    let start = d0;
    // Tap outside the window → jump the window there, then keep dragging.
    if (clickD < d0 || clickD > d1) {
      start = clampChartView(clickD - span / 2, span, totalD, minSpan)?.d0 ?? 0;
      setView(clampChartView(start, span, totalD, minSpan));
    }
    navDragRef.current = { pointerId: e.pointerId, startX: e.clientX, startD0: start };
  };

  const navMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = navDragRef.current;
    const nav = navRef.current;
    if (!drag || !nav || drag.pointerId !== e.pointerId) return;
    const rect = nav.getBoundingClientRect();
    const dd = ((e.clientX - drag.startX) / rect.width) * totalD;
    setView(clampChartView(drag.startD0 + dd, span, totalD, minSpan));
  };

  const navEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (navDragRef.current?.pointerId === e.pointerId) navDragRef.current = null;
  };

  const chartBtn =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#ecedfa] text-[#424656] transition-colors hover:bg-[#e1e2ee] disabled:opacity-40';

  return (
    <div className="relative mt-2 rounded-lg bg-white p-1.5" data-no-panel-drag>
      <div className="relative h-32 pl-10 pb-5 md:h-40 md:pl-12 md:pb-6">
        {/* Y axis labels */}
        <div className="pointer-events-none absolute bottom-5 left-0 top-4 w-10 md:bottom-6 md:w-12">
          {yTicks.map((tick) => (
            <span
              key={tick}
              className="absolute left-0 -translate-y-1/2 text-[8px] font-semibold text-[#737687] md:text-[9px]"
              style={{ top: `${(toY(tick) / H) * 100}%` }}
            >
              {tick} m
            </span>
          ))}
        </div>

        {/* Checkpoint labels */}
        <div className="pointer-events-none absolute left-10 right-0 top-0 h-4 md:left-12">
          {cpMarks
            .filter((m) => m.showLabel)
            .map(({ cp, leftPct }) => (
              <span
                key={`${cp.name}-${cp.d}`}
                title={cp.name}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded bg-[#191b24] px-1 text-[8px] font-bold leading-[13px] text-white md:text-[9px]"
                style={{ left: `${leftPct}%` }}
              >
                {cp.label}
              </span>
            ))}
        </div>

        <div
          ref={plotRef}
          className="absolute bottom-5 left-10 right-0 top-4 md:bottom-6 md:left-12"
        >
          {cpMarks.map(({ cp, leftPct }) => (
            <div
              key={`line-${cp.name}-${cp.d}`}
              className="pointer-events-none absolute bottom-0 top-0 border-l border-dashed border-[#191b24]/55"
              style={{ left: `${leftPct}%` }}
            />
          ))}
          {userPoint && (
            <div
              className="pointer-events-none absolute z-10"
              style={{ left: `${userPoint.x}%`, top: `${userPoint.y}%` }}
            >
              <div className="absolute bottom-2.5 left-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#2563eb] px-1.5 text-[8px] font-bold leading-[14px] text-white shadow md:text-[9px]">
                คุณ · {userD!.toFixed(1)} km
              </div>
              <div className="absolute left-0 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#2563eb] shadow-[0_0_0_3px_rgba(37,99,235,0.3)]" />
            </div>
          )}
          {hoverPoint && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full text-[#004cca] drop-shadow-md"
              style={{ left: `${hoverPoint.x}%`, top: `${hoverPoint.y}%` }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 24, fontVariationSettings: "'FILL' 1" }}
              >
                location_on
              </span>
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            style={{ touchAction: 'none' }}
            aria-label="Elevation profile"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointersRef.current.set(e.pointerId, e.clientX);
              if (pointersRef.current.size >= 2) {
                const s = pinchState();
                if (s) {
                  pinchRef.current = {
                    startGap: s.gap,
                    startSpan: span,
                    anchorD: d0 + s.ratio * span,
                  };
                }
                clearHover();
                return;
              }
              if (!pinchRef.current) emitDistance(e.clientX);
            }}
            onPointerMove={(e) => {
              if (pointersRef.current.has(e.pointerId)) {
                pointersRef.current.set(e.pointerId, e.clientX);
              }
              const pinch = pinchRef.current;
              if (pinch) {
                const s = pinchState();
                if (!s) return;
                const next = Math.min(
                  totalD,
                  Math.max(minSpan, (pinch.startSpan * pinch.startGap) / s.gap),
                );
                setView(
                  clampChartView(pinch.anchorD - s.ratio * next, next, totalD, minSpan),
                );
                return;
              }
              emitDistance(e.clientX);
            }}
            onPointerLeave={clearHover}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={pad} y={0} width={W - pad * 2} height={H} />
              </clipPath>
            </defs>
            {xTicks.map((tick) => {
              const x = toX(tick);
              return (
                <line
                  key={`x-${tick}`}
                  x1={x}
                  y1={pad}
                  x2={x}
                  y2={H - pad}
                  stroke="#c2c6d9"
                  strokeWidth={0.35}
                  opacity={0.6}
                />
              );
            })}
            {yTicks.map((tick) => {
              const y = toY(tick);
              return (
                <line
                  key={`y-${tick}`}
                  x1={pad}
                  y1={y}
                  x2={W - pad}
                  y2={y}
                  stroke="#c2c6d9"
                  strokeWidth={0.35}
                  opacity={0.6}
                />
              );
            })}
            <g clipPath={`url(#${clipId})`}>
              <path d={area} fill={color} opacity={0.18} />
              <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          </svg>
        </div>
        <div className="absolute bottom-0 left-10 right-0 flex justify-between text-[9px] font-bold text-[#424656] md:left-12 md:text-[9px] md:text-[#737687]">
          {xTicks.map((tick) => (
            <span key={tick}>{tick.toFixed(xDecimals)} km</span>
          ))}
        </div>
      </div>

      {/* Zoom controls + overview bar (drag the window to pan when zoomed) */}
      <div className="mt-1 flex items-center gap-1.5 pl-10 md:pl-12">
        <div
          ref={navRef}
          onPointerDown={navStartDrag}
          onPointerMove={navMove}
          onPointerUp={navEnd}
          onPointerCancel={navEnd}
          className={`relative h-3 flex-1 rounded-full bg-[#ecedfa] ${zoomed ? 'cursor-grab' : ''}`}
          style={{ touchAction: 'none' }}
          aria-label="Visible range"
        >
          {cps.map((cp) => (
            <span
              key={`nav-${cp.name}-${cp.d}`}
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-[#191b24]/30"
              style={{ left: `${(cp.d / totalD) * 100}%` }}
            />
          ))}
          <div
            className="pointer-events-none absolute bottom-0 top-0 rounded-full border border-[#004cca]/50 bg-[#004cca]/20"
            style={{ left: `${(d0 / totalD) * 100}%`, width: `${(span / totalD) * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => zoomBy(0.5)}
          disabled={!zoomed}
          aria-label="Zoom out chart"
          className={chartBtn}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>remove</span>
        </button>
        <button
          type="button"
          onClick={() => zoomBy(2)}
          disabled={span <= minSpan + 1e-9}
          aria-label="Zoom in chart"
          className={chartBtn}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
        </button>
        {zoomed && (
          <button
            type="button"
            onClick={() => setView(null)}
            aria-label="Reset chart zoom"
            title="ดูทั้งเส้นทาง"
            className={chartBtn}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>zoom_out_map</span>
          </button>
        )}
      </div>
    </div>
  );
}

type PhotoRouteMatch = {
  route: RouteDoc;
  stats: RouteStats;
  d: number;
  offM: number;
  prevCp: RouteCp | null;
  nextCp: RouteCp | null;
};

/** Find the route a photo sits on (nearest track) and where along it. */
function matchPhotoToRoute(
  lat: number,
  lng: number,
  routes: RouteDoc[],
  routeStats: Record<string, RouteStats>,
): PhotoRouteMatch | null {
  let best: PhotoRouteMatch | null = null;
  for (const route of routes) {
    const stats = routeStats[route._id];
    if (!stats) continue;
    const loc = locateOnRoute(stats.track, lat, lng);
    if (!loc || (best && loc.offM >= best.offM)) continue;
    const prevCp = [...stats.cps].reverse().find((cp) => cp.d <= loc.d) ?? null;
    const nextCp = stats.cps.find((cp) => cp.d > loc.d) ?? null;
    best = { route, stats, d: loc.d, offM: loc.offM, prevCp, nextCp };
  }
  return best;
}

/** Small non-interactive map: the whole route plus a dot where the photo is. */
function PhotoRouteMiniMap({
  track,
  color,
  lat,
  lng,
}: {
  track: RouteDistPoint[] | null;
  color: string;
  lat: number;
  lng: number;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);
    groupRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const here = L.latLng(lat, lng);
    if (track && track.length > 1) {
      // Tracks can have tens of thousands of points; ~2000 is plenty at this size.
      const step = Math.max(1, Math.ceil(track.length / 2000));
      const thinned = track.filter((_, i) => i % step === 0 || i === track.length - 1);
      const routeLine = L.polyline(
        thinned.map((p) => [p.lat, p.lng] as [number, number]),
        { color, weight: 3, opacity: 0.9, interactive: false },
      ).addTo(group);
      map.fitBounds(routeLine.getBounds().extend(here), {
        padding: [8, 8],
        animate: false,
      });
    } else {
      map.setView(here, 15, { animate: false });
    }
    L.circleMarker(here, {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: '#004cca',
      fillOpacity: 1,
      interactive: false,
    }).addTo(group);
  }, [track, color, lat, lng]);

  return <div ref={elRef} className="h-full w-full" />;
}

/** Where the user dragged the left toolbar to (per device). */
const TOOLBAR_POS_KEY = 'map:toolbarPos';
/** Keep the toolbar below the fixed header. */
const TOOLBAR_MIN_TOP = 56;

function readToolbarPos(): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(TOOLBAR_POS_KEY) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
}

const TRACK_COLORS = [
  '#ff4d4d',
  '#33cc33',
  '#3399ff',
  '#ff9933',
  '#cc33ff',
  '#00cccc',
  '#ff3399',
];

export default function MapClient({ slug, role }: { slug: string; role: EventRole }) {
  const canUploadPhoto = role === 'admin' || role === 'upload';
  const canUploadRoute = role === 'admin';
  const canDelete = role === 'admin';
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<MarkerClusterGroup | null>(null);
  const photoMarkersRef = useRef<Map<string, AnyMarker>>(new Map());
  const routeLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const routeTimelinesRef = useRef<Map<string, RoutePoint[]>>(new Map());
  const routeDistPointsRef = useRef<Map<string, RouteDistPoint[]>>(new Map());
  const kmMarkersLayerRef = useRef<L.LayerGroup | null>(null);
  const chartHoverMarkerRef = useRef<L.Marker | null>(null);
  // Left toolbar can be dragged out of the way; null = default position.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const toolbarDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    last: { x: number; y: number } | null;
  } | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ x: number; y: number } | null>(readToolbarPos);
  const hasToolbarPos = toolbarPos !== null;
  // Pull the toolbar back on-screen when the window shrinks / rotates.
  useEffect(() => {
    if (!hasToolbarPos) return;
    const clamp = () => {
      const r = toolbarRef.current?.getBoundingClientRect();
      if (!r) return;
      setToolbarPos((p) =>
        p && {
          x: Math.min(Math.max(0, p.x), window.innerWidth - r.width),
          y: Math.min(Math.max(TOOLBAR_MIN_TOP, p.y), window.innerHeight - r.height),
        },
      );
    };
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [hasToolbarPos]);
  const statsPanelDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
  } | null>(null);

  const [event, setEvent] = useState<EventDoc | null>(null);
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [routes, setRoutes] = useState<RouteDoc[]>([]);
  const [routeStats, setRouteStats] = useState<Record<string, RouteStats>>({});
  const [markerSize] = useState(45);
  const [activeStatsRouteId, setActiveStatsRouteId] = useState<string | null>(
    null,
  );
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  const [statsPanelPos, setStatsPanelPos] = useState<{
    x: number;
    y: number;
    width: number;
  } | null>(null);
  // Ensure the overlay opens expanded whenever the user picks a new track.
  useEffect(() => {
    setStatsCollapsed(false);
    setTrackPickerOpen(false);
    setStatsPanelPos(null);
  }, [activeStatsRouteId]);
  // Mirror of activeStatsRouteId for async callbacks (GPX 'loaded' events).
  const activeStatsRouteIdRef = useRef<string | null>(null);
  // Raise the selected track's polyline above every other track so its colour
  // is visible where routes overlap.
  const bringActiveRouteToFront = useCallback(() => {
    const id = activeStatsRouteIdRef.current;
    if (!id) return;
    const layer = routeLayersRef.current.get(id) as
      | (L.Layer & { bringToFront?: () => void })
      | undefined;
    try {
      layer?.bringToFront?.();
    } catch {
      /* no-op */
    }
  }, []);
  useEffect(() => {
    activeStatsRouteIdRef.current = activeStatsRouteId;
    bringActiveRouteToFront();
  }, [activeStatsRouteId, bringActiveRouteToFront]);
  const [loading, setLoading] = useState<string | null>('Loading event…');
  const [error, setError] = useState<string | null>(null);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number>(-1);
  const [locating, setLocating] = useState(false);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [toast, setToast] = useState<string | null>(null);
  const [uploadStats, setUploadStats] = useState<{
    total: number;
    done: number;
    gpsFound: number;
  } | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userAccuracyRef = useRef<L.Circle | null>(null);
  const userWatchIdRef = useRef<number | null>(null);
  const userCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // Same as userCoordsRef but as state, so the elevation chart can show it.
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const focusMarkerRef = useRef<L.Marker | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Compass heading support for the "you are here" marker.
  const headingConeRef = useRef<HTMLElement | null>(null);
  const headingCleanupRef = useRef<(() => void) | null>(null);
  const headingLastTsRef = useRef(0);
  const hasCompassRef = useRef(false);
  const mapLayersRef = useRef<{
    street: L.TileLayer;
    satellite: L.TileLayer;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Map init ----
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    // Fix default marker icon URLs (leaflet-gpx uses them even when we null out start/end)
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
      ._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl:
        'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    const map = L.map(mapElRef.current, { zoomControl: false }).setView(
      [13.7367, 100.5231],
      6,
    );
    const streetLayer = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '&copy; OpenStreetMap', maxZoom: 19 },
    );
    const satelliteLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri', maxZoom: 18 },
    );
    streetLayer.addTo(map);
    mapLayersRef.current = { street: streetLayer, satellite: satelliteLayer };

    const cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      iconCreateFunction: (c) => {
        const children = c.getAllChildMarkers() as AnyMarker[];
        const imgUrl = children[children.length - 1]?.options?.imgUrl ?? '';
        return L.divIcon({
          html: `<div class="photo-marker-wrapper"><div class="photo-marker" style="background-image:url('${imgUrl}')"></div><div class="cluster-count">${c.getChildCount()}</div></div>`,
          className: 'custom-cluster-icon',
          iconSize: L.point(45, 45),
        });
      },
    });
    map.addLayer(cluster);

    mapRef.current = map;
    clusterRef.current = cluster;
    const disableOneFingerZoom = enableOneFingerZoom(map);

    return () => {
      disableOneFingerZoom();
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // ---- Marker size reactivity ----
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--marker-size',
      `${markerSize}px`,
    );
  }, [markerSize]);

  const updateChartHoverMarker = useCallback(
    (routeId: string, distanceKm: number | null) => {
      const map = mapRef.current;
      if (!map) return;
      if (distanceKm === null) {
        if (chartHoverMarkerRef.current) {
          map.removeLayer(chartHoverMarkerRef.current);
          chartHoverMarkerRef.current = null;
        }
        return;
      }
      const pts = routeDistPointsRef.current.get(routeId);
      if (!pts || pts.length < 2) return;
      const p = pointAtDistance(pts, distanceKm);
      if (!p) return;
      if (!chartHoverMarkerRef.current) {
        const icon = L.divIcon({
          className: '',
          html: '<div style="display:flex;height:32px;width:32px;align-items:center;justify-content:center;border-radius:9999px;background:#004cca;color:white;box-shadow:0 10px 18px rgba(0,0,0,.24);border:2px solid white;"><span class="material-symbols-outlined" style="font-size:20px;font-variation-settings:\'FILL\' 1">location_on</span></div>',
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        });
        chartHoverMarkerRef.current = L.marker([p.lat, p.lng], {
          icon,
          interactive: false,
          zIndexOffset: 2000,
        }).addTo(map);
      } else {
        chartHoverMarkerRef.current.setLatLng([p.lat, p.lng]);
      }
    },
    [],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !chartHoverMarkerRef.current) return;
    map.removeLayer(chartHoverMarkerRef.current);
    chartHoverMarkerRef.current = null;
  }, [activeStatsRouteId]);

  // ---- Photo helpers ----
  const addPhoto = useCallback((p: PhotoDoc) => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    if (photoMarkersRef.current.has(p._id)) return;

    const icon = L.divIcon({
      html: `<div class="photo-marker-wrapper"><div class="photo-marker" data-id="${p._id}" style="background-image:url('${p.url}')"></div></div>`,
      className: '',
      iconSize: [45, 45],
      iconAnchor: [22, 22],
    });
    const marker = L.marker([p.lat, p.lng], {
      icon,
      // @ts-expect-error - stash custom field for cluster icon to read
      imgUrl: p.url,
    }) as AnyMarker;
    marker._photoId = p._id;
    marker.on('click', () => {
      setLightboxIdx((prevIdx) => {
        // Re-find index at click time using latest photos via functional update:
        // but since we use state, better to resolve it in click handler below.
        return prevIdx;
      });
      // Find index in the *current* photos state:
      setPhotos((cur) => {
        const idx = cur.findIndex((x) => x._id === p._id);
        if (idx >= 0) setLightboxIdx(idx);
        return cur;
      });
    });
    cluster.addLayer(marker);
    photoMarkersRef.current.set(p._id, marker);
  }, []);

  const removePhotoMarker = useCallback((id: string) => {
    const m = photoMarkersRef.current.get(id);
    if (m && clusterRef.current) clusterRef.current.removeLayer(m);
    photoMarkersRef.current.delete(id);
  }, []);

  // ---- Route helpers ----
  const addRoute = useCallback(async (r: RouteDoc, fitRoute = true) => {
    const map = mapRef.current;
    if (!map) return;
    if (routeLayersRef.current.has(r._id)) return;
    try {
      const res = await fetch(r.url);
      const text = await res.text();
      const timeline = parseGpxTimeline(text);
      if (timeline.length) routeTimelinesRef.current.set(r._id, timeline);
      const distPts = parseGpxDistPoints(text);
      if (distPts.length) routeDistPointsRef.current.set(r._id, distPts);
      const stats = parseGpxStats(text);
      if (stats) {
        const cps = checkpointsOnRoute(distPts, parseGpxWaypoints(text));
        setRouteStats((cur) => ({
          ...cur,
          [r._id]: { ...stats, track: distPts, cps },
        }));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const GPX = (L as any).GPX as new (
        data: string,
        options: unknown,
      ) => L.Layer & { on: (ev: string, fn: (e: unknown) => void) => L.Layer };
      const layer = new GPX(text, {
        async: true,
        marker_options: { startIconUrl: null, endIconUrl: null, shadowUrl: null },
        polyline_options: { color: r.color, opacity: 0.85, weight: 4 },
      }).on('loaded', (e) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = (e as any).target;
          if (fitRoute && map && target?.getBounds) map.fitBounds(target.getBounds());
        } catch {
          /* no-op */
        }
        bringActiveRouteToFront();
      });
      (layer as L.Layer).addTo(map);
      routeLayersRef.current.set(r._id, layer);
    } catch (err) {
      console.warn('Failed to load GPX', r.name, err);
    }
  }, [bringActiveRouteToFront]);

  // Draw numbered km markers along the currently active track. Cleared when
  // the user toggles SHOW KM off or switches to a different track.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (kmMarkersLayerRef.current) {
      map.removeLayer(kmMarkersLayerRef.current);
      kmMarkersLayerRef.current = null;
    }
    if (!activeStatsRouteId) return;
    const pts = routeDistPointsRef.current.get(activeStatsRouteId);
    if (!pts || pts.length < 2) return;
    const route = routes.find((x) => x._id === activeStatsRouteId);
    const color = route?.color ?? '#004cca';
    const marks = kilometerMarkers(pts);
    if (!marks.length) return;
    const group = L.layerGroup();
    for (const m of marks) {
      const icon = L.divIcon({
        className: 'km-marker',
        html:
          `<div style="display:flex;align-items:center;justify-content:center;` +
          `width:22px;height:22px;border-radius:11px;` +
          `background:${color};color:#fff;` +
          `font:700 10px/1 'Space Grotesk',Inter,sans-serif;` +
          `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);">${m.km}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      L.marker([m.lat, m.lng], {
        icon,
        interactive: false,
        keyboard: false,
      }).addTo(group);
    }
    group.addTo(map);
    kmMarkersLayerRef.current = group;
  }, [activeStatsRouteId, routes]);

  const removeRouteLayer = useCallback((id: string) => {
    const map = mapRef.current;
    const layer = routeLayersRef.current.get(id);
    if (layer && map) map.removeLayer(layer);
    routeLayersRef.current.delete(id);
    routeTimelinesRef.current.delete(id);
    routeDistPointsRef.current.delete(id);
    setRouteStats((cur) => {
      if (!(id in cur)) return cur;
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }, []);

  // ---- Initial data load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading('Loading event…');
        const [ev, ps, rs] = await Promise.all([
          api.getEvent(slug),
          api.listPhotos(slug),
          api.listRoutes(slug),
        ]);
        if (cancelled) return;
        setEvent(ev);
        setPhotos(ps);
        setRoutes(rs);
        if (rs.length) setActiveStatsRouteId(rs[0]._id);
        ps.forEach(addPhoto);
        rs.forEach((r, idx) => void addRoute(r, idx === 0));
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, addPhoto, addRoute]);

  // ---- Realtime sync ----
  useEffect(() => {
    const socket = getSocket();
    const leave = joinEvent(slug);

    const onPhotoCreated = (p: PhotoDoc) => {
      setPhotos((cur) => (cur.find((x) => x._id === p._id) ? cur : [...cur, p]));
      addPhoto(p);
    };
    const onPhotoDeleted = ({ id }: { id: string }) => {
      setPhotos((cur) => cur.filter((x) => x._id !== id));
      removePhotoMarker(id);
    };
    const onRouteCreated = (r: RouteDoc) => {
      setRoutes((cur) => {
        if (cur.find((x) => x._id === r._id)) return cur;
        if (!cur.length) setActiveStatsRouteId(r._id);
        return [...cur, r];
      });
      void addRoute(r);
    };
    const onRouteDeleted = ({ id }: { id: string }) => {
      setRoutes((cur) => cur.filter((x) => x._id !== id));
      removeRouteLayer(id);
    };

    socket.on('photo:created', onPhotoCreated);
    socket.on('photo:deleted', onPhotoDeleted);
    socket.on('route:created', onRouteCreated);
    socket.on('route:deleted', onRouteDeleted);
    return () => {
      socket.off('photo:created', onPhotoCreated);
      socket.off('photo:deleted', onPhotoDeleted);
      socket.off('route:created', onRouteCreated);
      socket.off('route:deleted', onRouteDeleted);
      leave();
    };
  }, [slug, addPhoto, addRoute, removePhotoMarker, removeRouteLayer]);

  // ---- Uploads ----
  const getFallbackCoords = async (): Promise<{
    lat: number;
    lng: number;
    source: string;
  } | null> => {
    const ok = (n: unknown): n is number => Number.isFinite(n);
    if (
      userCoordsRef.current &&
      ok(userCoordsRef.current.lat) &&
      ok(userCoordsRef.current.lng)
    ) {
      return { ...userCoordsRef.current, source: 'current location' };
    }
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        // iOS Safari sometimes silently hangs getCurrentPosition when location
        // permission is denied/blocked (the `timeout` option doesn't fire). Race
        // against our own timer so the upload flow never stalls here.
        const geo = new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 5000,
            maximumAge: 60000,
          });
        });
        const hardTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('geolocation hard timeout')), 6000),
        );
        const pos = await Promise.race([geo, hardTimeout]);
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        if (ok(coords.lat) && ok(coords.lng)) {
          userCoordsRef.current = coords;
          return { ...coords, source: 'current location' };
        }
      } catch {
        /* fall through to map center */
      }
    }
    const c = mapRef.current?.getCenter();
    if (c && ok(c.lat) && ok(c.lng))
      return { lat: c.lat, lng: c.lng, source: 'map center' };
    return null;
  };

  const onUploadPhotos = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    const total = list.length;
    let added = 0;
    let skipped = 0;
    let fallbackUsed = 0;
    let fallbackSource = '';
    let processed = 0;
    const failures: { name: string; reason: string }[] = [];

    const yieldToUi = () =>
      new Promise<void>((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        } else {
          setTimeout(resolve, 0);
        }
      });

    const processOne = async (file: File) => {
      const tag = `[upload:${file.name}]`;
      try {
        console.log(tag, 'start', { size: file.size, type: file.type });
        setLoading(`Reading EXIF ${processed + 1}/${total}…`);
        const gpsT0 = Date.now();
        let gps = await extractGps(file);
        console.log(tag, 'exif done in', Date.now() - gpsT0, 'ms, gps=', gps);

        setLoading(`Preparing ${processed + 1}/${total}…`);
        const prepT0 = Date.now();
        const prepared = await processForUpload(file);
        console.log(tag, 'prepared in', Date.now() - prepT0, 'ms, size=', prepared.blob.size);

        if (!gps) {
          // Before falling back to device location, try to match the photo's
          // capture time against the loaded GPX tracks. Onroyd/Garmin exports
          // usually strip GPS EXIF but keep DateTimeOriginal, so if the user
          // also uploaded the corresponding .gpx we can place the photo on
          // the actual track point they were at.
          setLoading(`Matching time ${processed + 1}/${total}…`);
          const takenAt = await extractTakenAt(file);
          const matched = takenAt
            ? findTrackPointByTime(routeTimelinesRef.current, takenAt)
            : null;
          if (matched) {
            gps = { lat: matched.lat, lng: matched.lng, takenAt: takenAt ?? undefined };
            fallbackUsed++;
            fallbackSource = 'GPX track (เวลาตรงกัน)';
            console.log(tag, 'matched to GPX track at', new Date(matched.t).toISOString());
          } else {
            setLoading(`Locating ${processed + 1}/${total}…`);
            const fb = await getFallbackCoords();
            if (!fb) {
              failures.push({ name: file.name, reason: 'no GPS and no fallback location' });
              skipped++;
              return;
            }
            gps = { lat: fb.lat, lng: fb.lng, takenAt: takenAt ?? undefined };
            fallbackUsed++;
            fallbackSource = fb.source;
            console.log(tag, 'using fallback coords', fb);
          }
        }

        if (!Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) {
          failures.push({
            name: file.name,
            reason: `invalid coords (lat=${gps.lat}, lng=${gps.lng})`,
          });
          skipped++;
          return;
        }

        const outFile = new File([prepared.blob], prepared.filename, {
          type: prepared.mimeType,
        });
        console.log(tag, 'POST starting', outFile.size, 'bytes');
        const uploadT0 = Date.now();
        await api.uploadPhoto(slug, outFile, gps.lat, gps.lng, {
          width: prepared.width,
          height: prepared.height,
          takenAt: gps.takenAt,
          onProgress: (loaded, totalBytes) => {
            const pct = totalBytes ? Math.round((loaded / totalBytes) * 100) : 0;
            setLoading(`Uploading ${processed + 1}/${total} · ${pct}%`);
          },
        });
        console.log(tag, 'POST ok in', Date.now() - uploadT0, 'ms');
        added++;
      } catch (err) {
        const msg =
          err instanceof Error
            ? `${err.name}: ${err.message}`
            : typeof err === 'string'
              ? err
              : JSON.stringify(err);
        console.error('photo upload failed', file?.name, msg, err);
        failures.push({ name: file.name, reason: msg });
        skipped++;
      } finally {
        processed++;
        setLoading(`Processing photo ${processed}/${total}…`);
      }
    };

    // HEIC is now forwarded untouched to the backend, so no WASM contention.
    const CONCURRENCY = 2;
    setLoading(`Processing photo 0/${total}…`);
    setUploadStats({ total, done: 0, gpsFound: 0 });
    try {
      for (let i = 0; i < list.length; i += CONCURRENCY) {
        const batch = list.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((f) => processOne(f)));
        setUploadStats({ total, done: processed, gpsFound: added });
        await yieldToUi();
      }
    } finally {
      setLoading(null);
      // Keep stats briefly visible, then clear
      setTimeout(() => setUploadStats(null), 1200);
    }

    // Success path → silent toast; only use alert() for real errors.
    if (added > 0 && !failures.length) {
      const extra =
        fallbackUsed > 0
          ? ` (${fallbackUsed} ใช้ ${fallbackSource})`
          : '';
      showToast(`อัปโหลดสำเร็จ ${added} รูป${extra}`);
      return;
    }

    const parts: string[] = [];
    if (added > 0) parts.push(`Uploaded ${added} photo(s)`);
    if (fallbackUsed > 0)
      parts.push(`${fallbackUsed} used ${fallbackSource} (no EXIF GPS)`);
    if (skipped > 0) parts.push(`skipped ${skipped}`);
    let message = parts.join(' · ');
    if (failures.length) {
      const sample = failures
        .slice(0, 3)
        .map((f) => `• ${f.name}: ${f.reason}`)
        .join('\n');
      const more = failures.length > 3 ? `\n…and ${failures.length - 3} more` : '';
      message += `\n\nErrors:\n${sample}${more}`;
    }
    if (message) alert(message);
  };

  // ---- Locate me ----
  const setUserLocation = (
    lat: number,
    lng: number,
    accuracy: number | null,
  ) => {
    const map = mapRef.current;
    if (!map) return;
    userCoordsRef.current = { lat, lng };
    setUserPos({ lat, lng });
    if (!userMarkerRef.current) {
      // Dot + a translucent "view cone" that is rotated to the device's
      // compass heading (hidden until a heading is known).
      const icon = L.divIcon({
        html:
          '<div style="position:relative;width:18px;height:18px;">' +
          '<div data-heading-cone style="position:absolute;left:50%;bottom:50%;width:64px;height:72px;' +
          'transform-origin:50% 100%;transform:translateX(-50%) rotate(0deg);opacity:0;' +
          'transition:opacity .4s ease,transform .25s ease-out;pointer-events:none;' +
          'clip-path:polygon(50% 100%,0 0,100% 0);' +
          'background:linear-gradient(to top,rgba(37,99,235,.6),rgba(37,99,235,0));"></div>' +
          '<div style="position:relative;width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid white;box-shadow:0 0 0 2px rgba(37,99,235,0.35),0 2px 6px rgba(0,0,0,0.35);"></div>' +
          '</div>',
        className: '',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      userMarkerRef.current = L.marker([lat, lng], {
        icon,
        zIndexOffset: 1000,
      }).addTo(map);
      headingConeRef.current =
        userMarkerRef.current
          .getElement()
          ?.querySelector<HTMLElement>('[data-heading-cone]') ?? null;
    } else {
      userMarkerRef.current.setLatLng([lat, lng]);
    }
    if (accuracy && accuracy > 0) {
      if (!userAccuracyRef.current) {
        userAccuracyRef.current = L.circle([lat, lng], {
          radius: accuracy,
          color: '#2563eb',
          weight: 1,
          opacity: 0.6,
          fillColor: '#2563eb',
          fillOpacity: 0.08,
        }).addTo(map);
      } else {
        userAccuracyRef.current.setLatLng([lat, lng]);
        userAccuracyRef.current.setRadius(accuracy);
      }
    }
  };

  // Rotate the view cone to `deg` (compass degrees, clockwise from north).
  // Throttled to ~20 updates/s; compass events can arrive at 60 Hz.
  const applyHeading = (deg: number) => {
    if (!Number.isFinite(deg)) return;
    const now = Date.now();
    if (now - headingLastTsRef.current < 50) return;
    headingLastTsRef.current = now;
    const el = headingConeRef.current;
    if (!el) return;
    const norm = ((deg % 360) + 360) % 360;
    el.style.transform = `translateX(-50%) rotate(${norm}deg)`;
    el.style.opacity = '1';
  };

  // Subscribe to the device compass. iOS needs an explicit permission
  // request that must be triggered from a user gesture, so this is called
  // synchronously from the locate button handler.
  const startHeadingWatch = () => {
    if (headingCleanupRef.current) return;
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;

    const screenAngle = () => {
      const o = window.screen?.orientation;
      if (o && typeof o.angle === 'number') return o.angle;
      const legacy = (window as unknown as { orientation?: number }).orientation;
      return typeof legacy === 'number' ? legacy : 0;
    };

    const onOrientation = (ev: DeviceOrientationEvent) => {
      const webkit = (ev as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      let heading: number | null = null;
      if (typeof webkit === 'number' && Number.isFinite(webkit)) {
        // iOS: already a compass heading.
        heading = webkit;
      } else if (ev.absolute && typeof ev.alpha === 'number') {
        // Android (absolute orientation): alpha is counter-clockwise from north.
        heading = 360 - ev.alpha;
      }
      if (heading == null) return;
      hasCompassRef.current = true;
      applyHeading(heading + screenAngle());
    };

    const subscribe = () => {
      const absName = 'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation';
      window.addEventListener(absName as 'deviceorientation', onOrientation, true);
      headingCleanupRef.current = () => {
        window.removeEventListener(absName as 'deviceorientation', onOrientation, true);
        headingCleanupRef.current = null;
      };
    };

    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DOE.requestPermission === 'function') {
      DOE.requestPermission()
        .then((state) => {
          if (state === 'granted') subscribe();
        })
        .catch(() => {
          /* user declined – cone stays hidden */
        });
    } else {
      subscribe();
    }
  };

  const onLocateMe = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported on this device.');
      return;
    }
    setLocating(true);
    startHeadingWatch();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setUserLocation(latitude, longitude, accuracy);
        mapRef.current?.setView([latitude, longitude], 17);
        setLocating(false);
        if (userWatchIdRef.current == null && navigator.geolocation) {
          userWatchIdRef.current = navigator.geolocation.watchPosition(
            (p) => {
              setUserLocation(
                p.coords.latitude,
                p.coords.longitude,
                p.coords.accuracy,
              );
              // No compass available: fall back to GPS course while moving.
              if (
                !hasCompassRef.current &&
                typeof p.coords.heading === 'number' &&
                Number.isFinite(p.coords.heading)
              ) {
                applyHeading(p.coords.heading);
              }
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
          );
        }
      },
      (err) => {
        setLocating(false);
        alert(`Could not get your location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  // Cleanup watch on unmount
  useEffect(() => {
    return () => {
      if (userWatchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(userWatchIdRef.current);
        userWatchIdRef.current = null;
      }
      headingCleanupRef.current?.();
    };
  }, []);

  const onUploadGpx = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      setLoading(`Uploading route ${i + 1}/${list.length}…`);
      try {
        const f = list[i];
        const color = TRACK_COLORS[(routes.length + i) % TRACK_COLORS.length];
        await api.uploadRoute(slug, f, f.name.replace(/\.gpx$/i, ''), color);
      } catch (err) {
        console.error(err);
        alert(`Failed to upload ${list[i].name}: ${(err as Error).message}`);
      }
    }
    setLoading(null);
  };

  const onDeletePhoto = async (id: string) => {
    try {
      await api.deletePhoto(id, slug);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const onDeleteRoute = async (id: string) => {
    if (!confirm('Delete this route?')) return;
    try {
      await api.deleteRoute(id, slug);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // ---- Map style toggle ----
  const showToast = (msg: string, duration = 2500) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), duration);
  };

  const toggleMapStyle = () => {
    const map = mapRef.current;
    const layers = mapLayersRef.current;
    if (!map || !layers) return;
    if (mapStyle === 'street') {
      map.removeLayer(layers.street);
      layers.satellite.addTo(map);
      setMapStyle('satellite');
      showToast('Satellite View');
    } else {
      map.removeLayer(layers.satellite);
      layers.street.addTo(map);
      setMapStyle('street');
      showToast('Street Map View');
    }
  };

  // Close the photo viewer and centre the main map on the photo, switching the
  // stats panel to the route it was taken on. A short pulse marks the spot.
  const flyToPhoto = (p: PhotoDoc, routeId: string | null) => {
    setLightboxIdx(-1);
    if (routeId) setActiveStatsRouteId(routeId);
    const map = mapRef.current;
    if (!map) return;
    map.setView([p.lat, p.lng], 18);
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusMarkerRef.current?.remove();
    focusMarkerRef.current = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div class="focus-pulse"></div>',
        iconSize: [64, 64],
        iconAnchor: [32, 32],
      }),
      interactive: false,
      zIndexOffset: 1500,
    }).addTo(map);
    focusTimerRef.current = setTimeout(() => {
      focusMarkerRef.current?.remove();
      focusMarkerRef.current = null;
    }, 3000);
  };

  // ---- Swipe on lightbox ----
  const touchStartX = useRef(0);
  const onLightboxTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0].screenX;
  };
  const onLightboxTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].screenX - touchStartX.current;
    if (dx < -40) setLightboxIdx((i) => (i < photos.length - 1 ? i + 1 : i));
    else if (dx > 40) setLightboxIdx((i) => (i > 0 ? i - 1 : i));
  };

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lightboxIdx >= 0) {
        if (e.key === 'ArrowRight')
          setLightboxIdx((i) => (i < photos.length - 1 ? i + 1 : i));
        else if (e.key === 'ArrowLeft')
          setLightboxIdx((i) => (i > 0 ? i - 1 : i));
        else if (e.key === 'Escape') setLightboxIdx(-1);
        return;
      }
      if (e.key === 'Escape') {
        if (albumOpen) setAlbumOpen(false);
        if (routesOpen) setRoutesOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIdx, photos.length, albumOpen, routesOpen]);

  // ---- UI ----
  const currentPhoto =
    lightboxIdx >= 0 && lightboxIdx < photos.length ? photos[lightboxIdx] : null;
  const photoMatch = currentPhoto
    ? matchPhotoToRoute(currentPhoto.lat, currentPhoto.lng, routes, routeStats)
    : null;
  // Further than this from every track → treat the photo as "not on the route".
  const photoOnRoute = photoMatch && photoMatch.offM <= 1000 ? photoMatch : null;
  const activeStats = activeStatsRouteId ? routeStats[activeStatsRouteId] : undefined;
  const userRouteD = useMemo(() => {
    if (!userPos || !activeStats) return null;
    const loc = locateOnRoute(activeStats.track, userPos.lat, userPos.lng);
    return loc && loc.offM <= 500 ? loc.d : null;
  }, [userPos, activeStats]);
  const headlineFont = {
    fontFamily: 'var(--font-headline), Space Grotesk, sans-serif',
  };
  const uploadPct = uploadStats
    ? Math.round((uploadStats.done / Math.max(uploadStats.total, 1)) * 100)
    : 0;
  const pendingInQueue = uploadStats
    ? uploadStats.total - uploadStats.done
    : 0;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#faf8ff] text-[#191b24]">
      <div ref={mapElRef} className="absolute inset-0 z-0" />

      {/* ============== HEADER ============== */}
      <header className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between border-b border-[#c2c6d9]/30 bg-[#faf8ff]/88 px-3 py-2 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            title="Back to events"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#424656] transition-colors hover:bg-[#ecedfa]"
          >
            <span className="material-symbols-outlined text-lg">arrow_back</span>
          </Link>
          <div className="flex min-w-0 items-center gap-1.5">
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md shadow-sm kinetic-gradient"
            >
              <span
                className="material-symbols-outlined text-white"
                style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}
              >
                explore
              </span>
            </div>
            <h1
              className="truncate text-sm font-black uppercase tracking-tighter text-[#004cca]"
              style={headlineFont}
              title={event?.name ?? slug}
            >
              {event?.name ?? slug}
            </h1>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          <div className="hidden items-center gap-1.5 rounded-full border border-[#c2c6d9]/40 bg-[#f2f3ff] px-2.5 py-1 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            <span
              className="text-[9px] font-bold uppercase tracking-widest text-[#004cca]"
              style={headlineFont}
            >
              Live
            </span>
          </div>
          <button
            onClick={onLocateMe}
            disabled={locating}
            aria-label="Locate me"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#c2c6d9]/40 bg-[#f2f3ff] transition-colors hover:border-[#004cca]/30 hover:bg-[#004cca]/10 disabled:opacity-60"
          >
            <span
              className="material-symbols-outlined text-[#004cca]"
              style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
            >
              my_location
            </span>
          </button>
          <button
            onClick={toggleMapStyle}
            aria-label="Toggle map style"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#c2c6d9]/40 bg-[#f2f3ff] transition-colors hover:bg-[#ecedfa]"
          >
            <span
              className="material-symbols-outlined text-[#424656]"
              style={{ fontSize: 18 }}
            >
              {mapStyle === 'street' ? 'layers' : 'map'}
            </span>
          </button>
        </div>
      </header>

      {/* ============== TOAST ============== */}
      {toast && (
        <div
          className="pointer-events-none fixed left-1/2 top-16 z-[3500] -translate-x-1/2 rounded-full bg-[#191b24]/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-md"
          style={{ fontFamily: 'Inter, sans-serif' }}
        >
          {toast}
        </div>
      )}

      {/* ============== ACTIVE TRACK STATS OVERLAY ============== */}
      {(() => {
        if (!activeStatsRouteId) return null;
        const r = routes.find((x) => x._id === activeStatsRouteId);
        const st = r ? routeStats[r._id] : null;
        if (!r || !st) return null;
        const isDesktop =
          typeof window !== 'undefined' && window.innerWidth >= 768;
        const mobileBottomStyle = isDesktop
          ? { bottom: 0 }
          : { bottom: 0 };
        const collapsedButtonStyle = isDesktop
          ? { bottom: 12 }
          : { bottom: 12 };
        const desktopPanelStyle = statsPanelPos
          ? {
              left: `${statsPanelPos.x}px`,
              top: `${statsPanelPos.y}px`,
              right: 'auto',
              bottom: 'auto',
              width: `${statsPanelPos.width}px`,
            }
          : undefined;

        // Collapsed → just a floating chevron-up button to re-expand.
        // Mobile: bottom-right above the panel. Desktop: top-left under the header.
        if (statsCollapsed) {
          return (
            <button
              onClick={() => setStatsCollapsed(false)}
              aria-label="Expand track stats"
              className="pointer-events-auto fixed right-3 z-[999] flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-[#faf8ff]/95 shadow-xl backdrop-blur-xl transition-transform active:scale-95 md:left-3 md:right-auto"
              style={collapsedButtonStyle}
            >
              <span
                className="material-symbols-outlined text-[#004cca]"
                style={{ fontSize: 26, fontVariationSettings: "'FILL' 1" }}
              >
                keyboard_double_arrow_up
              </span>
            </button>
          );
        }

        return (
          <div
            className="pointer-events-none fixed left-0 right-0 z-[999] px-0 md:left-0 md:right-0"
            style={{ ...mobileBottomStyle, ...(isDesktop ? desktopPanelStyle : undefined) }}
          >
            <div
              onPointerDown={(e) => {
                if (window.innerWidth < 768) return;
                if ((e.target as HTMLElement).closest('button, svg, input, label, [data-no-panel-drag]')) return;
                const rect = e.currentTarget.getBoundingClientRect();
                statsPanelDragRef.current = {
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  originX: rect.left,
                  originY: rect.top,
                  width: rect.width,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const drag = statsPanelDragRef.current;
                if (!drag || drag.pointerId !== e.pointerId || window.innerWidth < 768) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const maxX = window.innerWidth - rect.width;
                const maxY = window.innerHeight - rect.height;
                setStatsPanelPos({
                  x: Math.min(Math.max(0, drag.originX + e.clientX - drag.startX), maxX),
                  y: Math.min(Math.max(0, drag.originY + e.clientY - drag.startY), maxY),
                  width: drag.width,
                });
              }}
              onPointerUp={(e) => {
                if (statsPanelDragRef.current?.pointerId === e.pointerId) statsPanelDragRef.current = null;
              }}
              onPointerCancel={(e) => {
                if (statsPanelDragRef.current?.pointerId === e.pointerId) statsPanelDragRef.current = null;
              }}
              className="pointer-events-auto relative mx-0 max-w-none rounded-t-2xl border border-x-0 border-b-0 border-[#c2c6d9]/30 bg-[#faf8ff]/95 p-3 shadow-xl backdrop-blur-xl md:cursor-move md:rounded-none md:p-4"
            >
              <div className="mb-2 flex items-center gap-2 overflow-x-auto md:gap-3">
                <div
                  className="flex shrink-0 items-baseline gap-1 text-[#191b24]"
                  style={headlineFont}
                >
                  <span className="text-2xl font-bold leading-none md:text-xl">
                    {st.distanceKm.toFixed(1)}
                  </span>
                  <span className="text-sm font-bold text-[#737687]">km</span>
                </div>
                <div
                  className="hidden shrink-0 items-center gap-1 text-[10px] font-semibold text-[#424656] md:flex md:text-[9px]"
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  <span className="text-[#17803d]">↑ {st.elevGain} m gain</span>
                  <span className="text-[#c2c6d9]">·</span>
                  <span className="text-[#ba1a1a]">↓ {st.elevLoss} m loss</span>
                  <span className="text-[#c2c6d9]">·</span>
                  <span>max {st.maxEle} m</span>
                </div>
                <button
                  onClick={() => setTrackPickerOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={trackPickerOpen}
                  className="ml-auto flex min-w-42.5 flex-1 items-center gap-2 rounded-lg bg-[#ecedfa] px-2.5 py-1.5 text-left transition-colors hover:bg-[#e1e2ee] md:min-w-130 md:max-w-180"
                >
                  <span
                    className="material-symbols-outlined shrink-0 text-[#004cca]"
                    style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
                  >
                    monitoring
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: r.color }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#191b24]"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    {r.name}
                  </span>
                  <span
                    className="material-symbols-outlined shrink-0 text-[#424656]"
                    style={{
                      fontSize: 16,
                      transform: trackPickerOpen ? 'rotate(180deg)' : 'none',
                      transition: 'transform 150ms',
                    }}
                  >
                    expand_more
                  </span>
                </button>
                <button
                  onClick={() => {
                    setStatsCollapsed(true);
                    setTrackPickerOpen(false);
                  }}
                  aria-label="Collapse stats"
                  title="ย่อ"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ecedfa] text-[#424656] transition-colors hover:bg-[#e1e2ee]"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    keyboard_arrow_down
                  </span>
                </button>
                <button
                  onClick={() => {
                    setActiveStatsRouteId(null);
                    setTrackPickerOpen(false);
                  }}
                  aria-label="Close stats"
                  title="ปิด"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ecedfa] text-[#424656] transition-colors hover:bg-[#e1e2ee]"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    close
                  </span>
                </button>
              </div>

              <div
                className="mb-2 flex items-center gap-1 text-[10px] font-semibold text-[#424656] md:hidden"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                <span className="text-[#17803d]">↑ {st.elevGain} m gain</span>
                <span className="text-[#c2c6d9]">·</span>
                <span className="text-[#ba1a1a]">↓ {st.elevLoss} m loss</span>
                <span className="text-[#c2c6d9]">·</span>
                <span>max {st.maxEle} m</span>
              </div>

              {/* Track picker dropdown */}
              {trackPickerOpen && (
                <div className="mb-2 max-h-56 overflow-y-auto rounded-xl border border-[#c2c6d9]/40 bg-white shadow-sm">
                  {routes.map((opt) => {
                    const os = routeStats[opt._id];
                    const isSel = opt._id === activeStatsRouteId;
                    return (
                      <button
                        key={opt._id}
                        onClick={() => {
                          setActiveStatsRouteId(opt._id);
                          setTrackPickerOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors ${
                          isSel ? 'bg-[#eaf0ff]' : 'hover:bg-[#f2f3ff]'
                        }`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: opt.color }}
                        />
                        <span
                          className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#191b24]"
                          style={{ fontFamily: 'Inter, sans-serif' }}
                        >
                          {opt.name}
                        </span>
                        {os && (
                          <span
                            className="shrink-0 text-[10px] font-bold text-[#004cca]"
                            style={headlineFont}
                          >
                            {os.distanceKm.toFixed(2)} km
                          </span>
                        )}
                        {isSel && (
                          <span
                            className="material-symbols-outlined shrink-0 text-[#004cca]"
                            style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
                          >
                            check
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {st.profile.length > 2 && (
                <ElevationChart
                  key={r._id}
                  profile={st.profile}
                  color={r.color}
                  minEle={st.minEle}
                  maxEle={st.maxEle}
                  cps={st.cps}
                  userD={userRouteD}
                  onDistanceHover={(distanceKm) =>
                    updateChartHoverMarker(r._id, distanceKm)
                  }
                />
              )}
            </div>
          </div>
        );
      })()}

      {/* ============== BOTTOM PANEL ============== */}
      <div
        ref={toolbarRef}
        className={`fixed z-[1000] w-auto px-0 pb-0 ${
          toolbarPos ? '' : 'left-2 top-14 md:left-3 md:top-1/2 md:-translate-y-1/2'
        }`}
        style={toolbarPos ? { left: toolbarPos.x, top: toolbarPos.y } : undefined}
      >
        <div className="mx-0 w-11 md:w-[76px]">
          {/* Upload progress card */}
          {uploadStats && (
            <div className="mb-2 hidden rounded-xl border border-[#c2c6d9]/30 bg-[#faf8ff]/88 px-3 py-2 backdrop-blur-xl md:hidden">
              <div className="mb-1.5 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className="material-symbols-outlined text-sm text-[#004cca]"
                    style={{ animation: 'spin 1s linear infinite' }}
                  >
                    sync
                  </span>
                  <span className="text-[10px] text-[#424656]">
                    กำลังประมวลผล {uploadStats.total} ภาพ…
                  </span>
                </div>
                <span
                  className="text-xs font-bold text-[#004cca]"
                  style={headlineFont}
                >
                  {uploadPct}%
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-[#e1e2ee]">
                <div
                  className="h-full rounded-full transition-[width] duration-200 ease-out"
                  style={{
                    width: `${uploadPct}%`,
                    background:
                      'linear-gradient(90deg,#004cca,#0062ff)',
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-[9px] text-[#424656]">
                  {uploadStats.done} / {uploadStats.total} ภาพ
                </span>
                <span className="text-[9px] font-semibold text-green-600">
                  {uploadStats.gpsFound} เสร็จแล้ว
                </span>
              </div>
            </div>
          )}

          {/* Main panel */}
          <div className="p-0 md:rounded-2xl md:border md:border-[#c2c6d9]/30 md:bg-[#faf8ff]/88 md:p-2 md:shadow-xl md:backdrop-blur-xl">
            {/* Drag handle: move the toolbar; double-click puts it back */}
            <button
              type="button"
              aria-label="ลากเพื่อย้ายแถบเครื่องมือ"
              title="ลากเพื่อย้าย · ดับเบิลคลิกเพื่อกลับที่เดิม"
              onPointerDown={(e) => {
                const rect = toolbarRef.current?.getBoundingClientRect();
                if (!rect) return;
                toolbarDragRef.current = {
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  originX: rect.left,
                  originY: rect.top,
                  last: null,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const drag = toolbarDragRef.current;
                const rect = toolbarRef.current?.getBoundingClientRect();
                if (!drag || drag.pointerId !== e.pointerId || !rect) return;
                const next = {
                  x: Math.min(Math.max(0, drag.originX + e.clientX - drag.startX), window.innerWidth - rect.width),
                  y: Math.min(
                    Math.max(TOOLBAR_MIN_TOP, drag.originY + e.clientY - drag.startY),
                    window.innerHeight - rect.height,
                  ),
                };
                drag.last = next;
                setToolbarPos(next);
              }}
              onPointerUp={(e) => {
                const drag = toolbarDragRef.current;
                if (drag?.pointerId !== e.pointerId) return;
                toolbarDragRef.current = null;
                if (drag.last) {
                  try {
                    localStorage.setItem(TOOLBAR_POS_KEY, JSON.stringify(drag.last));
                  } catch {
                    /* storage blocked — position lasts for this visit */
                  }
                }
              }}
              onPointerCancel={(e) => {
                if (toolbarDragRef.current?.pointerId === e.pointerId) toolbarDragRef.current = null;
              }}
              onDoubleClick={() => {
                setToolbarPos(null);
                try {
                  localStorage.removeItem(TOOLBAR_POS_KEY);
                } catch {
                  /* storage blocked */
                }
              }}
              className="mx-auto mb-1 flex h-6 w-7 cursor-grab touch-none items-center justify-center rounded-full bg-white text-[#737687] shadow-md active:cursor-grabbing md:mb-1 md:h-5 md:w-full md:rounded-lg md:bg-transparent md:shadow-none md:hover:bg-[#ecedfa]"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }}>
                drag_handle
              </span>
            </button>
            <div className="grid grid-cols-1 gap-1 md:gap-1.5">
              <button
                onClick={onLocateMe}
                disabled={locating}
                aria-label="Locate me"
                className="relative flex flex-col items-center gap-1 rounded-xl bg-transparent p-0.5 transition-all active:scale-95 disabled:opacity-60 md:hidden"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#004cca] shadow-md">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, lineHeight: 1, display: 'block', fontVariationSettings: "'wght' 300" }}
                  >
                    my_location
                  </span>
                </span>
              </button>

              <button
                onClick={toggleMapStyle}
                aria-label="Toggle map style"
                className="relative flex flex-col items-center gap-1 rounded-xl bg-transparent p-0.5 transition-all active:scale-95 md:hidden"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#424656] shadow-md">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, lineHeight: 1, display: 'block', fontVariationSettings: "'wght' 300" }}
                  >
                    {mapStyle === 'street' ? 'layers' : 'map'}
                  </span>
                </span>
              </button>

              {/* GPX Upload */}
              <label className="relative flex cursor-pointer flex-col items-center gap-1 rounded-xl border-0 bg-transparent p-0.5 transition-all active:scale-95 md:border md:border-[#004cca]/20 md:bg-[#004cca]/8 md:p-2.5 md:hover:bg-[#004cca]/15">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#004cca] shadow-md md:h-auto md:w-auto md:bg-transparent md:shadow-none">
                  <span
                    className="material-symbols-outlined md:text-2xl"
                    style={{ fontSize: 18, lineHeight: 1, display: 'block', fontVariationSettings: "'wght' 300" }}
                  >
                    map
                  </span>
                </span>
                <span
                  className="hidden text-[8px] font-bold uppercase tracking-wider text-[#004cca] md:block"
                  style={headlineFont}
                >
                  GPX
                </span>
                <input
                  type="file"
                  accept=".gpx"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void onUploadGpx(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>

              {/* Tracks list */}
              <button
                onClick={() => setRoutesOpen(true)}
                className="relative flex flex-col items-center gap-1 rounded-xl bg-transparent p-0.5 transition-all active:scale-95 md:bg-[#ecedfa] md:p-2.5 md:hover:bg-[#e7e7f4]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#424656] shadow-md md:h-auto md:w-auto md:bg-transparent md:shadow-none">
                  <span
                    className="material-symbols-outlined md:text-2xl"
                    style={{ fontSize: 18, lineHeight: 1, display: 'block', fontVariationSettings: "'wght' 300" }}
                  >
                    route
                  </span>
                </span>
                <span
                  className="hidden text-[8px] font-bold uppercase tracking-wider text-[#424656] md:block"
                  style={headlineFont}
                >
                  Tracks
                </span>
                {routes.length > 0 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#004cca] px-1 text-[9px] font-bold text-white"
                    style={headlineFont}
                  >
                    {routes.length}
                  </span>
                )}
              </button>

              {/* Photo upload */}
              {canUploadPhoto && <label className="relative flex cursor-pointer flex-col items-center gap-1 rounded-xl bg-transparent p-0.5 shadow-none transition-transform active:scale-95 md:bg-[linear-gradient(135deg,#004cca_0%,#0062ff_100%)] md:p-2.5 md:shadow-md">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#004cca] shadow-md md:h-auto md:w-auto md:bg-transparent md:text-white md:shadow-none">
                  <span
                    className="material-symbols-outlined md:text-2xl"
                    style={{ fontSize: 18, lineHeight: 1, display: 'block', fontVariationSettings: "'wght' 300" }}
                  >
                    add_a_photo
                  </span>
                </span>
                <span
                  className="hidden text-[8px] font-bold uppercase tracking-wider text-white md:block"
                  style={headlineFont}
                >
                  Photo
                </span>
                {pendingInQueue > 0 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-yellow-500 px-1 text-[9px] font-bold text-white"
                    style={headlineFont}
                  >
                    {pendingInQueue}
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void onUploadPhotos(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>}

              {/* Album */}
              <button
                onClick={() => setAlbumOpen(true)}
                className="relative flex flex-col items-center gap-1 rounded-xl bg-transparent p-0.5 transition-all active:scale-95 md:bg-[#ecedfa] md:p-2.5 md:hover:bg-[#e7e7f4]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#424656] shadow-md md:h-auto md:w-auto md:bg-transparent md:shadow-none">
                  <span
                    className="material-symbols-outlined md:text-2xl"
                    style={{ fontSize: 18, lineHeight: 1, display: 'block', fontVariationSettings: "'wght' 300" }}
                  >
                    photo_library
                  </span>
                </span>
                <span
                  className="hidden text-[8px] font-bold uppercase tracking-wider text-[#424656] md:block"
                  style={headlineFont}
                >
                  Album
                </span>
                {photos.length > 0 && (
                  <span
                    className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#004cca] px-1 text-[9px] font-bold text-white"
                    style={headlineFont}
                  >
                    {photos.length}
                  </span>
                )}
              </button>

              {/* Plan editor (route-plan layouts for export) */}
              <Link
                href={`/event/${slug}/plan`}
                title="แผนงาน"
                aria-label="แผนงาน"
                className="relative flex flex-col items-center gap-1 rounded-xl bg-transparent p-0.5 transition-all active:scale-95 md:bg-[#ecedfa] md:p-2.5 md:hover:bg-[#e7e7f4]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#424656] shadow-md md:h-auto md:w-auto md:bg-transparent md:shadow-none">
                  <span
                    className="material-symbols-outlined md:text-2xl"
                    style={{ fontSize: 18, lineHeight: 1, display: 'block', fontVariationSettings: "'wght' 300" }}
                  >
                    edit_note
                  </span>
                </span>
                <span
                  className="hidden text-[8px] font-bold uppercase tracking-wider text-[#424656] md:block"
                  style={headlineFont}
                >
                  แผนงาน
                </span>
              </Link>
            </div>

          </div>
        </div>
      </div>

      {/* ============== LOADING (initial only) ============== */}
      {loading && !uploadStats && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/50 text-sm font-bold text-white">
          {loading}
        </div>
      )}
      {error && (
        <div className="fixed left-1/2 top-20 z-[2000] -translate-x-1/2 rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      {/* ============== ROUTES MODAL ============== */}
      {routesOpen && (
        <Modal
          title="GPX Tracks"
          subtitle={`${routes.length} track${routes.length !== 1 ? 's' : ''} loaded`}
          icon="route"
          onClose={() => setRoutesOpen(false)}
        >
          <div className="flex-shrink-0 px-4 pb-2 pt-3">
            {canUploadRoute && (
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#004cca]/20 bg-[#004cca]/[0.08] py-2.5 transition-colors hover:bg-[#004cca]/15">
              <span
                className="material-symbols-outlined text-lg text-[#004cca]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                add_circle
              </span>
              <span
                className="text-xs font-semibold text-[#004cca]"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                เพิ่มไฟล์ GPX
              </span>
              <input
                type="file"
                accept=".gpx"
                multiple
                className="hidden"
                onChange={(e) => {
                  void onUploadGpx(e.target.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
            )}
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-2">
            {routes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12">
                <span className="material-symbols-outlined text-4xl text-[#737687]">
                  route
                </span>
                <p className="text-sm text-[#737687]">ยังไม่มี Track</p>
              </div>
            ) : (
              <>
                {(() => {
                  const totals = Object.values(routeStats).reduce(
                    (acc, s) => ({
                      d: acc.d + s.distanceKm,
                      up: acc.up + s.elevGain,
                      down: acc.down + s.elevLoss,
                    }),
                    { d: 0, up: 0, down: 0 },
                  );
                  if (!Object.keys(routeStats).length) return null;
                  return (
                    <div className="mb-1 grid grid-cols-3 gap-2 rounded-xl border border-[#c2c6d9]/30 bg-white p-2.5">
                      <div className="text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[#737687]" style={headlineFont}>
                          Total
                        </div>
                        <div className="text-sm font-bold text-[#191b24]" style={headlineFont}>
                          {totals.d.toFixed(1)}<span className="text-[10px] font-semibold text-[#737687]"> km</span>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[#737687]" style={headlineFont}>
                          Gain
                        </div>
                        <div className="text-sm font-bold text-[#17803d]" style={headlineFont}>
                          ↑ {totals.up}<span className="text-[10px] font-semibold text-[#737687]"> m</span>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-[9px] uppercase tracking-wider text-[#737687]" style={headlineFont}>
                          Loss
                        </div>
                        <div className="text-sm font-bold text-[#ba1a1a]" style={headlineFont}>
                          ↓ {totals.down}<span className="text-[10px] font-semibold text-[#737687]"> m</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {routes.map((r, i) => {
                const st = routeStats[r._id];
                const isActive = activeStatsRouteId === r._id;
                return (
                <div
                  key={r._id}
                  className={`rounded-xl border p-3 transition-colors ${
                    isActive
                      ? 'border-[#004cca]/40 bg-white'
                      : 'border-[#c2c6d9]/30 bg-[#f2f3ff]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const layer = routeLayersRef.current.get(r._id);
                        if (layer && mapRef.current) {
                          try {
                            const bounds = (
                              layer as L.Layer & {
                                getBounds?: () => L.LatLngBounds;
                              }
                            ).getBounds?.();
                            if (bounds)
                              mapRef.current.fitBounds(bounds, {
                                padding: [30, 30],
                              });
                          } catch {
                            /* no-op */
                          }
                        }
                        setRoutesOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: r.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate text-xs font-semibold text-[#191b24]"
                          style={{ fontFamily: 'Inter, sans-serif' }}
                        >
                          {r.name}
                        </div>
                        <div
                          className="text-[9px] uppercase tracking-wider text-[#424656]"
                          style={headlineFont}
                        >
                          Track {i + 1}
                          {st ? ` · ${st.distanceKm.toFixed(2)} km` : ''}
                        </div>
                      </div>
                    </button>
                    {st && (
                      <button
                        onClick={() => {
                          setActiveStatsRouteId((cur) =>
                            cur === r._id ? null : r._id,
                          );
                          setRoutesOpen(false);
                        }}
                        aria-pressed={isActive}
                        className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm transition-colors ${
                          isActive
                            ? 'bg-[#004cca] text-white'
                            : 'bg-white text-[#004cca] hover:bg-[#eaf0ff]'
                        }`}
                        style={headlineFont}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 14, fontVariationSettings: "'FILL' 1" }}
                        >
                          {isActive ? 'visibility_off' : 'visibility'}
                        </span>
                        {isActive ? 'HIDE' : 'SHOW KM'}
                      </button>
                    )}
                    {canDelete && (
                    <button
                      onClick={() => onDeleteRoute(r._id)}
                      aria-label="Delete track"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ffdad6] transition-colors hover:bg-[#ba1a1a]/20"
                    >
                      <span
                        className="material-symbols-outlined text-[#ba1a1a]"
                        style={{ fontSize: 15, fontVariationSettings: "'FILL' 1" }}
                      >
                        delete
                      </span>
                    </button>
                    )}
                  </div>
                  {st && isActive && (
                    <div className="mt-2">
                      <div
                        className="mb-1 flex items-center justify-between text-[9px] font-semibold"
                        style={{ fontFamily: 'Inter, sans-serif' }}
                      >
                        <span className="text-[#17803d]">
                          ↑ {st.elevGain} m
                        </span>
                        <span className="text-[#ba1a1a]">
                          ↓ {st.elevLoss} m
                        </span>
                        <span className="text-[#424656]">
                          max {st.maxEle} m
                        </span>
                      </div>
                      {st.profile.length > 2 && (
                        <ElevationChart
                          profile={st.profile}
                          color={r.color}
                          minEle={st.minEle}
                          maxEle={st.maxEle}
                          cps={st.cps}
                          userD={userRouteD}
                        />
                      )}
                    </div>
                  )}
                </div>
                );
                })}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* ============== ALBUM MODAL ============== */}
      {albumOpen && (
        <Modal
          title="ภาพถ่ายทั้งหมด"
          subtitle={`${photos.length} photo${photos.length !== 1 ? 's' : ''}`}
          icon="photo_library"
          onClose={() => setAlbumOpen(false)}
        >
          <div className="flex-1 overflow-y-auto">
            {photos.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <span className="material-symbols-outlined text-4xl text-[#737687]">
                  photo_library
                </span>
                <p className="text-sm text-[#737687]">ยังไม่มีภาพ</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-0.5">
                {photos.map((p, i) => (
                  <button
                    key={p._id}
                    onClick={() => {
                      setAlbumOpen(false);
                      mapRef.current?.setView([p.lat, p.lng], 18);
                      setTimeout(() => setLightboxIdx(i), 350);
                    }}
                    className="aspect-square bg-[#e1e2ee] bg-cover bg-center transition-opacity hover:opacity-85"
                    style={{ backgroundImage: `url('${p.url}')` }}
                    aria-label={`Photo ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ============== LIGHTBOX ============== */}
      {currentPhoto && (
        <div
          className="fixed inset-0 z-[3000] flex flex-col items-center justify-center bg-[#191b24]/97"
          onTouchStart={onLightboxTouchStart}
          onTouchEnd={onLightboxTouchEnd}
        >
          {/* Top bar */}
          <div
            className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3"
            style={{
              background:
                'linear-gradient(to bottom,rgba(25,27,36,0.85),transparent)',
            }}
          >
            <button
              onClick={() => setLightboxIdx(-1)}
              className="flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              <span className="material-symbols-outlined text-sm text-white">
                arrow_back
              </span>
              <span
                className="text-xs font-medium text-white"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                Back
              </span>
            </button>
            <div className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 backdrop-blur-sm">
              <span
                className="text-xs font-bold text-white"
                style={headlineFont}
              >
                {lightboxIdx + 1} / {photos.length}
              </span>
            </div>
            {canDelete && <button
              onClick={async () => {
                await onDeletePhoto(currentPhoto._id);
                setLightboxIdx((idx) => {
                  const next =
                    idx >= photos.length - 1 ? photos.length - 2 : idx;
                  return next < 0 ? -1 : next;
                });
              }}
              className="flex items-center gap-1.5 rounded-full border border-[#ba1a1a]/30 bg-[#ba1a1a]/70 px-3 py-1.5 backdrop-blur-sm transition-colors hover:bg-[#ba1a1a]/90"
            >
              <span className="material-symbols-outlined text-sm text-white">
                delete
              </span>
              <span
                className="text-xs font-medium text-white"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                ลบ
              </span>
            </button>}
          </div>

          {/* Prev / Next */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIdx((i) => (i > 0 ? i - 1 : i));
            }}
            aria-label="Previous"
            className="absolute left-3 top-1/2 z-[3003] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/12 backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <span className="material-symbols-outlined text-xl text-white">
              chevron_left
            </span>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPhoto.url}
            alt=""
            className="mb-36 max-h-[56vh] max-w-[94vw] rounded-xl object-contain shadow-2xl md:mb-32 md:max-h-[62vh]"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIdx((i) => (i < photos.length - 1 ? i + 1 : i));
            }}
            aria-label="Next"
            className="absolute right-3 top-1/2 z-[3003] flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-white/12 backdrop-blur-sm transition-colors hover:bg-white/20"
          >
            <span className="material-symbols-outlined text-xl text-white">
              chevron_right
            </span>
          </button>

          {/* Bottom meta */}
          <div
            className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-3 px-4 pb-8 pt-4"
            style={{
              background:
                'linear-gradient(to top,rgba(25,27,36,0.85),transparent)',
            }}
          >
            <div className="flex w-full max-w-md items-stretch gap-3 rounded-2xl border border-white/15 bg-white/10 p-2 backdrop-blur-md">
              {photoMatch && (
                <button
                  onClick={() => flyToPhoto(currentPhoto, photoOnRoute?.route._id ?? null)}
                  aria-label="ดูบนแผนที่"
                  className="relative isolate h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-white/20 bg-[#e1e2ee]"
                >
                  <PhotoRouteMiniMap
                    track={photoMatch.stats.track}
                    color={photoMatch.route.color}
                    lat={currentPhoto.lat}
                    lng={currentPhoto.lng}
                  />
                </button>
              )}
              <div
                className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-0.5"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {photoOnRoute ? (
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: photoOnRoute.route.color }}
                      />
                      <span className="truncate text-[10px] text-white/70">
                        {photoOnRoute.route.name}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1 text-white" style={headlineFont}>
                      <span className="text-xl font-bold leading-tight">
                        km {photoOnRoute.d.toFixed(1)}
                      </span>
                      <span className="text-[10px] font-semibold text-white/60">
                        / {photoOnRoute.stats.distanceKm.toFixed(1)} km
                      </span>
                    </div>
                    {(photoOnRoute.prevCp || photoOnRoute.nextCp) && (
                      <div className="truncate text-[10px] font-semibold text-white/80">
                        {photoOnRoute.prevCp && photoOnRoute.nextCp
                          ? `ระหว่าง ${photoOnRoute.prevCp.label} → ${photoOnRoute.nextCp.label}`
                          : photoOnRoute.prevCp
                            ? `หลัง ${photoOnRoute.prevCp.label}`
                            : `ก่อนถึง ${photoOnRoute.nextCp!.label}`}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-white/80">
                      {photoMatch ? 'ไม่อยู่บนเส้นทาง' : 'ตำแหน่งภาพ'}
                    </div>
                    <div className="text-[10px] text-white/60">
                      {currentPhoto.lat.toFixed(5)}, {currentPhoto.lng.toFixed(5)}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => flyToPhoto(currentPhoto, photoOnRoute?.route._id ?? null)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-3 py-2 text-[#004cca] shadow-md transition-transform active:scale-95"
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16, fontVariationSettings: "'FILL' 1" }}
                    >
                      near_me
                    </span>
                    <span className="text-xs font-bold" style={headlineFont}>
                      ดูบนแผนที่
                    </span>
                  </button>
                  <a
                    href={`https://www.google.com/maps?q=${currentPhoto.lat},${currentPhoto.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View in Google Maps"
                    title="View in Google Maps"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/12 transition-colors hover:bg-white/20"
                  >
                    <span className="material-symbols-outlined text-base text-white">
                      open_in_new
                    </span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  subtitle,
  icon,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-[#faf8ff]">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[#c2c6d9]/30 bg-[#faf8ff]/88 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          {icon && (
            <div className="flex h-7 w-7 items-center justify-center rounded-lg shadow-sm kinetic-gradient">
              <span
                className="material-symbols-outlined text-sm text-white"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                {icon}
              </span>
            </div>
          )}
          <div>
            <h3
              className="text-sm font-bold text-[#191b24]"
              style={{ fontFamily: 'var(--font-headline), Space Grotesk, sans-serif' }}
            >
              {title}
            </h3>
            {subtitle && (
              <p className="text-[10px] text-[#424656]">{subtitle}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ecedfa] transition-colors hover:bg-[#e7e7f4]"
        >
          <span className="material-symbols-outlined text-lg text-[#424656]">
            close
          </span>
        </button>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}

/* Spin keyframes for the progress icon. Added once globally. */
const spinStyle =
  typeof document !== 'undefined' &&
  !document.getElementById('gpx-spin-keyframes')
    ? (() => {
        const el = document.createElement('style');
        el.id = 'gpx-spin-keyframes';
        el.textContent = `@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
        document.head.appendChild(el);
        return true;
      })()
    : true;
void spinStyle;
