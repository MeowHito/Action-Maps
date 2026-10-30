'use client';

/**
 * Settings for the current selection. `ContextBar` is the slim strip above
 * the canvas with quick actions; `PropertiesPanel` is the full right panel.
 */
import { useRef, useState } from 'react';
import type {
  AttachSide,
  Basemap,
  CaptionPosition,
  ConnectorElement,
  ConnectorRouting,
  ImageElement,
  LineCap,
  LineElement,
  MapElement,
  PlanElement,
  ShapeElement,
  TextElement,
  TextStyle,
} from './types';
import { DASH_STYLES, dashArray, elementLabel, FONTS, formatKm, SIZE_PRESETS } from './constants';
import { useEditor, usePageElements, type AlignKind } from './store';
import { getGeom, useAssetVersion } from './runtime';
import { captionWithKm, connectToPhotoLocation, fillImage, readImageFile, toast } from './actions';
import {
  ColorField,
  headlineFont,
  Icon,
  IconBtn,
  NumField,
  PrimaryBtn,
  Row,
  Section,
  Seg,
  Select,
  Slider,
  SoftBtn,
  Toggle,
} from './ui';

type Patch = Partial<PlanElement>;
const st = useEditor.getState;
const up = (id: string, patch: Patch, key?: string) => st().updateElement(id, patch, key ?? true);

function useSelection() {
  const elements = usePageElements();
  const ids = useEditor((s) => s.selectedIds);
  return elements.filter((e) => ids.includes(e.id));
}

// ---- Context bar ---------------------------------------------------------------------------

export function ContextBar() {
  const sel = useSelection();
  const propsOpen = useEditor((s) => s.propsOpen);
  const doc = useEditor((s) => s.doc)!;
  const pageIndex = useEditor((s) => s.pageIndex);
  const single = sel.length === 1 ? sel[0] : null;
  const locked = sel.some((e) => e.locked);
  const grouped = sel.length > 1 && sel.every((e) => e.groupId && e.groupId === sel[0].groupId);

  return (
    <div className="pe-scroll flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--pe-border-soft)] bg-[var(--pe-surface)] px-2">
      {!sel.length ? (
        <span className="px-2 text-xs text-[var(--pe-muted)]">
          หน้า {pageIndex + 1} · {doc.width} × {doc.height} px — คลิกวัตถุเพื่อแก้ไข
        </span>
      ) : (
        <>
          <span className="whitespace-nowrap px-2 text-xs font-semibold text-[var(--pe-text)]" style={headlineFont}>
            {single ? elementLabel(single as never) : `เลือก ${sel.length} ชิ้น`}
          </span>
          {single?.type === 'text' && <TextQuick el={single} />}
          {single?.type === 'image' && (
            <>
              <SoftBtn icon="crop" disabled={!single.src || locked} onClick={() => st().setCrop(single.id)} tip="ครอปรูป (ดับเบิลคลิก)">
                ครอป
              </SoftBtn>
              <SoftBtn
                icon="conversion_path"
                disabled={locked}
                onClick={() => st().setTool({ mode: 'connect', fromId: single.id })}
                tip="ลากเส้นชี้ไปยังจุดบนเส้นทาง"
              >
                ชี้ไปยังเส้นทาง
              </SoftBtn>
            </>
          )}
          <div className="mx-1 h-6 w-px shrink-0 bg-[var(--pe-border)]" />
          {sel.length > 1 && (
            <IconBtn icon={grouped ? 'ungroup' : 'join'} tip={grouped ? 'แยกกลุ่ม (Ctrl+Shift+G)' : 'จัดกลุ่ม (Ctrl+G)'} onClick={() => (grouped ? st().ungroup() : st().group())} />
          )}
          <IconBtn icon="flip_to_front" tip="ดึงขึ้นหน้า" onClick={() => st().arrange('forward')} />
          <IconBtn icon="flip_to_back" tip="ส่งไปหลัง" onClick={() => st().arrange('backward')} />
          <IconBtn icon="content_copy" tip="ทำสำเนา (Ctrl+D)" onClick={() => st().duplicate(sel.map((e) => e.id))} />
          <IconBtn icon={locked ? 'lock' : 'lock_open'} tip={locked ? 'ปลดล็อก' : 'ล็อก'} active={locked} onClick={() => st().toggleLock(sel.map((e) => e.id))} />
          <IconBtn icon="delete" tip="ลบ (Delete)" onClick={() => st().deleteElements(sel.map((e) => e.id))} />
        </>
      )}
      <div className="flex-1" />
      <IconBtn icon="tune" tip="แผงคุณสมบัติ" active={propsOpen} onClick={() => st().setPropsOpen(!propsOpen)} className="lg:hidden" />
    </div>
  );
}

function TextQuick({ el }: { el: TextElement }) {
  return (
    <div className="flex items-center gap-1">
      <FontSelect value={el.fontFamily} onChange={(f) => up(el.id, { fontFamily: f })} />
      <NumField value={el.fontSize} min={4} onChange={(v) => up(el.id, { fontSize: v })} tip="ขนาดตัวอักษร" className="w-14" />
      <ColorField value={el.fill} onChange={(c) => c && up(el.id, { fill: c }, `${el.id}:fill`)} tip="สีตัวอักษร" />
      <IconBtn icon="format_bold" tip="ตัวหนา" active={el.bold} onClick={() => up(el.id, { bold: !el.bold })} />
      <IconBtn icon="format_italic" tip="ตัวเอียง" active={el.italic} onClick={() => up(el.id, { italic: !el.italic })} />
    </div>
  );
}

function FontSelect({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  return (
    <Select
      value={value}
      onChange={onChange}
      tip="ฟอนต์"
      className="w-36"
      style={{ fontFamily: value }}
      options={FONTS.map((f) => ({ value: f.family, label: `${f.family}${f.thai ? ' · ไทย' : ''}`, style: { fontFamily: f.family } }))}
    />
  );
}

// ---- Right panel -----------------------------------------------------------------------------

export default function PropertiesPanel() {
  const sel = useSelection();
  const open = useEditor((s) => s.propsOpen);
  const single = sel.length === 1 ? sel[0] : null;

  return (
    <aside
      className={`pe-scroll absolute right-0 top-0 z-30 h-full w-[min(300px,100vw)] overflow-y-auto border-l border-[var(--pe-border-soft)] bg-[var(--pe-panel)] shadow-xl lg:static lg:z-auto lg:block lg:w-[288px] lg:shrink-0 lg:shadow-none ${
        open ? 'block' : 'hidden'
      }`}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--pe-border-soft)] bg-[var(--pe-panel)] px-4 py-3">
        <h2 className="text-sm font-bold text-[var(--pe-text)]" style={headlineFont}>
          {single ? elementLabel(single as never) : sel.length ? `เลือก ${sel.length} ชิ้น` : 'หน้ากระดาษ'}
        </h2>
        <IconBtn icon="close" tip="ปิดแผง" className="lg:hidden" onClick={() => st().setPropsOpen(false)} />
      </div>
      {!sel.length && <PageProps />}
      {sel.length > 1 && <MultiProps ids={sel.map((e) => e.id)} />}
      {single?.type === 'text' && <TextProps el={single} />}
      {single?.type === 'shape' && <ShapeProps el={single} />}
      {single?.type === 'line' && <LineProps el={single} />}
      {single?.type === 'icon' && (
        <Section title="ไอคอน">
          <Row label="สี">
            <ColorField value={single.fill} onChange={(c) => c && up(single.id, { fill: c }, `${single.id}:fill`)} tip="สีไอคอน" />
          </Row>
        </Section>
      )}
      {single?.type === 'image' && <ImageProps el={single} />}
      {single?.type === 'map' && <MapProps el={single} />}
      {single?.type === 'connector' && <ConnectorProps el={single} />}
      {single && single.type !== 'connector' && <Geometry el={single} />}
      {single && (
        <Section title="ความโปร่งใส">
          <Slider
            label="ความทึบ"
            value={single.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => up(single.id, { opacity: v }, `${single.id}:opacity`)}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Section>
      )}
    </aside>
  );
}

// ---- Page (nothing selected) ------------------------------------------------------------

function PageProps() {
  const doc = useEditor((s) => s.doc)!;
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  return (
    <>
      <Section title="ขนาดงาน">
        <div className="grid grid-cols-2 gap-1.5">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-tip={`${p.label} · ${p.hint}`}
              onClick={() => {
                setW(p.width);
                setH(p.height);
                st().resizeDoc(p.width, p.height);
              }}
              className={`rounded-lg border px-2 py-1.5 text-left text-[11px] ${
                doc.width === p.width && doc.height === p.height
                  ? 'border-[var(--pe-primary)] bg-[var(--pe-primary-soft)] text-[var(--pe-primary)]'
                  : 'border-[var(--pe-border-soft)] text-[var(--pe-text)] hover:bg-[var(--pe-hover)]'
              }`}
            >
              <b className="block">{p.label}</b>
              <span className="text-[var(--pe-muted)]">{p.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <NumField value={w} onChange={setW} min={100} tip="กว้าง (px)" prefix="W" className="w-20" />
          <NumField value={h} onChange={setH} min={100} tip="สูง (px)" prefix="H" className="w-20" />
          <SoftBtn onClick={() => st().resizeDoc(Math.round(w), Math.round(h))} tip="ปรับขนาดและย่อ/ขยายเนื้อหาให้พอดี">
            ใช้
          </SoftBtn>
        </div>
      </Section>
      <Section title="พื้นหลัง">
        <SoftBtn icon="format_paint" className="w-full" onClick={() => st().setSidebarTab('background')}>
          เปลี่ยนพื้นหลัง
        </SoftBtn>
      </Section>
      <Section title="คีย์ลัด">
        <ul className="space-y-1 text-[11px] text-[var(--pe-text-soft)]">
          {[
            ['Ctrl+Z / Ctrl+Y', 'ย้อน / ทำซ้ำ'],
            ['Ctrl+C / Ctrl+V', 'คัดลอก / วาง'],
            ['Ctrl+D', 'ทำสำเนา'],
            ['Ctrl+G', 'จัดกลุ่ม (Shift = แยก)'],
            ['Delete', 'ลบ'],
            ['ลูกศร', 'ขยับ 1px (Shift = 10px)'],
            ['Space + ลาก', 'เลื่อนหน้าจอ'],
            ['Ctrl + ล้อเมาส์', 'ซูม'],
            ['Alt ขณะลาก', 'ปิดเส้นนำแนว'],
          ].map(([k, v]) => (
            <li key={k} className="flex justify-between gap-2">
              <kbd className="rounded bg-[var(--pe-hover)] px-1.5 py-0.5 font-mono text-[10px]">{k}</kbd>
              <span>{v}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

// ---- Shared sections --------------------------------------------------------------------------

const ALIGNS: { kind: AlignKind; icon: string; tip: string }[] = [
  { kind: 'left', icon: 'align_horizontal_left', tip: 'ชิดซ้าย' },
  { kind: 'center', icon: 'align_horizontal_center', tip: 'กึ่งกลางแนวนอน' },
  { kind: 'right', icon: 'align_horizontal_right', tip: 'ชิดขวา' },
  { kind: 'top', icon: 'align_vertical_top', tip: 'ชิดบน' },
  { kind: 'middle', icon: 'align_vertical_center', tip: 'กึ่งกลางแนวตั้ง' },
  { kind: 'bottom', icon: 'align_vertical_bottom', tip: 'ชิดล่าง' },
];

function AlignButtons({ distribute }: { distribute?: boolean }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {ALIGNS.map((a) => (
        <IconBtn key={a.kind} icon={a.icon} tip={a.tip} size={18} onClick={() => st().align(a.kind)} />
      ))}
      {distribute && (
        <>
          <IconBtn icon="horizontal_distribute" tip="กระจายระยะเท่ากันแนวนอน" size={18} onClick={() => st().distribute('h')} />
          <IconBtn icon="vertical_distribute" tip="กระจายระยะเท่ากันแนวตั้ง" size={18} onClick={() => st().distribute('v')} />
        </>
      )}
    </div>
  );
}

function MultiProps({ ids }: { ids: string[] }) {
  const elements = usePageElements();
  return (
    <>
      <Section title="จัดเรียง">
        <AlignButtons distribute />
        <p className="text-[11px] text-[var(--pe-muted)]">กระจายระยะต้องเลือกอย่างน้อย 3 ชิ้น</p>
      </Section>
      <Section title="กลุ่ม">
        <div className="grid grid-cols-2 gap-2">
          <SoftBtn icon="join" onClick={() => st().group()}>
            จัดกลุ่ม
          </SoftBtn>
          <SoftBtn icon="ungroup" onClick={() => st().ungroup()}>
            แยกกลุ่ม
          </SoftBtn>
        </div>
      </Section>
      <Section title="ความโปร่งใส">
        <Slider
          label="ความทึบ"
          value={elements.find((e) => e.id === ids[0])?.opacity ?? 1}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => st().updateElements(ids.map((id) => ({ id, patch: { opacity: v } })), 'multi-opacity')}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </Section>
    </>
  );
}

function Geometry({ el }: { el: PlanElement }) {
  return (
    <Section title="ตำแหน่งและขนาด">
      <div className="grid grid-cols-2 gap-1.5">
        <NumField value={el.x} onChange={(v) => up(el.id, { x: v })} tip="ตำแหน่ง X" prefix="X" className="w-full" />
        <NumField value={el.y} onChange={(v) => up(el.id, { y: v })} tip="ตำแหน่ง Y" prefix="Y" className="w-full" />
        <NumField value={el.width} min={5} onChange={(v) => up(el.id, { width: v })} tip="กว้าง" prefix="W" className="w-full" />
        {el.type !== 'text' && el.type !== 'line' ? (
          <NumField value={el.height} min={5} onChange={(v) => up(el.id, { height: v })} tip="สูง" prefix="H" className="w-full" />
        ) : (
          <div />
        )}
        <NumField value={el.rotation} onChange={(v) => up(el.id, { rotation: ((v % 360) + 360) % 360 })} tip="หมุน (องศา)" prefix="°" className="w-full" />
      </div>
      <p className="text-[11px] text-[var(--pe-muted)]">จัดตำแหน่งบนหน้า</p>
      <AlignButtons />
    </Section>
  );
}

function TextStyleFields({ style, onChange, idKey }: { style: TextStyle; onChange: (p: Partial<TextStyle>, key?: string) => void; idKey: string }) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <FontSelect value={style.fontFamily} onChange={(f) => onChange({ fontFamily: f })} />
        <NumField value={style.fontSize} min={4} onChange={(v) => onChange({ fontSize: v })} tip="ขนาดตัวอักษร" className="w-16" />
      </div>
      <div className="flex items-center gap-1">
        <ColorField value={style.fill} onChange={(c) => c && onChange({ fill: c }, `${idKey}:fill`)} tip="สีตัวอักษร" />
        <IconBtn icon="format_bold" tip="ตัวหนา" active={style.bold} onClick={() => onChange({ bold: !style.bold })} />
        <IconBtn icon="format_italic" tip="ตัวเอียง" active={style.italic} onClick={() => onChange({ italic: !style.italic })} />
        <IconBtn icon="format_underlined" tip="ขีดเส้นใต้" active={style.underline} onClick={() => onChange({ underline: !style.underline })} />
      </div>
      <Seg
        value={style.align}
        onChange={(v) => onChange({ align: v })}
        options={[
          { value: 'left', icon: 'format_align_left', tip: 'ชิดซ้าย' },
          { value: 'center', icon: 'format_align_center', tip: 'กึ่งกลาง' },
          { value: 'right', icon: 'format_align_right', tip: 'ชิดขวา' },
        ]}
      />
      <Slider label="ระยะบรรทัด" value={style.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => onChange({ lineHeight: v }, `${idKey}:lh`)} />
      <Slider label="ระยะตัวอักษร" value={style.letterSpacing} min={-5} max={40} step={0.5} onChange={(v) => onChange({ letterSpacing: v }, `${idKey}:ls`)} />
    </>
  );
}

// ---- Per type -------------------------------------------------------------------------------

function TextProps({ el }: { el: TextElement }) {
  return (
    <>
      <Section title="ข้อความ">
        <textarea
          value={el.text}
          onChange={(e) => up(el.id, { text: e.target.value }, `${el.id}:text`)}
          onKeyDown={(e) => e.stopPropagation()}
          rows={3}
          className="w-full rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] p-2 text-xs text-[var(--pe-text)] outline-none focus:border-[var(--pe-primary)]"
          style={{ fontFamily: el.fontFamily }}
          aria-label="ข้อความ"
        />
        <TextStyleFields style={el} idKey={el.id} onChange={(p, key) => up(el.id, p, key)} />
      </Section>
      <Section title="เส้นขอบตัวอักษร">
        <Row label="สีขอบ">
          <ColorField value={el.stroke} allowNone onChange={(c) => up(el.id, { stroke: c, strokeWidth: c ? el.strokeWidth || Math.max(2, el.fontSize / 12) : 0 })} tip="สีขอบตัวอักษร" />
        </Row>
        {el.stroke && (
          <Slider label="ความหนาขอบ" value={el.strokeWidth} min={0} max={Math.max(20, el.fontSize / 3)} step={0.5} onChange={(v) => up(el.id, { strokeWidth: v }, `${el.id}:sw`)} />
        )}
      </Section>
    </>
  );
}

function ShapeProps({ el }: { el: ShapeElement }) {
  return (
    <Section title="รูปทรง">
      <Row label="สีพื้น">
        <ColorField value={el.fill} allowNone onChange={(c) => up(el.id, { fill: c ?? 'transparent' }, `${el.id}:fill`)} tip="สีพื้น" />
      </Row>
      <Row label="สีขอบ">
        <ColorField value={el.stroke} allowNone onChange={(c) => up(el.id, { stroke: c, strokeWidth: c ? el.strokeWidth || 4 : 0 })} tip="สีขอบ" />
      </Row>
      {el.stroke && <Slider label="ความหนาขอบ" value={el.strokeWidth} min={0} max={60} onChange={(v) => up(el.id, { strokeWidth: v }, `${el.id}:sw`)} />}
      {el.shape === 'rect' && (
        <Slider label="มุมโค้ง" value={el.cornerRadius} min={0} max={Math.min(el.width, el.height) / 2} onChange={(v) => up(el.id, { cornerRadius: v }, `${el.id}:r`)} />
      )}
    </Section>
  );
}

/** Visual picker for solid / dashed / dotted strokes. */
function DashPicker({ value, onChange }: { value: LineElement['dash']; onChange: (d: LineElement['dash']) => void }) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {DASH_STYLES.map((d) => (
        <button
          key={d.id}
          type="button"
          data-tip={d.label}
          aria-label={d.label}
          aria-pressed={value === d.id}
          onClick={() => onChange(d.id)}
          className={`flex h-8 items-center justify-center rounded-md border ${
            value === d.id ? 'border-[var(--pe-primary)] bg-[var(--pe-primary-soft)] text-[var(--pe-primary)]' : 'border-[var(--pe-border-soft)] text-[var(--pe-text)]'
          }`}
        >
          <svg viewBox="0 0 40 6" className="h-2 w-9 stroke-current" fill="none" strokeWidth="2.5" strokeLinecap={d.id === 'dotted' ? 'round' : 'butt'}>
            <line x1="2" y1="3" x2="38" y2="3" strokeDasharray={dashArray(d.id, 1.4)?.join(' ')} />
          </svg>
        </button>
      ))}
    </div>
  );
}

const CAPS: { value: LineCap; icon: string; tip: string }[] = [
  { value: 'none', icon: 'remove', tip: 'ไม่มี' },
  { value: 'arrow', icon: 'arrow_forward', tip: 'ลูกศร' },
  { value: 'dot', icon: 'fiber_manual_record', tip: 'จุดกลม' },
];

function StrokeFields({
  el,
}: {
  el: LineElement | ConnectorElement;
}) {
  return (
    <>
      <Row label="สีเส้น">
        <ColorField value={el.stroke} onChange={(c) => c && up(el.id, { stroke: c }, `${el.id}:stroke`)} tip="สีเส้น" />
      </Row>
      <Slider label="ความหนา" value={el.strokeWidth} min={0.5} max={30} step={0.5} onChange={(v) => up(el.id, { strokeWidth: v, ...(el.type === 'line' ? { height: Math.max(12, v) } : {}) }, `${el.id}:sw`)} />
      <p className="text-[11px] text-[var(--pe-muted)]">รูปแบบเส้น</p>
      <DashPicker value={el.dash} onChange={(d) => up(el.id, { dash: d })} />
      <Row label="ปลายต้น">
        <Seg value={el.startCap} onChange={(v) => up(el.id, { startCap: v })} options={CAPS} />
      </Row>
      <Row label="ปลายทาง">
        <Seg value={el.endCap} onChange={(v) => up(el.id, { endCap: v })} options={CAPS} />
      </Row>
    </>
  );
}

function LineProps({ el }: { el: LineElement }) {
  return (
    <Section title="เส้น">
      <StrokeFields el={el} />
    </Section>
  );
}

function ImageProps({ el }: { el: ImageElement }) {
  const replace = useRef<HTMLInputElement>(null);
  const connectors = usePageElements().filter((e): e is ConnectorElement => e.type === 'connector' && e.fromId === el.id);
  const hasGps = el.lat != null && el.lng != null;
  const set = (p: Partial<ImageElement>, key?: string) => up(el.id, p as Patch, key);
  const setCap = (p: Partial<TextStyle>, key?: string) => set({ captionStyle: { ...el.captionStyle, ...p } }, key);

  return (
    <>
      <Section title="รูปภาพ">
        <div className="grid grid-cols-3 gap-1.5">
          <SoftBtn icon="crop" disabled={!el.src} onClick={() => st().setCrop(el.id)} tip="ครอป">
            ครอป
          </SoftBtn>
          <SoftBtn icon="flip" onClick={() => set({ flipX: !el.flipX })} tip="พลิกซ้าย-ขวา">
            พลิก
          </SoftBtn>
          <SoftBtn icon="swap_horiz" onClick={() => replace.current?.click()} tip="เปลี่ยนรูป (เลือกไฟล์)">
            เปลี่ยน
          </SoftBtn>
        </div>
        <input
          ref={replace}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = '';
            if (!f) return;
            try {
              const r = await readImageFile(f);
              fillImage(el, r.src, r.w, r.h, { photoId: undefined, lat: undefined, lng: undefined });
            } catch (err) {
              toast((err as Error).message);
            }
          }}
        />
        {!el.src && <p className="text-[11px] text-[var(--pe-muted)]">ช่องว่าง: คลิกรูปในแท็บ “รูปงาน/อัปโหลด” หรือลากรูปมาวางบนช่องนี้</p>}
      </Section>

      <Section title="คำบรรยายใต้รูป (ไม่ใส่ก็ได้)">
        <textarea
          value={el.caption}
          onChange={(e) => set({ caption: e.target.value }, `${el.id}:caption`)}
          onKeyDown={(e) => e.stopPropagation()}
          rows={2}
          placeholder="เช่น 17KM · Car 3 · SAT 09.00 - 15.00"
          className="w-full rounded-md border border-[var(--pe-border)] bg-[var(--pe-input)] p-2 text-xs text-[var(--pe-text)] outline-none focus:border-[var(--pe-primary)]"
          aria-label="คำบรรยาย"
        />
        {el.caption && (
          <>
            <Row label="ตำแหน่ง">
              <Seg
                value={el.captionPosition}
                onChange={(v: CaptionPosition) => set({ captionPosition: v })}
                options={[
                  { value: 'bottom', icon: 'vertical_align_bottom', tip: 'ใต้รูป' },
                  { value: 'top', icon: 'vertical_align_top', tip: 'เหนือรูป' },
                  { value: 'left', icon: 'west', tip: 'ซ้ายของรูป' },
                  { value: 'right', icon: 'east', tip: 'ขวาของรูป' },
                ]}
              />
            </Row>
            <Slider label="ระยะห่างจากรูป" value={el.captionGap} min={0} max={80} onChange={(v) => set({ captionGap: v }, `${el.id}:gap`)} />
            <TextStyleFields style={el.captionStyle} idKey={`${el.id}:cap`} onChange={setCap} />
          </>
        )}
      </Section>

      <Section title="เส้นชี้ไปยังเส้นทาง">
        <PrimaryBtn icon="conversion_path" className="w-full" onClick={() => st().setTool({ mode: 'connect', fromId: el.id })}>
          ชี้ไปยังจุดบนเส้นทาง
        </PrimaryBtn>
        {hasGps && (
          <>
            <SoftBtn icon="my_location" className="w-full" onClick={() => void connectToPhotoLocation(el)} tip="ใช้พิกัด GPS ของรูป">
              ชี้ไปจุดที่ถ่ายรูปอัตโนมัติ
            </SoftBtn>
            <SoftBtn icon="straighten" className="w-full" onClick={() => void captionWithKm(el)}>
              ใส่ระยะ km ในคำบรรยาย
            </SoftBtn>
          </>
        )}
        {connectors.length > 0 && (
          <ul className="space-y-1">
            {connectors.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => st().select([c.id])}
                  className="flex w-full items-center gap-2 rounded-md bg-[var(--pe-hover)] px-2 py-1.5 text-left text-[11px] text-[var(--pe-text)]"
                >
                  <span className="h-1 w-6 rounded" style={{ background: c.stroke }} />
                  เส้นชี้ → {formatKm(c.to.d)}
                  <Icon name="chevron_right" size={16} className="ml-auto text-[var(--pe-muted)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="กรอบ">
        <Row label="สีกรอบ">
          <ColorField value={el.borderColor} onChange={(c) => c && set({ borderColor: c }, `${el.id}:bc`)} tip="สีกรอบ" />
        </Row>
        <Slider label="ความหนากรอบ" value={el.borderWidth} min={0} max={40} onChange={(v) => set({ borderWidth: v }, `${el.id}:bw`)} />
        <Slider label="มุมโค้ง" value={el.cornerRadius} min={0} max={Math.min(el.width, el.height) / 2} onChange={(v) => set({ cornerRadius: v }, `${el.id}:r`)} />
      </Section>

      <Section
        title="ฟิลเตอร์"
        right={
          <button type="button" className="text-[11px] font-semibold text-[var(--pe-primary)]" onClick={() => set({ brightness: 0, contrast: 0, grayscale: false, blur: 0 })}>
            รีเซ็ต
          </button>
        }
      >
        <Slider label="ความสว่าง" value={el.brightness} min={-0.6} max={0.6} step={0.01} onChange={(v) => set({ brightness: v }, `${el.id}:br`)} format={(v) => `${Math.round(v * 100)}`} />
        <Slider label="คอนทราสต์" value={el.contrast} min={-60} max={60} onChange={(v) => set({ contrast: v }, `${el.id}:ct`)} />
        <Slider label="เบลอ" value={el.blur} min={0} max={20} onChange={(v) => set({ blur: v }, `${el.id}:bl`)} />
        <Toggle label="ขาวดำ" checked={el.grayscale} onChange={(v) => set({ grayscale: v })} />
      </Section>
    </>
  );
}

const BASEMAPS: { value: Basemap; label: string }[] = [
  { value: 'satellite', label: 'ดาวเทียม' },
  { value: 'topo', label: 'ภูมิประเทศ' },
  { value: 'street', label: 'แผนที่ถนน' },
  { value: 'light', label: 'โทนสว่าง' },
  { value: 'dark', label: 'โทนมืด' },
  { value: 'none', label: 'ผังเปล่า (ไม่มีพื้นแผนที่)' },
];

function MapProps({ el }: { el: MapElement }) {
  const routes = useEditor((s) => s.routes);
  useAssetVersion();
  const set = (p: Partial<MapElement>, key?: string) => up(el.id, p as Patch, key);
  return (
    <>
      <Section title="เส้นทางที่แสดง">
        {routes.map((r) => {
          const on = el.routeIds.includes(r._id);
          const g = getGeom(r._id);
          return (
            <div key={r._id} className="flex items-center gap-2 text-xs text-[var(--pe-text)]">
              <input
                type="checkbox"
                checked={on}
                aria-label={r.name}
                onChange={() => set({ routeIds: on ? el.routeIds.filter((x) => x !== r._id) : [...el.routeIds, r._id] })}
                className="h-4 w-4 accent-[var(--pe-primary)]"
              />
              <span className="min-w-0 flex-1 truncate">
                {r.name}
                {g && <span className="text-[var(--pe-muted)]"> · {g.total.toFixed(1)} km</span>}
              </span>
              {on && (
                <ColorField
                  value={el.routeColors[r._id] ?? r.color}
                  onChange={(c) => c && set({ routeColors: { ...el.routeColors, [r._id]: c } }, `${el.id}:rc`)}
                  tip="สีเส้นทาง"
                />
              )}
            </div>
          );
        })}
        <Slider label="ความหนาเส้นทาง" value={el.routeWidth} min={1} max={30} step={0.5} onChange={(v) => set({ routeWidth: v }, `${el.id}:rw`)} />
        <Toggle label="ขอบขาวรอบเส้นทาง" checked={el.routeOutline} onChange={(v) => set({ routeOutline: v })} />
        <Toggle label="ลูกศรบอกทิศทาง" checked={el.showArrows} onChange={(v) => set({ showArrows: v })} />
        <Toggle label="จุดเช็กพอยต์ (CP)" checked={el.showCps} onChange={(v) => set({ showCps: v })} />
        {el.showCps && <Toggle label="ชื่อ CP" checked={el.showCpLabels} onChange={(v) => set({ showCpLabels: v })} />}
        <Toggle label="จุดเริ่ม / เส้นชัย" checked={el.showStartEnd} onChange={(v) => set({ showStartEnd: v })} />
      </Section>
      <Section title="พื้นแผนที่">
        <Select value={el.basemap} onChange={(v) => set({ basemap: v })} options={BASEMAPS} tip="ชนิดพื้นแผนที่" className="w-full" />
        {el.basemap === 'none' ? (
          <Row label="สีพื้น">
            <ColorField value={el.background} onChange={(c) => c && set({ background: c }, `${el.id}:bg`)} tip="สีพื้นผัง" />
          </Row>
        ) : (
          <>
            <Toggle label="ขาวดำ" checked={el.basemapGray} onChange={(v) => set({ basemapGray: v })} />
            <Slider label="ความมืด" value={el.basemapDim} min={0} max={0.9} step={0.01} onChange={(v) => set({ basemapDim: v }, `${el.id}:dim`)} format={(v) => `${Math.round(v * 100)}%`} />
            <Toggle label="แสดงเครดิตแผนที่" checked={el.showAttribution} onChange={(v) => set({ showAttribution: v })} />
          </>
        )}
      </Section>
      <Section
        title="มุมมอง"
        right={
          <button type="button" className="text-[11px] font-semibold text-[var(--pe-primary)]" onClick={() => set({ zoom: 1, panX: 0, panY: 0 })}>
            พอดีเส้นทาง
          </button>
        }
      >
        <Slider label="ซูม" value={el.zoom} min={0.5} max={6} step={0.05} onChange={(v) => set({ zoom: v }, `${el.id}:zoom`)} format={(v) => `${v.toFixed(2)}×`} />
        <Slider label="เลื่อนซ้าย-ขวา" value={el.panX} min={-0.6} max={0.6} step={0.005} onChange={(v) => set({ panX: v }, `${el.id}:px`)} />
        <Slider label="เลื่อนขึ้น-ลง" value={el.panY} min={-0.6} max={0.6} step={0.005} onChange={(v) => set({ panY: v }, `${el.id}:py`)} />
      </Section>
      <Section title="กรอบ">
        <Slider label="มุมโค้ง" value={el.cornerRadius} min={0} max={Math.min(el.width, el.height) / 2} onChange={(v) => set({ cornerRadius: v }, `${el.id}:r`)} />
        <Row label="สีกรอบ">
          <ColorField value={el.borderColor} onChange={(c) => c && set({ borderColor: c }, `${el.id}:bc`)} tip="สีกรอบ" />
        </Row>
        <Slider label="ความหนากรอบ" value={el.borderWidth} min={0} max={30} onChange={(v) => set({ borderWidth: v }, `${el.id}:bw`)} />
      </Section>
    </>
  );
}

const ROUTINGS: { value: ConnectorRouting; icon: string; tip: string }[] = [
  { value: 'straight', icon: 'north_east', tip: 'เส้นตรง' },
  { value: 'hv', icon: 'turn_right', tip: 'แนวนอน → แนวตั้ง' },
  { value: 'vh', icon: 'subdirectory_arrow_right', tip: 'แนวตั้ง → แนวนอน' },
  { value: 'hvh', icon: 'step', tip: 'นอน-ตั้ง-นอน (เหมือนในไฟล์ตัวอย่าง)' },
  { value: 'vhv', icon: 'stairs', tip: 'ตั้ง-นอน-ตั้ง' },
];

function ConnectorProps({ el }: { el: ConnectorElement }) {
  const routes = useEditor((s) => s.routes);
  const from = usePageElements().find((e) => e.id === el.fromId);
  const route = routes.find((r) => r._id === el.to.routeId);
  const set = (p: Partial<ConnectorElement>, key?: string) => up(el.id, p as Patch, key);
  return (
    <>
      <Section title="ปลายเส้นบนเส้นทาง">
        <p className="rounded-md bg-[var(--pe-hover)] px-3 py-2 text-xs text-[var(--pe-text)]">
          ชี้ที่ <b className="text-[var(--pe-primary)]">{formatKm(el.to.d)}</b> ของ {route?.name ?? 'เส้นทาง'}
        </p>
        <p className="text-[11px] text-[var(--pe-muted)]">ลากจุดกลมที่ปลายเส้นเพื่อเลื่อนไปตามเส้นทาง (วางนอกเส้นทางไม่ได้)</p>
        <div className="grid grid-cols-2 gap-1.5">
          <SoftBtn icon="ads_click" onClick={() => st().setTool({ mode: 'connect', fromId: el.fromId, connectorId: el.id })}>
            เลือกจุดใหม่
          </SoftBtn>
          <SoftBtn icon="image" disabled={!from} onClick={() => from && st().select([from.id])}>
            ไปที่ต้นทาง
          </SoftBtn>
        </div>
      </Section>
      <Section title="รูปแบบเส้น">
        <StrokeFields el={el} />
      </Section>
      <Section title="การหักมุม">
        <Seg value={el.routing} onChange={(v) => set({ routing: v })} options={ROUTINGS} />
        {(el.routing === 'hvh' || el.routing === 'vhv') && (
          <Slider label="ตำแหน่งหักมุม" value={el.bend} min={0} max={1} step={0.01} onChange={(v) => set({ bend: v }, `${el.id}:bend`)} format={(v) => `${Math.round(v * 100)}%`} />
        )}
        <Row label="ออกจากด้าน">
          <Seg
            value={el.fromSide}
            onChange={(v: AttachSide) => set({ fromSide: v })}
            options={[
              { value: 'auto', label: 'อัตโนมัติ', tip: 'เลือกด้านที่ใกล้ที่สุด' },
              { value: 'left', icon: 'west', tip: 'ซ้าย' },
              { value: 'right', icon: 'east', tip: 'ขวา' },
              { value: 'top', icon: 'north', tip: 'บน' },
              { value: 'bottom', icon: 'south', tip: 'ล่าง' },
            ]}
          />
        </Row>
      </Section>
    </>
  );
}
