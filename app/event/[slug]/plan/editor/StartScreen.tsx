'use client';

/** Shown when no plan is open: recent plans for this event + new-plan sizes. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PlanDoc, PlanMeta } from './types';
import { SIZE_PRESETS, uid } from './constants';
import { blankPage, useEditor } from './store';
import { deletePlan, listPlans, loadPlan, setLastPlanId } from './storage';
import { generateRoutePages } from './actions';
import { headlineFont, Icon, IconBtn, NumField, PrimaryBtn, SoftBtn } from './ui';

export function newDoc(slug: string, name: string, width: number, height: number): PlanDoc {
  const now = new Date().toISOString();
  return { id: uid(), slug, name, width, height, pages: [blankPage()], uploads: [], createdAt: now, updatedAt: now };
}

export default function StartScreen({ slug }: { slug: string }) {
  const event = useEditor((s) => s.event);
  const routes = useEditor((s) => s.routes);
  const [plans, setPlans] = useState<PlanMeta[] | null>(null);
  const [w, setW] = useState(1600);
  const [h, setH] = useState(900);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const baseName = `แผนงาน ${event?.name ?? slug}`;

  useEffect(() => {
    listPlans(slug).then(setPlans, () => setPlans([]));
  }, [slug]);

  const open = async (id: string) => {
    const doc = await loadPlan(id);
    if (!doc) return;
    setLastPlanId(slug, id);
    useEditor.getState().setDoc(doc);
  };

  const create = (width: number, height: number) => {
    const doc = newDoc(slug, baseName, width, height);
    setLastPlanId(slug, doc.id);
    useEditor.getState().setDoc(doc);
    useEditor.getState().setSidebarTab('templates');
    return doc;
  };

  const autoPlan = async () => {
    setBusy(true);
    try {
      create(1920, 1080);
      await generateRoutePages(routes, true);
      // The generated pages are the starting point, not an undo step.
      useEditor.setState({ past: [], future: [] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pe-scroll h-full overflow-y-auto bg-[var(--pe-bg)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href={`/event/${slug}`}
            data-tip="กลับไปหน้าแผนที่"
            aria-label="กลับไปหน้าแผนที่"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)]"
          >
            <Icon name="arrow_back" />
          </Link>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--pe-muted)]" style={headlineFont}>
              แผนงาน
            </p>
            <h1 className="text-xl font-black uppercase tracking-tight text-[var(--pe-primary)] sm:text-2xl" style={headlineFont}>
              {event?.name ?? slug}
            </h1>
          </div>
        </div>

        {routes.length > 0 && (
          <div className="kinetic-gradient relative mb-8 overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-[#004cca]/30 sm:p-6">
            <span className="material-symbols-outlined pointer-events-none absolute -right-4 -top-6 select-none text-white/10" style={{ fontSize: 160 }} aria-hidden>
              conversion_path
            </span>
            <h2 className="text-lg font-bold" style={headlineFont}>
              สร้างแผนงานอัตโนมัติ
            </h2>
            <p className="mt-1 max-w-lg text-sm text-white/85">
              หน้าละ 1 เส้นทาง ({routes.length} เส้นทาง) — ผังแผนที่ตรงกลาง รูปที่ถ่ายบนเส้นทางวางรอบ ๆ พร้อมเส้นประชี้จุดและระยะ km แก้ไขต่อได้ทุกอย่าง
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={autoPlan}
              className="mt-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#004cca] shadow-md active:scale-[0.98] disabled:opacity-70"
              style={headlineFont}
            >
              <Icon name={busy ? 'progress_activity' : 'auto_awesome'} size={18} className={busy ? 'animate-spin' : ''} />
              {busy ? 'กำลังสร้าง…' : 'เริ่มเลย'}
            </button>
          </div>
        )}

        <h2 className="mb-3 text-sm font-bold text-[var(--pe-text)]" style={headlineFont}>
          เริ่มงานใหม่ — เลือกขนาด
        </h2>
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => create(p.width, p.height)}
              data-tip={`${p.label} ${p.hint}`}
              className="group flex flex-col items-center gap-2 rounded-xl border border-[var(--pe-border-soft)] bg-[var(--pe-panel)] p-4 text-center transition-shadow hover:shadow-lg"
            >
              <span className="flex h-16 w-16 items-center justify-center">
                <span
                  className="flex items-center justify-center rounded-md bg-[var(--pe-primary-soft)] text-[var(--pe-primary)] transition-transform group-hover:scale-105"
                  style={{
                    width: p.width >= p.height ? 60 : (60 * p.width) / p.height,
                    height: p.height >= p.width ? 60 : (60 * p.height) / p.width,
                  }}
                >
                  <Icon name={p.icon} size={22} />
                </span>
              </span>
              <span className="text-xs font-bold text-[var(--pe-text)]">{p.label}</span>
              <span className="text-[11px] text-[var(--pe-muted)]">{p.hint}</span>
            </button>
          ))}
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--pe-border)] bg-[var(--pe-panel)] p-4">
            <span className="text-xs font-bold text-[var(--pe-text)]">กำหนดเอง</span>
            <div className="flex gap-1">
              <NumField value={w} min={100} onChange={setW} tip="กว้าง (px)" prefix="W" className="w-[72px]" />
              <NumField value={h} min={100} onChange={setH} tip="สูง (px)" prefix="H" className="w-[72px]" />
            </div>
            <PrimaryBtn onClick={() => create(Math.round(w), Math.round(h))} className="w-full">
              สร้าง
            </PrimaryBtn>
          </div>
        </div>

        <h2 className="mb-3 text-sm font-bold text-[var(--pe-text)]" style={headlineFont}>
          งานล่าสุด
        </h2>
        {plans === null ? (
          <p className="text-xs text-[var(--pe-muted)]">กำลังโหลด…</p>
        ) : plans.length === 0 ? (
          <p className="text-xs text-[var(--pe-muted)]">ยังไม่มีงาน — งานจะบันทึกอัตโนมัติในเบราว์เซอร์เครื่องนี้</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {plans.map((p) => (
              <div key={p.id} className="group overflow-hidden rounded-xl border border-[var(--pe-border-soft)] bg-[var(--pe-panel)] transition-shadow hover:shadow-lg">
                <button type="button" onClick={() => void open(p.id)} className="block w-full text-left" data-tip="เปิดงานนี้">
                  <div className="flex aspect-video items-center justify-center overflow-hidden bg-[var(--pe-hover)]">
                    {p.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.thumb} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <Icon name="draft" size={32} className="text-[var(--pe-muted)]" />
                    )}
                  </div>
                  <div className="px-3 pt-2">
                    <p className="truncate text-xs font-bold text-[var(--pe-text)]">{p.name}</p>
                    <p className="text-[11px] text-[var(--pe-muted)]">
                      {p.pageCount} หน้า · {new Date(p.updatedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                </button>
                <div className="flex justify-end px-1.5 pb-1.5">
                  {confirmDel === p.id ? (
                    <div className="flex items-center gap-1">
                      <SoftBtn
                        className="!border-red-300 !px-2 !py-1 !text-red-600"
                        onClick={async () => {
                          await deletePlan(p.id);
                          setPlans((l) => l?.filter((x) => x.id !== p.id) ?? null);
                          setConfirmDel(null);
                        }}
                      >
                        ลบถาวร
                      </SoftBtn>
                      <SoftBtn className="!px-2 !py-1" onClick={() => setConfirmDel(null)}>
                        ยกเลิก
                      </SoftBtn>
                    </div>
                  ) : (
                    <IconBtn icon="delete" tip="ลบงานนี้" size={18} onClick={() => setConfirmDel(p.id)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
