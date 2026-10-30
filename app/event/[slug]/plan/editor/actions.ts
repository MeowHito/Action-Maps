/**
 * Higher-level editor commands used by the sidebar, properties panel and
 * canvas drop handling. They read and write the Zustand store.
 */
import type { PhotoDoc, RouteDoc } from '@/lib/types';
import type { ConnectorElement, ImageElement, MapElement, PlanElement } from './types';
import { coverCrop, formatKm, makeImage, makeMap, uid } from './constants';
import { getPageElements, useEditor } from './store';
import { ensureRouteGeom, getGeom } from './runtime';
import {
  backgroundIsDark,
  layoutPhotosAroundMap,
  locatePhoto,
  photoSize,
  TEMPLATES,
  type PageContent,
} from './builders';

/** Simple transient message shown at the bottom of the canvas. */
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export const toastStore = { msg: '', listeners: new Set<() => void>() };
export function toast(msg: string) {
  toastStore.msg = msg;
  toastStore.listeners.forEach((l) => l());
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastStore.msg = '';
    toastStore.listeners.forEach((l) => l());
  }, 3200);
}

function pageSize() {
  const doc = useEditor.getState().doc!;
  return { W: doc.width, H: doc.height };
}

function currentBackground() {
  const s = useEditor.getState();
  return s.doc!.pages[s.pageIndex].background;
}

/** The selected element if it is an empty image slot. */
function selectedPlaceholder(): ImageElement | null {
  const { selectedIds } = useEditor.getState();
  if (selectedIds.length !== 1) return null;
  const el = getPageElements().find((e) => e.id === selectedIds[0]);
  return el?.type === 'image' && !el.src ? el : null;
}

/** Put a picture into an existing image element, keeping its frame. */
export function fillImage(
  target: ImageElement,
  src: string,
  w: number,
  h: number,
  extra: Partial<ImageElement> = {},
) {
  useEditor.getState().updateElement(target.id, {
    src,
    naturalWidth: w,
    naturalHeight: h,
    crop: coverCrop(w, h, target.width, target.height),
    ...extra,
  } as Partial<PlanElement>);
}

/** Add a picture at `at` (page coords, centre) or fill the selected empty slot. */
export async function addPicture(
  src: string,
  natW: number,
  natH: number,
  extra: Partial<ImageElement> = {},
  at?: { x: number; y: number },
  dropTarget?: ImageElement | null,
) {
  const slot = dropTarget ?? (at ? null : selectedPlaceholder());
  if (slot) return fillImage(slot, src, natW, natH, extra);
  const { W, H } = pageSize();
  const w = Math.round(Math.min(W, H) * 0.35);
  const h = Math.round((w * natH) / Math.max(1, natW));
  const c = at ?? { x: W / 2, y: H / 2 };
  const img = makeImage(src, natW, natH, c.x - w / 2, c.y - h / 2, w, h, extra);
  img.captionStyle.fill = backgroundIsDark(currentBackground()) ? '#ffffff' : '#191b24';
  useEditor.getState().addElements([img]);
  return img;
}

export async function addEventPhoto(p: PhotoDoc, at?: { x: number; y: number }, dropTarget?: ImageElement | null) {
  const { w, h } = await photoSize(p);
  return addPicture(p.url, w, h, { photoId: p._id, lat: p.lat, lng: p.lng }, at, dropTarget);
}

/** Add several photos in a tidy grid in the middle of the page. */
export async function addEventPhotos(photos: PhotoDoc[]) {
  if (photos.length === 1) return void addEventPhoto(photos[0]);
  const { W, H } = pageSize();
  const cols = Math.ceil(Math.sqrt(photos.length));
  const rows = Math.ceil(photos.length / cols);
  const gap = Math.min(W, H) * 0.02;
  const cw = Math.min((W * 0.8 - gap * (cols - 1)) / cols, W * 0.25);
  const ch = cw * 0.7;
  const x0 = (W - (cw * cols + gap * (cols - 1))) / 2;
  const y0 = (H - ((ch + gap * 2) * rows)) / 2;
  const sizes = await Promise.all(photos.map(photoSize));
  const els = photos.map((p, i) =>
    makeImage(p.url, sizes[i].w, sizes[i].h, x0 + (i % cols) * (cw + gap), y0 + Math.floor(i / cols) * (ch + gap * 2), cw, ch, {
      photoId: p._id,
      lat: p.lat,
      lng: p.lng,
    }),
  );
  useEditor.getState().addElements(els);
}

/** Route map sized to the routes' shape, centred on the page. */
export async function addMap(routeIds: string[]) {
  const { routes } = useEditor.getState();
  const geoms = (
    await Promise.all(routeIds.map((id) => routes.find((r) => r._id === id)).filter(Boolean).map((r) => ensureRouteGeom(r as RouteDoc)))
  ).filter(Boolean);
  if (!geoms.length) return toast('โหลดไฟล์เส้นทางไม่สำเร็จ');
  const minX = Math.min(...geoms.map((g) => g!.bbox.minX));
  const maxX = Math.max(...geoms.map((g) => g!.bbox.maxX));
  const minY = Math.min(...geoms.map((g) => g!.bbox.minY));
  const maxY = Math.max(...geoms.map((g) => g!.bbox.maxY));
  const aspect = Math.min(3, Math.max(0.33, (maxX - minX) / Math.max(1e-9, maxY - minY)));
  const { W, H } = pageSize();
  let w = W * 0.62;
  let h = w / aspect;
  if (h > H * 0.86) {
    h = H * 0.86;
    w = h * aspect;
  }
  const map = makeMap(routeIds, (W - w) / 2, (H - h) / 2, Math.round(w), Math.round(h));
  useEditor.getState().addElements([map]);
  return map;
}

/** The map on the current page to work with: the selected one, else the first. */
export function activeMap(): MapElement | null {
  const els = getPageElements();
  const { selectedIds } = useEditor.getState();
  const sel = els.find((e) => selectedIds.includes(e.id) && e.type === 'map');
  return (sel as MapElement) ?? (els.find((e) => e.type === 'map') as MapElement) ?? null;
}

async function ensureMapGeoms(map: MapElement) {
  const { routes } = useEditor.getState();
  await Promise.all(
    map.routeIds.map((id) => routes.find((r) => r._id === id)).filter(Boolean).map((r) => ensureRouteGeom(r as RouteDoc)),
  );
}

function routeColor(map: MapElement, routeId: string) {
  return map.routeColors[routeId] ?? useEditor.getState().routes.find((r) => r._id === routeId)?.color ?? '#ef4444';
}

/** Place photos around the active map with km captions and pointer lines. */
export async function layoutAroundMap(photos: PhotoDoc[]) {
  const map = activeMap();
  if (!map) return toast('เพิ่มแผนที่ลงหน้านี้ก่อน (แท็บ “แผนที่”)');
  await ensureMapGeoms(map);
  const { W, H } = pageSize();
  // Captions sit on the page background beside the map.
  const dark = backgroundIsDark(currentBackground());
  const { elements, skipped } = await layoutPhotosAroundMap(
    photos,
    map,
    W,
    H,
    { stroke: routeColor(map, map.routeIds[0]), captionColor: dark ? '#ffffff' : '#191b24', dash: 'dashed' },
    getPageElements(),
  );
  if (elements.length) useEditor.getState().addElements(elements);
  if (skipped) toast(`ข้าม ${skipped} รูปที่อยู่ไกลเส้นทางหรือพื้นที่ไม่พอ`);
}

function newConnector(fromId: string, to: ConnectorElement['to'], stroke: string): ConnectorElement {
  const { W } = pageSize();
  return {
    id: uid(),
    type: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 1,
    fromId,
    fromSide: 'auto',
    to,
    routing: 'hvh',
    bend: 0.5,
    stroke,
    strokeWidth: Math.max(2, Math.round(W / 640)),
    dash: 'dashed',
    startCap: 'none',
    endCap: 'dot',
  };
}

/** Create a pointer from an element to a route point picked on the canvas. */
export function createConnector(fromId: string, to: ConnectorElement['to']) {
  const map = getPageElements().find((e) => e.id === to.mapId) as MapElement | undefined;
  const c = newConnector(fromId, to, map ? routeColor(map, to.routeId) : '#ef4444');
  useEditor.getState().addElements([c], false);
  useEditor.getState().select([c.id]);
}

/** Point a photo at the spot on the route where it was taken. */
export async function connectToPhotoLocation(img: ImageElement, setCaption = false) {
  if (img.lat == null || img.lng == null) return toast('รูปนี้ไม่มีพิกัด GPS');
  const maps = getPageElements().filter((e): e is MapElement => e.type === 'map');
  if (!maps.length) return toast('เพิ่มแผนที่ลงหน้านี้ก่อน');
  await Promise.all(maps.map(ensureMapGeoms));
  let best: { map: MapElement; routeId: string; d: number; offM: number } | null = null;
  for (const m of maps) {
    const loc = locatePhoto(m, img.lat, img.lng);
    if (loc && (!best || loc.offM < best.offM)) best = { map: m, ...loc };
  }
  if (!best) return toast('หาเส้นทางไม่พบ');
  const c = newConnector(img.id, { mapId: best.map.id, routeId: best.routeId, d: best.d }, routeColor(best.map, best.routeId));
  const st = useEditor.getState();
  st.addElements([c], false);
  if (setCaption || !img.caption) st.updateElement(img.id, { caption: formatKm(best.d) } as Partial<PlanElement>, 'caption-km');
  if (best.offM > 300) toast(`รูปอยู่ห่างเส้นทาง ~${Math.round(best.offM)} ม. ชี้ไปจุดที่ใกล้ที่สุด`);
}

/** Write the photo's km along the route into its caption. */
export async function captionWithKm(img: ImageElement) {
  const map = activeMap();
  if (!map || img.lat == null || img.lng == null) return toast('ต้องมีแผนที่และรูปที่มีพิกัด');
  await ensureMapGeoms(map);
  const loc = locatePhoto(map, img.lat, img.lng);
  if (loc) useEditor.getState().updateElement(img.id, { caption: formatKm(loc.d) } as Partial<PlanElement>);
}

// ---- Uploads ------------------------------------------------------------------

/** Read an image file, downscaled so plans stay a reasonable size. */
export function readImageFile(file: File, maxSide = 2000): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * k);
      const h = Math.round(img.naturalHeight * k);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const png = file.type === 'image/png' || file.type === 'image/svg+xml' || file.type === 'image/webp';
      resolve({ src: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.9), w, h });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('ไฟล์รูปไม่รองรับ'));
    };
    img.src = url;
  });
}

/** Upload files into the plan's library; optionally drop the first onto the page. */
export async function uploadFiles(files: File[], place?: { at?: { x: number; y: number }; target?: ImageElement | null }) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  for (let i = 0; i < images.length; i++) {
    try {
      const r = await readImageFile(images[i]);
      useEditor.getState().addUpload({ id: uid(), src: r.src, width: r.w, height: r.h, name: images[i].name });
      if (place) {
        const offset = i * 30;
        const at = place.at ? { x: place.at.x + offset, y: place.at.y + offset } : undefined;
        await addPicture(r.src, r.w, r.h, {}, at, i === 0 ? place.target : null);
      }
    } catch (e) {
      toast((e as Error).message);
    }
  }
}

// ---- Templates / generated pages -----------------------------------------------

async function templateCtx(route: RouteDoc | null) {
  const { doc, photos, event } = useEditor.getState();
  if (route) await ensureRouteGeom(route);
  return { W: doc!.width, H: doc!.height, route, photos, eventName: event?.name ?? doc!.name };
}

export async function applyTemplate(id: string, route: RouteDoc | null) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return;
  const content = await t.build(await templateCtx(route));
  useEditor.getState().replacePage(content);
}

/** One route-plan page per route — the layout from the organiser's PDF. */
export async function generateRoutePages(routes: RouteDoc[], dark = true) {
  const t = TEMPLATES.find((x) => x.id === (dark ? 'route-dark' : 'route-light'))!;
  const pages: PageContent[] = [];
  for (const r of routes) pages.push(await t.build(await templateCtx(r)));
  useEditor.getState().appendPages(pages, true);
  const missing = routes.filter((r) => !getGeom(r._id)).length;
  if (missing) toast(`โหลดไม่ได้ ${missing} เส้นทาง`);
}

