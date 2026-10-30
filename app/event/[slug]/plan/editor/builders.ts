/**
 * Pure builders that produce page content: the "photos around the map with
 * pointer lines" layout and the starter templates.
 */
import type { PhotoDoc, RouteDoc } from '@/lib/types';
import { locateOnRoute } from '@/lib/gpx';
import type { Background, ConnectorElement, ImageElement, MapElement, PlanElement } from './types';
import { formatKm, makeImage, makeMap, makeShape, makeText, makeIcon, uid } from './constants';
import { anchorToPage } from './geometry';
import { getGeom, loadImage, type RouteGeom } from './runtime';

export interface PageContent {
  background: Background;
  elements: PlanElement[];
}

/** Relative luminance of a #rrggbb colour (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function backgroundIsDark(bg: Background): boolean {
  if (bg.type === 'color') return luminance(bg.color) < 0.5;
  if (bg.type === 'gradient') return (luminance(bg.from) + luminance(bg.to)) / 2 < 0.5;
  return bg.dim > 0.3;
}

/** Natural size of a photo, loading it if the API didn't record it. */
export async function photoSize(p: { url: string; width?: number; height?: number }) {
  if (p.width && p.height) return { w: p.width, h: p.height };
  try {
    const img = await loadImage(p.url);
    return { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return { w: 4, h: 3 };
  }
}

/** Nearest route (of a map) to a lat/lng, with distance along it. */
export function locatePhoto(map: MapElement, lat: number, lng: number) {
  let best: { routeId: string; d: number; offM: number } | null = null;
  for (const id of map.routeIds) {
    const g = getGeom(id);
    if (!g) continue;
    const r = locateOnRoute(g.pts, lat, lng);
    if (r && (!best || r.offM < best.offM)) best = { routeId: id, d: r.d, offM: r.offM };
  }
  return best;
}

export interface LayoutStyle {
  stroke: string;
  captionColor: string;
  dash: ConnectorElement['dash'];
}

/**
 * Place photos in columns left/right of a map, each with a "xx KM" caption
 * and a pointer line to where it was taken on the route. Photos are spread
 * vertically near the height of their route point to keep lines short.
 */
export async function layoutPhotosAroundMap(
  photos: PhotoDoc[],
  map: MapElement,
  pageW: number,
  pageH: number,
  style: LayoutStyle,
  existing: PlanElement[] = [],
): Promise<{ elements: PlanElement[]; skipped: number }> {
  const all = [...existing.filter((e) => e.id !== map.id), map];
  const located = photos
    .map((p) => ({ p, loc: locatePhoto(map, p.lat, p.lng) }))
    .filter((x): x is { p: PhotoDoc; loc: NonNullable<ReturnType<typeof locatePhoto>> } => !!x.loc && x.loc.offM < 3000);
  const skipped = photos.length - located.length;
  if (!located.length) return { elements: [], skipped };

  const items = await Promise.all(
    located.map(async ({ p, loc }) => {
      const anchor = { mapId: map.id, routeId: loc.routeId, d: loc.d };
      const pt = anchorToPage(anchor, all) ?? { x: map.x + map.width / 2, y: map.y + map.height / 2 };
      return { p, loc, anchor, pt, size: await photoSize(p) };
    }),
  );

  const margin = Math.round(pageW * 0.02);
  const leftSpace = map.x - margin * 2;
  const rightSpace = pageW - (map.x + map.width) - margin * 2;
  const photoW = Math.round(
    Math.max(pageW * 0.09, Math.min(pageW * 0.16, Math.max(leftSpace, rightSpace, 0) || pageW * 0.14)),
  );
  const photoH = Math.round(photoW * 0.68);
  const captionSize = Math.max(14, Math.round(photoW / 8));
  const slotH = photoH + captionSize * 1.6 + margin * 0.6;

  // Split by which half of the map the route point is on, then balance.
  const cx = map.x + map.width / 2;
  let left = items.filter((i) => i.pt.x < cx);
  let right = items.filter((i) => i.pt.x >= cx);
  const maxPerCol = Math.max(1, Math.floor((pageH - margin * 2) / slotH));
  const rebalance = (from: typeof left, to: typeof left) => {
    from.sort((a, b) => Math.abs(b.pt.x - cx) - Math.abs(a.pt.x - cx));
    while (from.length > maxPerCol && to.length < maxPerCol) to.push(from.pop()!);
  };
  rebalance(left, right);
  rebalance(right, left);
  left = left.slice(0, maxPerCol);
  right = right.slice(0, maxPerCol);

  const elements: PlanElement[] = [];
  const placeColumn = (col: typeof left, x: number) => {
    col.sort((a, b) => a.pt.y - b.pt.y);
    const ys: number[] = [];
    col.forEach((it, i) => {
      const ideal = it.pt.y - photoH / 2;
      ys.push(Math.max(ideal, margin, i ? ys[i - 1] + slotH : -Infinity));
    });
    const overflow = (ys[ys.length - 1] ?? 0) + slotH - (pageH - margin);
    if (overflow > 0) {
      for (let i = ys.length - 1; i >= 0; i--) {
        const limit = i === ys.length - 1 ? pageH - margin - slotH : ys[i + 1] - slotH;
        ys[i] = Math.max(margin, Math.min(ys[i], limit));
      }
    }
    col.forEach((it, i) => {
      const img = makeImage(it.p.url, it.size.w, it.size.h, x, ys[i], photoW, photoH, {
        photoId: it.p._id,
        lat: it.p.lat,
        lng: it.p.lng,
        borderColor: style.stroke,
        borderWidth: Math.max(3, Math.round(photoW / 70)),
        caption: formatKm(it.loc.d),
      });
      img.captionStyle = {
        ...img.captionStyle,
        fontFamily: 'Kanit',
        fontSize: captionSize,
        fill: style.captionColor,
        align: 'center',
      };
      const connector: ConnectorElement = {
        id: uid(),
        type: 'connector',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        opacity: 1,
        fromId: img.id,
        fromSide: 'auto',
        to: it.anchor,
        routing: 'hvh',
        bend: 0.5,
        stroke: style.stroke,
        strokeWidth: Math.max(2, Math.round(photoW / 90)),
        dash: style.dash,
        startCap: 'none',
        endCap: 'dot',
      };
      elements.push(img, connector);
    });
  };
  placeColumn(left, Math.max(margin, map.x - margin - photoW));
  placeColumn(right, Math.min(pageW - margin - photoW, map.x + map.width + margin));
  return { elements, skipped: skipped + (items.length - left.length - right.length) };
}

/** Pick up to `n` photos along a route, evenly spread by distance. */
export function photosAlongRoute(photos: PhotoDoc[], g: RouteGeom, n: number, maxOffM = 400) {
  const near = photos
    .map((p) => ({ p, r: locateOnRoute(g.pts, p.lat, p.lng) }))
    .filter((x) => x.r && x.r.offM <= maxOffM)
    .sort((a, b) => a.r!.d - b.r!.d);
  if (near.length <= n) return near.map((x) => x.p);
  const out: PhotoDoc[] = [];
  for (let i = 0; i < n; i++) out.push(near[Math.round((i * (near.length - 1)) / (n - 1))].p);
  return out;
}

// ---- Templates ------------------------------------------------------------------

export interface TemplateCtx {
  W: number;
  H: number;
  route: RouteDoc | null;
  photos: PhotoDoc[];
  eventName: string;
}

export interface Template {
  id: string;
  name: string;
  /** Preview colours + icon for the sidebar card. */
  preview: { bg: string; fg: string; icon: string };
  build: (ctx: TemplateCtx) => Promise<PageContent>;
}

const placeholder = (x: number, y: number, w: number, h: number, caption: string, captionColor: string): ImageElement => {
  const img = makeImage('', 4, 3, x, y, w, h, { caption });
  img.captionStyle = { ...img.captionStyle, fill: captionColor, align: 'center', fontSize: Math.max(14, Math.round(w / 10)) };
  return img;
};

/** The route-plan layout from the organiser's PDF: map centre, photos around it. */
async function routePlan(ctx: TemplateCtx, dark: boolean): Promise<PageContent> {
  const { W, H, route } = ctx;
  const bg: Background = { type: 'color', color: dark ? '#1b1c22' : '#ffffff' };
  const fg = dark ? '#ffffff' : '#191b24';
  const accent = route?.color ?? '#004cca';
  const u = Math.min(W, H);
  const headerH = Math.round(H * 0.11);
  const els: PlanElement[] = [];

  const portrait = H > W * 1.1;
  const mapW = Math.round(portrait ? W * 0.92 : W * 0.6);
  const mapH = Math.round(portrait ? H * 0.5 : H - headerH);
  const mapX = Math.round((W - mapW) / 2);
  const mapY = portrait ? headerH + Math.round(H * 0.03) : headerH;

  const header = makeShape('rect', mapX, 0, mapW, );
  Object.assign(header, { width: mapW, height: headerH, fill: accent });
  els.push(header);
  const title = makeText(
    `${route?.name ?? ctx.eventName}  ·  แผนงาน`,
    mapX + u * 0.03,
    headerH / 2 - u * 0.035,
    { fontSize: Math.round(u * 0.055), bold: true, fill: '#ffffff', fontFamily: 'Kanit' },
    mapW - u * 0.06,
  );
  els.push(title);

  let map: MapElement | null = null;
  if (route) {
    map = makeMap([route._id], mapX, mapY, mapW, mapH);
    map.routeColors = { [route._id]: accent };
    els.push(map);
    const g = getGeom(route._id);
    if (g) {
      const badgeW = Math.round(u * 0.3);
      const badgeH = Math.round(u * 0.07);
      const bx = mapX + u * 0.03;
      const by = mapY + mapH - badgeH - u * 0.03;
      const badge = makeShape('rect', bx, by, 0);
      const gid = uid();
      Object.assign(badge, { width: badgeW, height: badgeH, fill: accent, cornerRadius: badgeH * 0.18, groupId: gid });
      const label = makeText(
        `${route.name}-${(Math.round(g.total * 10) / 10).toFixed(1)}KM`,
        bx,
        by + badgeH * 0.18,
        { fontSize: Math.round(badgeH * 0.5), bold: true, fill: '#ffffff', align: 'center', fontFamily: 'Kanit' },
        badgeW,
      );
      label.groupId = gid;
      els.push(badge, label);
      const picks = photosAlongRoute(ctx.photos, g, portrait ? 4 : 6);
      if (picks.length) {
        const { elements } = await layoutPhotosAroundMap(picks, map, W, H, {
          stroke: accent,
          captionColor: fg,
          dash: 'dashed',
        }, els);
        els.push(...elements);
        return { background: bg, elements: els };
      }
    }
  }
  // No route / photos: leave placeholder slots for the organiser to fill.
  const pw = Math.round(portrait ? W * 0.28 : W * 0.15);
  const ph = Math.round(pw * 0.68);
  const slots = portrait
    ? [0, 1, 2].map((i) => ({ x: W * 0.04 + i * (pw + W * 0.04), y: mapY + mapH + H * 0.04 }))
    : [0, 1, 2].flatMap((i) => [
        { x: W * 0.02, y: headerH + i * (H - headerH) / 3 + H * 0.02 },
        { x: W - W * 0.02 - pw, y: headerH + i * (H - headerH) / 3 + H * 0.02 },
      ]);
  slots.forEach((s, i) => els.push(placeholder(s.x, s.y, pw, ph, `${(i + 1) * 10}KM`, fg)));
  if (!route) {
    const hint = makeText('เลือกเส้นทางในแท็บ “แผนที่” เพื่อเพิ่มผังเส้นทาง', mapX, mapY + mapH / 2, {
      fontSize: Math.round(u * 0.03),
      fill: dark ? '#c2c6d9' : '#737687',
      align: 'center',
    }, mapW);
    els.push(hint);
  }
  return { background: bg, elements: els };
}

export const TEMPLATES: Template[] = [
  {
    id: 'route-dark',
    name: 'แผนงานเส้นทาง (มืด)',
    preview: { bg: '#1b1c22', fg: '#ef4444', icon: 'route' },
    build: (ctx) => routePlan(ctx, true),
  },
  {
    id: 'route-light',
    name: 'แผนงานเส้นทาง (สว่าง)',
    preview: { bg: '#ffffff', fg: '#004cca', icon: 'route' },
    build: (ctx) => routePlan(ctx, false),
  },
  {
    id: 'poster',
    name: 'โปสเตอร์เส้นทาง',
    preview: { bg: 'linear-gradient(135deg,#004cca,#0062ff)', fg: '#ffffff', icon: 'landscape' },
    build: async ({ W, H, route, eventName }) => {
      const u = Math.min(W, H);
      const m = u * 0.06;
      const els: PlanElement[] = [];
      els.push(makeText('ROUTE MAP', m, m, { fontSize: u * 0.03, bold: true, fill: '#b4c5ff', letterSpacing: u * 0.006, fontFamily: 'Space Grotesk' }, W - m * 2));
      els.push(makeText(eventName.toUpperCase(), m, m + u * 0.045, { fontSize: u * 0.08, bold: true, fill: '#ffffff', fontFamily: 'Kanit', lineHeight: 1.05 }, W - m * 2));
      const mapY = m + u * 0.2;
      const statsH = u * 0.14;
      const mapH = H - mapY - statsH - m * 2;
      if (route) {
        const map = makeMap([route._id], m, mapY, W - m * 2, mapH);
        Object.assign(map, { cornerRadius: u * 0.025, borderColor: '#ffffff', borderWidth: u * 0.006, basemap: 'topo', basemapGray: false, basemapDim: 0 });
        els.push(map);
      } else {
        const card = makeShape('rect', m, mapY, 0);
        Object.assign(card, { width: W - m * 2, height: mapH, fill: '#ffffff', opacity: 0.15, cornerRadius: u * 0.025 });
        els.push(card);
      }
      const g = route ? getGeom(route._id) : null;
      const stats = [
        { k: 'ระยะทาง', v: g ? `${g.total.toFixed(1)} KM` : '— KM' },
        { k: 'เช็กพอยต์', v: g ? `${g.cps.length} จุด` : '— จุด' },
        { k: 'เส้นทาง', v: route?.name ?? '—' },
      ];
      const bw = (W - m * 2 - u * 0.04) / 3;
      stats.forEach((s, i) => {
        const x = m + i * (bw + u * 0.02);
        const y = H - m - statsH;
        const gid = uid();
        const box = makeShape('rect', x, y, 0);
        Object.assign(box, { width: bw, height: statsH, fill: '#ffffff', cornerRadius: u * 0.02, groupId: gid });
        const k = makeText(s.k, x, y + statsH * 0.14, { fontSize: statsH * 0.2, fill: '#737687', align: 'center' }, bw);
        const v = makeText(s.v, x, y + statsH * 0.42, { fontSize: statsH * 0.32, bold: true, fill: '#004cca', align: 'center', fontFamily: 'Kanit' }, bw);
        k.groupId = gid;
        v.groupId = gid;
        els.push(box, k, v);
      });
      return { background: { type: 'gradient', from: '#004cca', to: '#0062ff', angle: 135 }, elements: els };
    },
  },
  {
    id: 'cp-table',
    name: 'ตารางเช็กพอยต์',
    preview: { bg: '#f2f3ff', fg: '#004cca', icon: 'flag' },
    build: async ({ W, H, route, eventName }) => {
      const u = Math.min(W, H);
      const m = u * 0.05;
      const portrait = H > W;
      const els: PlanElement[] = [];
      els.push(makeText(`${route?.name ?? eventName} · จุดเช็กพอยต์`, m, m, { fontSize: u * 0.055, bold: true, fill: '#191b24', fontFamily: 'Kanit' }, W - m * 2));
      const top = m + u * 0.11;
      const mapBox = portrait
        ? { x: m, y: top, w: W - m * 2, h: H * 0.42 }
        : { x: m, y: top, w: W * 0.5, h: H - top - m };
      if (route) {
        const map = makeMap([route._id], mapBox.x, mapBox.y, mapBox.w, mapBox.h);
        Object.assign(map, { basemap: 'light', basemapGray: false, basemapDim: 0, cornerRadius: u * 0.02 });
        els.push(map);
      }
      const g = route ? getGeom(route._id) : null;
      const rows = g?.cps.length
        ? g.cps.map((c) => ({ label: c.label, name: c.name, d: c.d }))
        : [1, 2, 3, 4, 5].map((i) => ({ label: `CP${i}`, name: 'ชื่อจุด', d: i * 10 }));
      const listX = portrait ? m : mapBox.x + mapBox.w + m;
      const listY = portrait ? mapBox.y + mapBox.h + m : top;
      const listW = W - listX - m;
      const rowH = Math.min(u * 0.075, (H - listY - m) / rows.length);
      rows.forEach((r, i) => {
        const y = listY + i * rowH;
        const dot = makeShape('circle', listX, y + rowH * 0.2, rowH * 0.6);
        dot.fill = route?.color ?? '#004cca';
        const label = makeText(r.label, listX, y + rowH * 0.32, { fontSize: rowH * 0.24, bold: true, fill: '#ffffff', align: 'center' }, rowH * 0.6);
        const name = makeText(r.name, listX + rowH * 0.8, y + rowH * 0.22, { fontSize: rowH * 0.36, fill: '#191b24' }, listW * 0.65);
        const km = makeText(formatKm(r.d), listX + listW * 0.7, y + rowH * 0.22, { fontSize: rowH * 0.36, bold: true, fill: '#004cca', align: 'right', fontFamily: 'Kanit' }, listW * 0.3);
        els.push(dot, label, name, km);
      });
      return { background: { type: 'color', color: '#ffffff' }, elements: els };
    },
  },
  {
    id: 'gallery',
    name: 'แกลเลอรีรูปภาพ',
    preview: { bg: '#191b24', fg: '#facc15', icon: 'photo_library' },
    build: async ({ W, H, photos, eventName }) => {
      const u = Math.min(W, H);
      const m = u * 0.05;
      const els: PlanElement[] = [];
      els.push(makeText(eventName, m, m, { fontSize: u * 0.06, bold: true, fill: '#ffffff', fontFamily: 'Kanit' }, W - m * 2));
      const cols = W >= H ? 3 : 2;
      const rows = 2;
      const top = m + u * 0.13;
      const gap = u * 0.03;
      const cw = (W - m * 2 - gap * (cols - 1)) / cols;
      const ch = (H - top - m - gap * (rows - 1)) / rows - u * 0.06;
      const picks = photos.slice(0, cols * rows);
      const sizes = await Promise.all(picks.map(photoSize));
      for (let i = 0; i < cols * rows; i++) {
        const x = m + (i % cols) * (cw + gap);
        const y = top + Math.floor(i / cols) * (ch + gap + u * 0.06);
        const p = picks[i];
        const img = p
          ? makeImage(p.url, sizes[i].w, sizes[i].h, x, y, cw, ch, { photoId: p._id, lat: p.lat, lng: p.lng })
          : placeholder(x, y, cw, ch, '', '#ffffff');
        img.cornerRadius = u * 0.015;
        img.caption = `คำบรรยายรูปที่ ${i + 1}`;
        img.captionStyle = { ...img.captionStyle, fill: '#facc15', fontSize: u * 0.028 };
        els.push(img);
      }
      return { background: { type: 'color', color: '#191b24' }, elements: els };
    },
  },
  {
    id: 'announce',
    name: 'ประกาศ / แจ้งเตือน',
    preview: { bg: 'linear-gradient(160deg,#facc15,#f97316)', fg: '#191b24', icon: 'campaign' },
    build: async ({ W, H, eventName }) => {
      const u = Math.min(W, H);
      const m = u * 0.08;
      const els: PlanElement[] = [];
      const icon = makeIcon('warning', m, m, u * 0.14);
      icon.fill = '#191b24';
      els.push(icon);
      els.push(makeText('ประกาศสำคัญ', m, m + u * 0.18, { fontSize: u * 0.1, bold: true, fill: '#191b24', fontFamily: 'Kanit' }, W - m * 2));
      els.push(
        makeText(
          `ข้อมูลสำหรับทีมงาน ${eventName}\nเวลารวมพล 05.00 น. ณ จุดสตาร์ท\nรถรับส่งออกทุก 30 นาที`,
          m,
          m + u * 0.34,
          { fontSize: u * 0.045, fill: '#191b24', lineHeight: 1.5 },
          W - m * 2,
        ),
      );
      const bar = makeShape('rect', 0, H - u * 0.1, 0);
      Object.assign(bar, { width: W, height: u * 0.1, fill: '#191b24' });
      els.push(bar);
      els.push(makeText(eventName.toUpperCase(), m, H - u * 0.07, { fontSize: u * 0.035, bold: true, fill: '#facc15', letterSpacing: u * 0.004 }, W - m * 2));
      return { background: { type: 'gradient', from: '#facc15', to: '#f97316', angle: 160 }, elements: els };
    },
  },
  {
    id: 'story',
    name: 'สรุปเส้นทาง (แนวตั้ง)',
    preview: { bg: 'linear-gradient(180deg,#0f2027,#2c5364)', fg: '#a3e635', icon: 'smartphone' },
    build: async ({ W, H, route, photos, eventName }) => {
      const u = Math.min(W, H);
      const m = u * 0.06;
      const els: PlanElement[] = [];
      els.push(makeText(eventName, m, m, { fontSize: u * 0.075, bold: true, fill: '#ffffff', fontFamily: 'Kanit' }, W - m * 2));
      els.push(makeText(route?.name ?? 'ชื่อเส้นทาง', m, m + u * 0.1, { fontSize: u * 0.045, fill: '#a3e635', bold: true }, W - m * 2));
      const mapY = m + u * 0.2;
      const mapH = H * 0.5;
      if (route) {
        const map = makeMap([route._id], m, mapY, W - m * 2, mapH);
        Object.assign(map, { cornerRadius: u * 0.03, basemap: 'dark', basemapGray: false, basemapDim: 0 });
        map.routeColors = { [route._id]: '#a3e635' };
        els.push(map);
      }
      const g = route ? getGeom(route._id) : null;
      const picks = g ? photosAlongRoute(photos, g, 3) : [];
      const sizes = await Promise.all(picks.map(photoSize));
      const gap = u * 0.03;
      const pw = (W - m * 2 - gap * 2) / 3;
      const py = mapY + mapH + m;
      const ph = Math.min(pw, H - py - m - u * 0.08);
      for (let i = 0; i < 3; i++) {
        const x = m + i * (pw + gap);
        const p = picks[i];
        const loc = p && g ? locateOnRoute(g.pts, p.lat, p.lng) : null;
        const img = p
          ? makeImage(p.url, sizes[i].w, sizes[i].h, x, py, pw, ph, { photoId: p._id, lat: p.lat, lng: p.lng })
          : placeholder(x, py, pw, ph, '', '#ffffff');
        img.cornerRadius = u * 0.02;
        img.caption = loc ? formatKm(loc.d) : `${(i + 1) * 10}KM`;
        img.captionStyle = { ...img.captionStyle, fill: '#ffffff', align: 'center', fontFamily: 'Kanit', fontSize: u * 0.035 };
        els.push(img);
      }
      return { background: { type: 'gradient', from: '#0f2027', to: '#2c5364', angle: 180 }, elements: els };
    },
  },
];

