'use client';

/** Top bar: back link, editable file name, undo/redo, zoom, theme, export. */
import Link from 'next/link';
import { useEditor } from './store';
import { headlineFont, Icon, IconBtn, PrimaryBtn } from './ui';

export default function Toolbar({ slug, onExport, onOpenFiles }: { slug: string; onExport: () => void; onOpenFiles: () => void }) {
  const name = useEditor((s) => s.doc?.name ?? '');
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const scale = useEditor((s) => s.view.scale);
  const theme = useEditor((s) => s.theme);
  const savedAt = useEditor((s) => s.savedAt);
  const st = useEditor.getState;

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--pe-border-soft)] bg-[var(--pe-surface)] px-2 sm:gap-2 sm:px-3">
      <Link
        href={`/event/${slug}`}
        data-tip="กลับไปหน้าแผนที่"
        aria-label="กลับไปหน้าแผนที่"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)]"
      >
        <Icon name="arrow_back" />
      </Link>
      <div className="hidden items-center gap-1.5 sm:flex">
        <div className="kinetic-gradient flex h-7 w-7 items-center justify-center rounded-md shadow-sm">
          <Icon name="edit_note" size={16} filled className="text-white" />
        </div>
        <span className="text-sm font-black uppercase tracking-tighter text-[var(--pe-primary)]" style={headlineFont}>
          แผนงาน
        </span>
      </div>
      <IconBtn icon="folder_open" tip="งานทั้งหมด / สร้างใหม่" onClick={onOpenFiles} />

      <input
        value={name}
        onChange={(e) => st().setDocName(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        data-tip="แก้ชื่อไฟล์"
        aria-label="ชื่อไฟล์"
        className="h-9 min-w-0 max-w-[220px] flex-1 truncate rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-[var(--pe-text)] outline-none hover:border-[var(--pe-border)] focus:border-[var(--pe-primary)] sm:flex-none sm:w-56"
      />
      <span
        className="hidden items-center gap-1 text-[11px] text-[var(--pe-muted)] lg:flex"
        data-tip="บันทึกอัตโนมัติในเครื่องนี้"
      >
        <Icon name={savedAt ? 'cloud_done' : 'cloud_sync'} size={16} />
        {savedAt ? 'บันทึกแล้ว' : 'กำลังบันทึก…'}
      </span>

      <div className="mx-1 hidden h-6 w-px bg-[var(--pe-border)] sm:block" />
      <IconBtn icon="undo" tip="ย้อนกลับ (Ctrl+Z)" onClick={() => st().undo()} disabled={!canUndo} />
      <IconBtn icon="redo" tip="ทำซ้ำ (Ctrl+Y)" onClick={() => st().redo()} disabled={!canRedo} />

      <div className="flex-1" />

      <div className="hidden items-center md:flex">
        <IconBtn icon="remove" tip="ซูมออก (Ctrl −)" onClick={() => st().zoomAt(scale / 1.25)} />
        <button
          type="button"
          onClick={() => st().fitView()}
          data-tip="พอดีหน้าจอ (Ctrl 0)"
          className="h-9 w-14 rounded-lg text-xs font-semibold tabular-nums text-[var(--pe-text-soft)] hover:bg-[var(--pe-hover)]"
        >
          {Math.round(scale * 100)}%
        </button>
        <IconBtn icon="add" tip="ซูมเข้า (Ctrl +)" onClick={() => st().zoomAt(scale * 1.25)} />
      </div>
      <IconBtn
        icon={theme === 'dark' ? 'light_mode' : 'dark_mode'}
        tip={theme === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด'}
        onClick={() => st().setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      <PrimaryBtn icon="download" onClick={onExport} tip="ดาวน์โหลด PNG / JPG / PDF">
        <span className="hidden sm:inline">ดาวน์โหลด</span>
      </PrimaryBtn>
    </header>
  );
}
