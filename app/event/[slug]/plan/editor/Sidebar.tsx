'use client';

/**
 * Left sidebar: an icon rail plus a drawer for the active tab. Items can be
 * clicked (added to the page centre / into the selected empty slot) or
 * dragged onto the canvas.
 */
import { useMemo, useRef, useState } from 'react';
import type { PhotoDoc, RouteDoc } from '@/lib/types';
import type { Background, MapElement, PlanElement, ShapeKind } from './types';
import { FONTS, formatKm, GRADIENTS, ICONS, makeIcon, makeLine, makeShape, makeText, SWATCHES, uid } from './constants';
import { useEditor, usePageElements, type SidebarTab } from './store';
import { getGeom, useAssetVersion } from './runtime';
import {
  activeMap,
  addEventPhoto,
  addEventPhotos,
  addMap,
  addPicture,
  applyTemplate,
  generateRoutePages,
  layoutAroundMap,
  toast,
  uploadFiles,
} from './actions';
import { locatePhoto, TEMPLATES } from './builders';
import { draggableItem } from './dnd';
import LayersPanel from './LayersPanel';
import { ColorField, headlineFont, Icon, PrimaryBtn, Section, Slider, SoftBtn } from './ui';

const TABS: { id: SidebarTab; icon: string; label: string }[] = [
  { id: 'templates', icon: 'dashboard', label: 'เทมเพลต' },
  { id: 'maps', icon: 'map', label: 'แผนที่' },
  { id: 'photos', icon: 'photo_library', label: 'รูปงาน' },
  { id: 'elements', icon: 'category', label: 'องค์ประกอบ' },
  { id: 'text', icon: 'title', label: 'ข้อความ' },
  { id: 'uploads', icon: 'cloud_upload', label: 'อัปโหลด' },
  { id: 'background', icon: 'format_paint', label: 'พื้นหลัง' },
  { id: 'layers', icon: 'layers', label: 'เลเยอร์' },
];

export default function Sidebar() {
  const tab = useEditor((s) => s.sidebarTab);
  const setTab = useEditor((s) => s.setSidebarTab);

  return (
    <div className="relative flex h-full shrink-0">
      <nav className="pe-scroll flex w-[60px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[var(--pe-border-soft)] bg-[var(--pe-surface)] py-2 md:w-[72px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(tab === t.id ? null : t.id)}
            data-tip={t.label}
            data-tip-side="right"
            aria-label={t.label}
            aria-pressed={tab === t.id}
            className={`flex w-[52px] flex-col items-center gap-0.5 rounded-xl py-2 text-[var(--pe-text-soft)] transition-colors hover:bg-[var(--pe-hover)] md:w-[62px] ${
              tab === t.id ? 'bg-[var(--pe-primary-soft)] !text-[var(--pe-primary)]' : ''
            }`}
          >
            <Icon name={t.icon} size={22} filled={tab === t.id} />
            <span className="text-[9px] font-semibold leading-tight md:text-[10px]">{t.label}</span>
          </button>
        ))}
      </nav>
      {tab && (
        <div className="pe-scroll absolute left-[60px] top-0 z-30 h-full w-[min(300px,calc(100vw-60px))] overflow-y-auto border-r border-[var(--pe-border-soft)] bg-[var(--pe-panel)] shadow-xl md:static md:z-auto md:w-[300px] md:shadow-none">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--pe-border-soft)] bg-[var(--pe-panel)] px-4 py-3">
            <h2 className="text-sm font-bold text-[var(--pe-text)]" style={headlineFont}>
              {TABS.find((t) => t.id === tab)?.label}
            </h2>
            <button
              type="button"
              onClick={() => setTab(null)}
              data-tip="ซ่อนแผง"
              aria-label="ซ่อนแผง"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--pe-muted)] hover:bg-[var(--pe-hover)]"
            >
              <Icon name="chevron_left" />
            </button>
          </div>
          {tab === 'templates' && <TemplatesTab />}
          {tab === 'maps' && <MapsTab />}
          {tab === 'photos' && <PhotosTab />}
          {tab === 'elements' && <ElementsTab />}
          {tab === 'text' && <TextTab />}
          {tab === 'uploads' && <UploadsTab />}
          {tab === 'background' && <BackgroundTab />}
          {tab === 'layers' && <LayersPanel />}
        </div>
      )}
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------------------

const pageDims = () => {
  const d = useEditor.getState().doc!;
  return { W: d.width, H: d.height, u: Math.min(d.width, d.height) };
};

/** Centre an element on a point (default: page centre) and add it. */
function place(el: PlanElement, at?: { x: number; y: number }) {
  const { W, H } = pageDims();
  const c = at ?? { x: W / 2, y: H / 2 };
  el.x = c.x - el.width / 2;
  el.y = c.y - el.height / 2;
  useEditor.getState().addElements([el]);
}

function placeGroup(els: PlanElement[], at?: { x: number; y: number }) {
  const { W, H } = pageDims();
  const c = at ?? { x: W / 2, y: H / 2 };
  const minX = Math.min(...els.map((e) => e.x));
  const minY = Math.min(...els.map((e) => e.y));
  const maxX = Math.max(...els.map((e) => e.x + e.width));
  const maxY = Math.max(...els.map((e) => e.y + e.height));
  const gid = uid();
  els.forEach((e) => {
    e.x += c.x - (minX + maxX) / 2;
    e.y += c.y - (minY + maxY) / 2;
    e.groupId = gid;
  });
  useEditor.getState().addElements(els);
}

function useRouteDistance(r: RouteDoc) {
  useAssetVersion();
  const g = getGeom(r._id);
  return g ? `${g.total.toFixed(1)} km · ${g.cps.length} CP` : 'กำลังโหลด…';
}

function RouteRow({ r, checked, onToggle }: { r: RouteDoc; checked: boolean; onToggle: () => void }) {
  const info = useRouteDistance(r);
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--pe-border-soft)] px-3 py-2.5 hover:bg-[var(--pe-hover)]">
      <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 accent-[var(--pe-primary)]" />
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--pe-text)]">{r.name}</span>
        <span className="block text-[11px] text-[var(--pe-muted)]">{info}</span>
      </span>
    </label>
  );
}

const Empty = ({ icon, text }: { icon: string; text: string }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-xs text-[var(--pe-muted)]">
    <Icon name={icon} size={36} />
    {text}
  </div>
);

// ---- Templates ----------------------------------------------------------------------------

function TemplatesTab() {
  const routes = useEditor((s) => s.routes);
  const [routeId, setRouteId] = useState<string>('');
  const route = routes.find((r) => r._id === routeId) ?? routes[0] ?? null;
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {routes.length > 0 && (
        <Section title="สร้างอัตโนมัติ">
          <PrimaryBtn
            icon="auto_awesome"
            className="w-full py-2.5"
            disabled={!!busy}
            tip="หน้าละ 1 เส้นทาง: แผนที่ + รูป + เส้นชี้ + ระยะ km"
            onClick={() => run('all', () => generateRoutePages(routes, true))}
          >
            {busy === 'all' ? 'กำลังสร้าง…' : `สร้างแผนงานทุกเส้นทาง (${routes.length} หน้า)`}
          </PrimaryBtn>
          <p className="text-[11px] leading-relaxed text-[var(--pe-muted)]">
            จัดรูปที่ถ่ายบนเส้นทางไว้รอบแผนที่ พร้อมเส้นประชี้ไปยังจุดบนเส้นทางและระยะทาง
          </p>
        </Section>
      )}
      <Section title="เทมเพลต">
        {routes.length > 0 && (
          <label className="flex items-center justify-between gap-2 text-xs text-[var(--pe-text-soft)]">
            เส้นทางที่ใช้
            <select
              value={route?._id ?? ''}
              onChange={(e) => setRouteId(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] px-2 text-xs text-[var(--pe-text)]"
              data-tip="เทมเพลตจะใช้เส้นทางนี้"
            >
              {routes.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="text-[11px] text-[var(--pe-muted)]">คลิกเพื่อแทนที่หน้าปัจจุบัน (ย้อนกลับได้ด้วย Ctrl+Z)</p>
        <div className="grid grid-cols-2 gap-2.5">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={!!busy}
              data-tip={t.name}
              onClick={() => run(t.id, () => applyTemplate(t.id, route))}
              className="group overflow-hidden rounded-xl border border-[var(--pe-border-soft)] text-left transition-shadow hover:shadow-md disabled:opacity-60"
            >
              <div
                className="relative flex aspect-[4/3] items-center justify-center"
                style={{ background: t.preview.bg, color: t.preview.fg }}
              >
                <Icon name={t.preview.icon} size={34} className="transition-transform group-hover:scale-110" />
                <span className="absolute bottom-2 left-2 h-1.5 w-10 rounded-full" style={{ background: t.preview.fg }} />
                <span className="absolute bottom-5 left-2 h-1.5 w-6 rounded-full opacity-60" style={{ background: t.preview.fg }} />
                {busy === t.id && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Icon name="progress_activity" className="animate-spin text-white" />
                  </span>
                )}
              </div>
              <p className="truncate px-2 py-1.5 text-[11px] font-semibold text-[var(--pe-text)]">{t.name}</p>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---- Maps -------------------------------------------------------------------------------------

function MapsTab() {
  const routes = useEditor((s) => s.routes);
  const elements = usePageElements();
  const selectedIds = useEditor((s) => s.selectedIds);
  const selectedMap = elements.find((e) => e.type === 'map' && selectedIds.includes(e.id)) as MapElement | undefined;
  const [picked, setPicked] = useState<string[]>([]);
  const ids = picked.length ? picked : routes.slice(0, 1).map((r) => r._id);

  if (!routes.length) return <Empty icon="route" text="งานนี้ยังไม่มีไฟล์ GPX — อัปโหลดเส้นทางที่หน้าแผนที่ก่อน" />;

  const toggle = (id: string) => setPicked(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

  return (
    <>
      <Section title="เลือกเส้นทาง (ติ๊กได้หลายเส้น)">
        {routes.map((r) => (
          <RouteRow key={r._id} r={r} checked={ids.includes(r._id)} onToggle={() => toggle(r._id)} />
        ))}
        <PrimaryBtn icon="add_location_alt" className="w-full py-2.5" disabled={!ids.length} onClick={() => void addMap(ids)}>
          เพิ่มผังแผนที่ ({ids.length} เส้นทาง)
        </PrimaryBtn>
        {selectedMap && (
          <SoftBtn
            icon="sync_alt"
            className="w-full"
            disabled={!ids.length}
            onClick={() => useEditor.getState().updateElement(selectedMap.id, { routeIds: ids } as Partial<PlanElement>)}
          >
            ใช้กับแผนที่ที่เลือกอยู่
          </SoftBtn>
        )}
      </Section>
      <Section title="แผนงานอัตโนมัติ">
        <SoftBtn icon="auto_awesome" className="w-full" onClick={() => void generateRoutePages(routes.filter((r) => ids.includes(r._id)))}>
          สร้างหน้าละ 1 เส้นทาง (พื้นมืด)
        </SoftBtn>
        <SoftBtn icon="light_mode" className="w-full" onClick={() => void generateRoutePages(routes.filter((r) => ids.includes(r._id)), false)}>
          สร้างหน้าละ 1 เส้นทาง (พื้นสว่าง)
        </SoftBtn>
      </Section>
      <Section title="วิธีใช้เส้นชี้">
        <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-[var(--pe-muted)]">
          <li>เลือกรูป แล้วกด “ชี้ไปยังเส้นทาง” ในแผงขวา</li>
          <li>คลิกบนเส้นทางในแผนที่ — ปลายเส้นจะเกาะได้เฉพาะบนเส้นทางเท่านั้น</li>
          <li>ลากจุดปลายเพื่อย้ายไปตามเส้นทาง ปรับเส้นประ/ทึบ/ความหนาได้</li>
        </ol>
      </Section>
    </>
  );
}

// ---- Event photos -----------------------------------------------------------------------------

function PhotosTab() {
  const photos = useEditor((s) => s.photos);
  const elements = usePageElements();
  const version = useAssetVersion();
  const [checked, setChecked] = useState<string[]>([]);
  const [nearOnly, setNearOnly] = useState(false);
  const map = elements.find((e) => e.type === 'map') as MapElement | undefined;
  const mapRoutes = map?.routeIds.join() ?? '';

  // Distance along the page's map route for each photo (if a map exists).
  const located = useMemo(() => {
    void version;
    const m = activeMap();
    return new Map(
      photos.map((p) => {
        const loc = m ? locatePhoto(m, p.lat, p.lng) : null;
        return [p._id, loc && loc.offM < 500 ? loc.d : null] as const;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, mapRoutes, version]);

  const list = useMemo(() => {
    const l = nearOnly ? photos.filter((p) => located.get(p._id) != null) : photos.slice();
    if (map) l.sort((a, b) => (located.get(a._id) ?? Infinity) - (located.get(b._id) ?? Infinity));
    return l;
  }, [photos, nearOnly, located, map]);

  if (!photos.length) return <Empty icon="photo_camera" text="งานนี้ยังไม่มีรูป — อัปโหลดรูปที่หน้าแผนที่ หรือใช้แท็บ “อัปโหลด”" />;

  const picked = photos.filter((p) => checked.includes(p._id));
  const toggle = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  return (
    <>
      <div className="sticky top-[49px] z-10 space-y-2 border-b border-[var(--pe-border-soft)] bg-[var(--pe-panel)] px-4 py-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--pe-text-soft)]">
            เลือกแล้ว <b className="text-[var(--pe-primary)]">{checked.length}</b> / {list.length}
          </span>
          <button
            type="button"
            className="font-semibold text-[var(--pe-primary)]"
            onClick={() => setChecked(checked.length ? [] : list.map((p) => p._id))}
          >
            {checked.length ? 'ล้าง' : 'เลือกทั้งหมด'}
          </button>
        </div>
        {map && (
          <label className="flex items-center gap-2 text-[11px] text-[var(--pe-text-soft)]">
            <input type="checkbox" checked={nearOnly} onChange={(e) => setNearOnly(e.target.checked)} className="accent-[var(--pe-primary)]" />
            เฉพาะรูปที่อยู่บนเส้นทางของแผนที่หน้านี้
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <SoftBtn icon="add_photo_alternate" disabled={!picked.length} onClick={() => void addEventPhotos(picked)}>
            เพิ่มลงหน้า
          </SoftBtn>
          <PrimaryBtn
            icon="conversion_path"
            disabled={!picked.length}
            tip="จัดรูปรอบแผนที่ พร้อมเส้นชี้และระยะ km"
            onClick={() => {
              if (!map) return toast('เพิ่มแผนที่ลงหน้านี้ก่อน (แท็บ “แผนที่”)');
              void layoutAroundMap(picked).then(() => setChecked([]));
            }}
          >
            จัดรอบแผนที่
          </PrimaryBtn>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 p-3">
        {list.map((p) => (
          <PhotoTile key={p._id} p={p} km={located.get(p._id) ?? null} checked={checked.includes(p._id)} onToggle={() => toggle(p._id)} />
        ))}
      </div>
    </>
  );
}

function PhotoTile({ p, km, checked, onToggle }: { p: PhotoDoc; km: number | null; checked: boolean; onToggle: () => void }) {
  return (
    <div
      className={`group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-lg bg-[var(--pe-hover)] ring-offset-1 ring-offset-[var(--pe-panel)] ${checked ? 'ring-2 ring-[var(--pe-primary)]' : ''}`}
      data-tip="คลิกเพื่อเพิ่ม · ลากไปวางบนหน้าได้"
      onClick={() => void addEventPhoto(p)}
      {...draggableItem((at, target) => void addEventPhoto(p, at, target))}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" draggable={false} />
      <button
        type="button"
        aria-label={checked ? 'ยกเลิกเลือก' : 'เลือกรูปนี้'}
        aria-pressed={checked}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md border-2 shadow ${
          checked ? 'border-[var(--pe-primary)] bg-[var(--pe-primary)] text-white' : 'border-white bg-black/25 text-transparent'
        }`}
      >
        <Icon name="check" size={18} />
      </button>
      {km != null && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-bold text-white" style={headlineFont}>
          {formatKm(km)}
        </span>
      )}
    </div>
  );
}

// ---- Elements -----------------------------------------------------------------------------------

const SHAPES: { kind: ShapeKind; label: string; svg: React.ReactNode; radius?: boolean }[] = [
  { kind: 'rect', label: 'สี่เหลี่ยม', svg: <rect x="3" y="5" width="18" height="14" /> },
  { kind: 'rect', label: 'สี่เหลี่ยมมุมมน', radius: true, svg: <rect x="3" y="5" width="18" height="14" rx="4" /> },
  { kind: 'circle', label: 'วงกลม', svg: <circle cx="12" cy="12" r="9" /> },
  { kind: 'triangle', label: 'สามเหลี่ยม', svg: <path d="M12 3l9 18H3z" /> },
  { kind: 'star', label: 'ดาว', svg: <path d="M12 2.5l2.8 6.3 6.7.6-5.1 4.4 1.6 6.6L12 16.9l-6 3.5 1.6-6.6-5.1-4.4 6.7-.6z" /> },
  { kind: 'diamond', label: 'สี่เหลี่ยมขนมเปียกปูน', svg: <path d="M12 2l10 10-10 10L2 12z" /> },
  { kind: 'hexagon', label: 'หกเหลี่ยม', svg: <path d="M7 3h10l5 9-5 9H7l-5-9z" /> },
];

const LINES: { label: string; opts: Parameters<typeof makeLine>[3]; dash?: string; caps?: [string, string] }[] = [
  { label: 'เส้นทึบ', opts: {} },
  { label: 'เส้นประ', opts: { dash: 'dashed' }, dash: '4 3' },
  { label: 'จุดไข่ปลา', opts: { dash: 'dotted' }, dash: '0.1 3' },
  { label: 'ลูกศร', opts: { endCap: 'arrow' }, caps: ['', 'arrow'] },
  { label: 'ลูกศรสองทาง', opts: { endCap: 'arrow', startCap: 'arrow' }, caps: ['arrow', 'arrow'] },
  { label: 'เส้นปลายจุด', opts: { endCap: 'dot', dash: 'dashed' }, dash: '4 3', caps: ['', 'dot'] },
];

function ElementsTab() {
  const addShape = (s: (typeof SHAPES)[number], at?: { x: number; y: number }) => {
    const el = makeShape(s.kind, 0, 0, pageDims().u * 0.2);
    if (s.radius) el.cornerRadius = el.width * 0.15;
    place(el, at);
  };
  const addLine = (l: (typeof LINES)[number], at?: { x: number; y: number }) => place(makeLine(0, 0, pageDims().u * 0.3, l.opts), at);
  const addIcon = (k: string, at?: { x: number; y: number }) => place(makeIcon(k, 0, 0, pageDims().u * 0.1), at);
  const addBadge = (at?: { x: number; y: number }) => {
    const { u } = pageDims();
    const box = makeShape('rect', 0, 0, 0);
    Object.assign(box, { width: u * 0.32, height: u * 0.075, fill: '#ef4444', cornerRadius: u * 0.012 });
    const t = makeText('UMY-164.4KM', 0, u * 0.014, { fontSize: u * 0.042, bold: true, fill: '#ffffff', align: 'center', fontFamily: 'Kanit' }, u * 0.32);
    placeGroup([box, t], at);
  };
  const addCarLabel = (at?: { x: number; y: number }) => {
    const { u } = pageDims();
    const icon = makeIcon('car', 0, 0, u * 0.05);
    icon.fill = '#ef4444';
    const t = makeText('Car 1', u * 0.06, u * 0.002, { fontSize: u * 0.038, bold: true, fill: '#ef4444', fontFamily: 'Kanit' }, u * 0.16);
    placeGroup([icon, t], at);
  };

  return (
    <>
      <Section title="รูปทรง">
        <div className="grid grid-cols-4 gap-2">
          {SHAPES.map((s) => (
            <button
              key={s.label}
              type="button"
              data-tip={s.label}
              aria-label={s.label}
              onClick={() => addShape(s)}
              {...draggableItem((at) => addShape(s, at))}
              className="flex aspect-square items-center justify-center rounded-lg bg-[var(--pe-hover)] text-[var(--pe-primary)] hover:bg-[var(--pe-active)]"
            >
              <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current">
                {s.svg}
              </svg>
            </button>
          ))}
        </div>
      </Section>
      <Section title="เส้นและลูกศร">
        <div className="grid grid-cols-3 gap-2">
          {LINES.map((l) => (
            <button
              key={l.label}
              type="button"
              data-tip={l.label}
              aria-label={l.label}
              onClick={() => addLine(l)}
              {...draggableItem((at) => addLine(l, at))}
              className="flex h-12 items-center justify-center rounded-lg bg-[var(--pe-hover)] text-[var(--pe-text)] hover:bg-[var(--pe-active)]"
            >
              <svg viewBox="0 0 48 12" className="h-4 w-12 stroke-current" strokeWidth="2" strokeLinecap="round" fill="none">
                <line x1={l.caps?.[0] ? 6 : 3} y1="6" x2={l.caps?.[1] ? 40 : 45} y2="6" strokeDasharray={l.dash} />
                {l.caps?.[1] === 'arrow' && <path d="M38 2l7 4-7 4z" className="fill-current" strokeWidth="0" />}
                {l.caps?.[0] === 'arrow' && <path d="M10 2L3 6l7 4z" className="fill-current" strokeWidth="0" />}
                {l.caps?.[1] === 'dot' && <circle cx="43" cy="6" r="3" className="fill-current" strokeWidth="0" />}
              </svg>
            </button>
          ))}
        </div>
      </Section>
      <Section title="ป้ายสำเร็จรูป">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            data-tip="ป้ายชื่อระยะ"
            onClick={() => addBadge()}
            {...draggableItem((at) => addBadge(at))}
            className="flex h-12 items-center justify-center rounded-lg bg-[#ef4444] text-xs font-bold text-white"
            style={{ fontFamily: 'Kanit' }}
          >
            UMY-164.4KM
          </button>
          <button
            type="button"
            data-tip="ป้ายรถ"
            onClick={() => addCarLabel()}
            {...draggableItem((at) => addCarLabel(at))}
            className="flex h-12 items-center justify-center gap-1 rounded-lg bg-[var(--pe-hover)] text-sm font-bold text-[#ef4444]"
            style={{ fontFamily: 'Kanit' }}
          >
            <Icon name="directions_car" filled /> Car 1
          </button>
        </div>
      </Section>
      <Section title="ไอคอน">
        <div className="grid grid-cols-5 gap-1.5">
          {Object.entries(ICONS).map(([k, ic]) => (
            <button
              key={k}
              type="button"
              data-tip={ic.label}
              aria-label={ic.label}
              onClick={() => addIcon(k)}
              {...draggableItem((at) => addIcon(k, at))}
              className="flex aspect-square items-center justify-center rounded-lg text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)] hover:text-[var(--pe-primary)]"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                <path d={ic.path} />
              </svg>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---- Text ------------------------------------------------------------------------------------------

function TextTab() {
  const presets = [
    { label: 'เพิ่มหัวข้อ', text: 'หัวข้อ', k: 0.075, style: { bold: true, fontFamily: 'Kanit' }, cls: 'text-xl font-bold', font: 'Kanit' },
    { label: 'เพิ่มหัวข้อย่อย', text: 'หัวข้อย่อย', k: 0.045, style: { bold: true, fontFamily: 'Prompt' }, cls: 'text-base font-semibold', font: 'Prompt' },
    { label: 'เพิ่มเนื้อหา', text: 'พิมพ์ข้อความที่นี่', k: 0.028, style: { fontFamily: 'Sarabun' }, cls: 'text-sm', font: 'Sarabun' },
  ];
  const combos = [
    { text: '108KM', k: 0.05, style: { bold: true, fill: '#ef4444', fontFamily: 'Kanit' } },
    { text: 'SAT 09.00 - 15.00', k: 0.03, style: { bold: true, fill: '#737687', fontFamily: 'Prompt' } },
    { text: 'Car 1', k: 0.045, style: { bold: true, fill: '#22c55e', fontFamily: 'Kanit' } },
    { text: 'ROUTE MAP', k: 0.035, style: { bold: true, fill: '#004cca', fontFamily: 'Space Grotesk', letterSpacing: 6 } },
    { text: 'จุดเช็กพอยต์', k: 0.045, style: { bold: true, fill: '#ffffff', fontFamily: 'Kanit' }, stroke: '#191b24' },
  ];
  const add = (text: string, k: number, style: Record<string, unknown>, at?: { x: number; y: number }, stroke?: string) => {
    const { u } = pageDims();
    const el = makeText(text, 0, 0, { fontSize: Math.round(u * k), ...style });
    if (stroke) Object.assign(el, { stroke, strokeWidth: Math.max(2, el.fontSize / 10) });
    place(el, at);
  };
  return (
    <>
      <Section title="ข้อความ">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => add(p.text, p.k, p.style)}
            {...draggableItem((at) => add(p.text, p.k, p.style, at))}
            className={`w-full rounded-lg bg-[var(--pe-hover)] px-3 py-3 text-left text-[var(--pe-text)] hover:bg-[var(--pe-active)] ${p.cls}`}
            style={{ fontFamily: p.font }}
            data-tip="คลิกหรือลากไปวาง"
          >
            {p.label}
          </button>
        ))}
      </Section>
      <Section title="สไตล์สำเร็จรูป">
        <div className="grid grid-cols-2 gap-2">
          {combos.map((c) => (
            <button
              key={c.text}
              type="button"
              onClick={() => add(c.text, c.k, c.style, undefined, c.stroke)}
              {...draggableItem((at) => add(c.text, c.k, c.style, at, c.stroke))}
              className="flex h-14 items-center justify-center rounded-lg bg-[#191b24] px-2 text-center text-sm"
              style={{
                fontFamily: c.style.fontFamily,
                fontWeight: 700,
                color: c.style.fill,
                letterSpacing: c.style.letterSpacing ? 2 : undefined,
                WebkitTextStroke: c.stroke ? `0.5px ${c.stroke}` : undefined,
              }}
            >
              {c.text}
            </button>
          ))}
        </div>
      </Section>
      <Section title="ฟอนต์ที่รองรับ">
        <div className="flex flex-wrap gap-1.5">
          {FONTS.map((f) => (
            <span key={f.family} className="rounded-md bg-[var(--pe-hover)] px-2 py-1 text-xs text-[var(--pe-text-soft)]" style={{ fontFamily: f.family }}>
              {f.family}
              {f.thai ? ' ไทย' : ''}
            </span>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---- Uploads ---------------------------------------------------------------------------------------

function UploadsTab() {
  const uploads = useEditor((s) => s.doc?.uploads ?? []);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <>
      <div className="p-4">
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void uploadFiles(Array.from(e.dataTransfer.files));
          }}
          data-tip="เลือกไฟล์ หรือ ลากไฟล์มาวาง"
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-xs transition-colors ${
            over ? 'border-[var(--pe-primary)] bg-[var(--pe-primary-soft)]' : 'border-[var(--pe-border)] text-[var(--pe-muted)]'
          }`}
        >
          <Icon name="cloud_upload" size={32} className="text-[var(--pe-primary)]" />
          <span className="font-semibold text-[var(--pe-text)]">อัปโหลดรูปภาพ</span>
          ลากไฟล์มาวางที่นี่ หรือบนหน้ากระดาษได้เลย
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.currentTarget.value = '';
          }}
        />
        <p className="mt-2 text-[11px] text-[var(--pe-muted)]">รูปจะเก็บไว้ในงานนี้บนเครื่องของคุณ · วางรูปจากคลิปบอร์ดด้วย Ctrl+V ได้</p>
      </div>
      {uploads.length > 0 && (
        <div className="grid grid-cols-2 gap-2 px-3 pb-4">
          {uploads.map((u) => (
            <div
              key={u.id}
              className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-lg bg-[var(--pe-hover)]"
              data-tip={u.name}
              onClick={() => void addPicture(u.src, u.width, u.height)}
              {...draggableItem((at, target) => void addPicture(u.src, u.width, u.height, {}, at, target))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u.src} alt={u.name} className="h-full w-full object-cover" draggable={false} />
              <button
                type="button"
                aria-label="ลบออกจากคลัง"
                data-tip="ลบออกจากคลัง"
                onClick={(e) => {
                  e.stopPropagation();
                  useEditor.getState().removeUpload(u.id);
                }}
                className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---- Background -------------------------------------------------------------------------------------

function BackgroundTab() {
  const bg = useEditor((s) => s.doc!.pages[s.pageIndex].background);
  const uploads = useEditor((s) => s.doc?.uploads ?? []);
  const photos = useEditor((s) => s.photos);
  const set = (b: Background, key = 'bg') => {
    const st = useEditor.getState();
    st.commit(key);
    const pages = st.doc!.pages.map((p, i) => (i === st.pageIndex ? { ...p, background: b } : p));
    useEditor.setState({ doc: { ...st.doc!, pages } });
  };
  const images = [...uploads.map((u) => u.src), ...photos.slice(0, 24).map((p) => p.url)];

  return (
    <>
      <Section title="สีพื้น">
        <div className="grid grid-cols-7 gap-1.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              data-tip={c}
              aria-label={c}
              onClick={() => set({ type: 'color', color: c })}
              className={`aspect-square rounded-md border border-black/10 ${bg.type === 'color' && bg.color === c ? 'ring-2 ring-[var(--pe-primary)] ring-offset-1' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--pe-text-soft)]">
          <ColorField value={bg.type === 'color' ? bg.color : '#ffffff'} onChange={(c) => c && set({ type: 'color', color: c }, 'bg-color')} tip="สีกำหนดเอง" />
          สีกำหนดเอง
        </div>
      </Section>
      <Section title="ไล่สี">
        <div className="grid grid-cols-4 gap-2">
          {GRADIENTS.map((g, i) => (
            <button
              key={i}
              type="button"
              data-tip="ไล่สี"
              aria-label="ไล่สี"
              onClick={() => set({ type: 'gradient', ...g })}
              className="aspect-square rounded-lg border border-black/10"
              style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` }}
            />
          ))}
        </div>
        {bg.type === 'gradient' && (
          <>
            <div className="flex items-center gap-2 text-xs text-[var(--pe-text-soft)]">
              <ColorField value={bg.from} onChange={(c) => c && set({ ...bg, from: c }, 'bg-from')} tip="สีเริ่ม" />
              <Icon name="arrow_forward" size={16} />
              <ColorField value={bg.to} onChange={(c) => c && set({ ...bg, to: c }, 'bg-to')} tip="สีปลาย" />
            </div>
            <Slider label="มุม" value={bg.angle} min={0} max={360} onChange={(v) => set({ ...bg, angle: v }, 'bg-angle')} format={(v) => `${v}°`} />
          </>
        )}
      </Section>
      <Section title="รูปพื้นหลัง">
        {images.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {images.map((src) => (
              <button
                key={src}
                type="button"
                data-tip="ใช้เป็นพื้นหลัง"
                onClick={() => set({ type: 'image', src, dim: bg.type === 'image' ? bg.dim : 0.3 })}
                className={`aspect-square overflow-hidden rounded-md ${bg.type === 'image' && bg.src === src ? 'ring-2 ring-[var(--pe-primary)]' : ''}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--pe-muted)]">อัปโหลดรูปในแท็บ “อัปโหลด” เพื่อใช้เป็นพื้นหลัง</p>
        )}
        {bg.type === 'image' && (
          <Slider label="ความมืด" value={bg.dim} min={0} max={0.9} step={0.01} onChange={(v) => set({ ...bg, dim: v }, 'bg-dim')} format={(v) => `${Math.round(v * 100)}%`} />
        )}
      </Section>
      <div className="p-4">
        <SoftBtn icon="select_all" className="w-full" onClick={() => useEditor.getState().setBackground(bg, true)}>
          ใช้พื้นหลังนี้กับทุกหน้า
        </SoftBtn>
      </div>
    </>
  );
}
