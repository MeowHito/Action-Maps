/** GPX parsing and route geometry shared by the event map and the plan editor. */

export type RouteDistPoint = { lat: number; lng: number; d: number };

export function haversineKmPair(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Parse GPX into trkpts annotated with cumulative distance in km. */
export function parseGpxDistPoints(text: string): RouteDistPoint[] {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const pts = Array.from(doc.getElementsByTagName('trkpt'));
    const out: RouteDistPoint[] = [];
    let dist = 0;
    let prev: { lat: number; lng: number } | null = null;
    for (const p of pts) {
      const lat = parseFloat(p.getAttribute('lat') || 'NaN');
      const lng = parseFloat(p.getAttribute('lon') || 'NaN');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (prev) dist += haversineKmPair(prev.lat, prev.lng, lat, lng);
      out.push({ lat, lng, d: dist });
      prev = { lat, lng };
    }
    return out;
  } catch {
    return [];
  }
}

/** Compute interpolated lat/lng at every integer km along a route. */

export function pointAtDistance(
  pts: RouteDistPoint[],
  distanceKm: number,
): { lat: number; lng: number } | null {
  if (!pts.length) return null;
  if (distanceKm <= pts[0].d) return { lat: pts[0].lat, lng: pts[0].lng };
  const last = pts[pts.length - 1];
  if (distanceKm >= last.d) return { lat: last.lat, lng: last.lng };
  let idx = 1;
  while (idx < pts.length && pts[idx].d < distanceKm) idx++;
  if (idx >= pts.length) return { lat: last.lat, lng: last.lng };
  const a = pts[idx - 1];
  const b = pts[idx];
  const span = b.d - a.d;
  const f = span > 0 ? (distanceKm - a.d) / span : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
  };
}

export type RouteCp = { name: string; label: string; d: number };

export const M_PER_DEG_LAT = 110540;

/** Closest point on segment a→b to (lat,lng), using a local flat-earth projection. */
export function projectOnSegment(
  a: RouteDistPoint,
  b: RouteDistPoint,
  lat: number,
  lng: number,
  mPerDegLng: number,
): { d: number; offM: number } {
  const ax = (a.lng - lng) * mPerDegLng;
  const ay = (a.lat - lat) * M_PER_DEG_LAT;
  const dx = (b.lng - a.lng) * mPerDegLng;
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = dx * dx + dy * dy;
  const f = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return { d: a.d + (b.d - a.d) * f, offM: Math.hypot(ax + dx * f, ay + dy * f) };
}

/**
 * Snap a lat/lng onto a route: distance along the route (km) of the closest
 * point, and how far off the route the input is (m).
 */
export function locateOnRoute(
  pts: RouteDistPoint[],
  lat: number,
  lng: number,
): { d: number; offM: number } | null {
  if (pts.length < 2) return null;
  const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
  let best = { d: 0, offM: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const r = projectOnSegment(pts[i - 1], pts[i], lat, lng, mPerDegLng);
    if (r.offM < best.offM) best = r;
  }
  return best;
}

/** Parse `<wpt>` elements (checkpoints) from a GPX file. */
export function parseGpxWaypoints(text: string): { name: string; lat: number; lng: number }[] {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const out: { name: string; lat: number; lng: number }[] = [];
    for (const w of Array.from(doc.getElementsByTagName('wpt'))) {
      const lat = parseFloat(w.getAttribute('lat') || 'NaN');
      const lng = parseFloat(w.getAttribute('lon') || 'NaN');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const name = w.getElementsByTagName('name')[0]?.textContent?.trim() || 'CP';
      out.push({ name, lat, lng });
    }
    return out;
  } catch {
    return [];
  }
}

/** "CP1/SP1青泥村" → "CP1", "起点/终点：泰湖公园" → "起点". */
export function cpShortLabel(name: string): string {
  const code = name.match(/^[A-Za-z]{1,3}\s*\d+/);
  if (code) return code[0].replace(/\s+/g, '').toUpperCase();
  const head = name.split(/[/:：|,]/)[0].trim();
  return (head || name).slice(0, 6);
}

/**
 * Place GPX waypoints along the track. A waypoint the route passes more than
 * once (start/finish of a loop, out-and-back CPs) gets one entry per pass.
 * Waypoints further than 300 m from the track are ignored.
 */
export function checkpointsOnRoute(
  pts: RouteDistPoint[],
  wpts: { name: string; lat: number; lng: number }[],
): RouteCp[] {
  if (pts.length < 2) return [];
  const out: RouteCp[] = [];
  for (const w of wpts) {
    const mPerDegLng = 111320 * Math.cos((w.lat * Math.PI) / 180);
    const segs: { d: number; offM: number }[] = [];
    let minOff = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const r = projectOnSegment(pts[i - 1], pts[i], w.lat, w.lng, mPerDegLng);
      segs.push(r);
      if (r.offM < minOff) minOff = r.offM;
    }
    if (minOff > 300) continue;
    // Each contiguous run of segments near the waypoint is one pass.
    const threshold = Math.max(80, minOff + 50);
    const passes: number[] = [];
    let run: { d: number; offM: number } | null = null;
    for (const s of segs) {
      if (s.offM <= threshold) {
        if (!run || s.offM < run.offM) run = s;
      } else if (run) {
        passes.push(run.d);
        run = null;
      }
    }
    if (run) passes.push(run.d);
    const label = cpShortLabel(w.name);
    let last = -Infinity;
    for (const d of passes) {
      if (d - last < 0.3) continue;
      out.push({ name: w.name, label, d });
      last = d;
    }
  }
  return out.sort((a, b) => a.d - b.d);
}
