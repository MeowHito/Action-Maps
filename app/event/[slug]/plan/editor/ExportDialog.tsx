'use client';

/** Download dialog: format, page range and resolution. */
import { useState } from 'react';
import { exportPlan, type ExportFormat } from './exporter';
import { useEditor } from './store';
import { headlineFont, Icon, IconBtn, PrimaryBtn, Seg, Slider } from './ui';

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor((s) => s.doc)!;
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(2);
  const [pages, setPages] = useState<'current' | 'all'>(doc.pages.length > 1 ? 'all' : 'current');
  const [quality, setQuality] = useState(0.92);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setProgress({ done: 0, total: pages === 'all' ? doc.pages.length : 1 });
    try {
      await exportPlan({ format, scale, pages, quality }, (done, total) => setProgress({ done, total }));
      onClose();
    } catch (e) {
      const msg = (e as Error).message ?? '';
      setError(
        /taint|insecure|security/i.test(msg)
          ? 'มีรูปที่เซิร์ฟเวอร์ไม่อนุญาตให้ส่งออก (CORS) — ลองอัปโหลดรูปนั้นเข้ามาเองแทน'
          : `ส่งออกไม่สำเร็จ: ${msg}`,
      );
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="whats-new-backdrop fixed inset-0 z-[6000] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="whats-new-card w-full max-w-sm rounded-t-2xl border border-[var(--pe-border)] bg-[var(--pe-panel)] p-5 text-[var(--pe-text)] shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold" style={headlineFont}>
            ดาวน์โหลด
          </h2>
          <IconBtn icon="close" tip="ปิด" onClick={onClose} disabled={!!progress} />
        </div>

        <p className="mb-1.5 text-xs font-semibold text-[var(--pe-text-soft)]">ประเภทไฟล์</p>
        <Seg
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png', label: 'PNG', tip: 'คมชัด ไม่สูญเสียคุณภาพ' },
            { value: 'jpg', label: 'JPG', tip: 'ไฟล์เล็ก เหมาะส่งแชท' },
            { value: 'pdf', label: 'PDF', tip: 'รวมทุกหน้าเป็นไฟล์เดียว พิมพ์ได้' },
          ]}
        />

        <p className="mb-1.5 mt-4 text-xs font-semibold text-[var(--pe-text-soft)]">หน้า</p>
        <Seg
          value={pages}
          onChange={setPages}
          options={[
            { value: 'current', label: 'หน้านี้', tip: 'เฉพาะหน้าที่เปิดอยู่' },
            { value: 'all', label: `ทุกหน้า (${doc.pages.length})`, tip: 'ทุกหน้าในงาน' },
          ]}
        />

        <p className="mb-1.5 mt-4 text-xs font-semibold text-[var(--pe-text-soft)]">ความละเอียด</p>
        <Seg
          value={String(scale) as '1' | '2' | '3'}
          onChange={(v) => setScale(Number(v))}
          options={[1, 2, 3].map((k) => ({
            value: String(k) as '1' | '2' | '3',
            label: `${k}×`,
            tip: `${doc.width * k} × ${doc.height * k} px`,
          }))}
        />
        <p className="mt-1 text-[11px] text-[var(--pe-muted)]">
          {doc.width * scale} × {doc.height * scale} px
        </p>

        {format !== 'png' && (
          <div className="mt-3">
            <Slider label="คุณภาพ JPG" value={quality} min={0.5} max={1} step={0.01} onChange={setQuality} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        )}

        {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

        <PrimaryBtn onClick={run} disabled={!!progress} className="mt-5 w-full py-3" icon={progress ? undefined : 'download'}>
          {progress ? (
            <>
              <Icon name="progress_activity" size={18} className="animate-spin" />
              กำลังส่งออก {progress.done}/{progress.total}
            </>
          ) : (
            `ดาวน์โหลด ${format.toUpperCase()}`
          )}
        </PrimaryBtn>
      </div>
    </div>
  );
}
