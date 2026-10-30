'use client';

/** Bottom strip: page thumbnails with add / duplicate / delete / reorder. */
import { useEffect, useState } from 'react';
import type { Background } from './types';
import { pageThumbnail } from './exporter';
import { useEditor } from './store';
import { Icon, IconBtn } from './ui';

const bgCss = (bg: Background) =>
  bg.type === 'color'
    ? bg.color
    : bg.type === 'gradient'
      ? `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`
      : `#191b24 url("${bg.src}") center / cover`;

export default function PagesBar() {
  const doc = useEditor((s) => s.doc)!;
  const pageIndex = useEditor((s) => s.pageIndex);
  const exporting = useEditor((s) => s.exporting);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const st = useEditor.getState;
  const current = doc.pages[pageIndex];

  // Refresh the current page's thumbnail shortly after it changes.
  useEffect(() => {
    if (exporting) return;
    const id = current.id;
    const t = setTimeout(() => {
      const url = pageThumbnail(160);
      if (url) setThumbs((m) => ({ ...m, [id]: url }));
    }, 900);
    return () => clearTimeout(t);
  }, [current, exporting]);

  const aspect = doc.width / doc.height;
  const h = 52;
  const w = Math.min(110, Math.max(30, h * aspect));

  return (
    <div className="flex h-[84px] shrink-0 items-center gap-2 border-t border-[var(--pe-border-soft)] bg-[var(--pe-surface)] px-3">
      <div className="pe-scroll flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2">
        {doc.pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            draggable
            onDragStart={() => setDragFrom(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && dragFrom !== i) st().movePage(dragFrom, i);
              setDragFrom(null);
            }}
            onClick={() => st().setPageIndex(i)}
            data-tip={`หน้า ${i + 1} · ลากเพื่อสลับลำดับ`}
            data-tip-side="top"
            className={`relative shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
              i === pageIndex ? 'border-[var(--pe-primary)]' : 'border-[var(--pe-border)] hover:border-[var(--pe-muted)]'
            }`}
            style={{ width: w, height: h, background: bgCss(p.background) }}
          >
            {thumbs[p.id] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs[p.id]} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/55 px-1 text-[9px] font-bold text-white">{i + 1}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => st().addPage()}
          data-tip="เพิ่มหน้า"
          data-tip-side="top"
          aria-label="เพิ่มหน้า"
          className="flex shrink-0 items-center justify-center rounded-md border-2 border-dashed border-[var(--pe-border)] text-[var(--pe-muted)] hover:border-[var(--pe-primary)] hover:text-[var(--pe-primary)]"
          style={{ width: w, height: h }}
        >
          <Icon name="add" />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-l border-[var(--pe-border-soft)] pl-2">
        <span className="hidden px-1 text-[11px] tabular-nums text-[var(--pe-muted)] sm:inline">
          {pageIndex + 1}/{doc.pages.length}
        </span>
        <IconBtn icon="chevron_left" tip="เลื่อนหน้าไปทางซ้าย" side="top" disabled={pageIndex === 0} onClick={() => st().movePage(pageIndex, pageIndex - 1)} />
        <IconBtn icon="chevron_right" tip="เลื่อนหน้าไปทางขวา" side="top" disabled={pageIndex === doc.pages.length - 1} onClick={() => st().movePage(pageIndex, pageIndex + 1)} />
        <IconBtn icon="content_copy" tip="ทำสำเนาหน้า" side="top" onClick={() => st().duplicatePage(pageIndex)} />
        <IconBtn icon="delete" tip="ลบหน้า" side="top" onClick={() => st().deletePage(pageIndex)} />
      </div>
    </div>
  );
}
