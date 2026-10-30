'use client';

/** Layer list (topmost first): select, rename, hide, lock and drag to reorder. */
import { useState } from 'react';
import type { PlanElement } from './types';
import { elementLabel } from './constants';
import { useEditor, usePageElements } from './store';
import { Icon, IconBtn } from './ui';

const TYPE_ICON: Record<PlanElement['type'], string> = {
  text: 'title',
  shape: 'category',
  line: 'horizontal_rule',
  icon: 'star',
  image: 'image',
  map: 'map',
  connector: 'conversion_path',
};

export default function LayersPanel() {
  const elements = usePageElements();
  const selectedIds = useEditor((s) => s.selectedIds);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const st = useEditor.getState;
  // Display order: top of the stack first.
  const list = elements.map((el, i) => ({ el, i })).reverse();

  if (!elements.length)
    return <p className="px-6 py-10 text-center text-xs text-[var(--pe-muted)]">หน้านี้ยังไม่มีวัตถุ</p>;

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center justify-end gap-0.5 px-1">
        <IconBtn icon="flip_to_front" tip="ดึงขึ้นหน้าสุด" size={18} disabled={!selectedIds.length} onClick={() => st().arrange('front')} />
        <IconBtn icon="arrow_upward" tip="ขึ้นหนึ่งชั้น" size={18} disabled={!selectedIds.length} onClick={() => st().arrange('forward')} />
        <IconBtn icon="arrow_downward" tip="ลงหนึ่งชั้น" size={18} disabled={!selectedIds.length} onClick={() => st().arrange('backward')} />
        <IconBtn icon="flip_to_back" tip="ส่งไปหลังสุด" size={18} disabled={!selectedIds.length} onClick={() => st().arrange('back')} />
      </div>
      <ul className="space-y-0.5">
        {list.map(({ el, i }) => {
          const selected = selectedIds.includes(el.id);
          return (
            <li
              key={el.id}
              draggable={renaming !== el.id}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', el.id);
                setDragId(el.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIdx(i);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverIdx(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== el.id) st().moveElement(dragId, i);
                setDragId(null);
                setOverIdx(null);
              }}
              onClick={(e) => st().select([el.id], e.shiftKey || e.metaKey || e.ctrlKey)}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                selected ? 'bg-[var(--pe-primary-soft)] text-[var(--pe-primary)]' : 'text-[var(--pe-text)] hover:bg-[var(--pe-hover)]'
              } ${overIdx === i && dragId ? 'outline outline-2 outline-[var(--pe-primary)]' : ''} ${el.hidden ? 'opacity-50' : ''}`}
            >
              <Icon name="drag_indicator" size={16} className="cursor-grab text-[var(--pe-muted)]" />
              <Thumb el={el} />
              {renaming === el.id ? (
                <input
                  autoFocus
                  defaultValue={elementLabel(el as never)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
                  }}
                  onBlur={(e) => {
                    st().updateElement(el.id, { name: e.target.value.trim() || undefined });
                    setRenaming(null);
                  }}
                  className="h-6 min-w-0 flex-1 rounded border border-[var(--pe-primary)] bg-[var(--pe-input)] px-1 text-xs text-[var(--pe-text)] outline-none"
                />
              ) : (
                <span
                  className="min-w-0 flex-1 truncate"
                  onDoubleClick={() => setRenaming(el.id)}
                  data-tip="ดับเบิลคลิกเพื่อเปลี่ยนชื่อ"
                >
                  {elementLabel(el as never)}
                </span>
              )}
              {el.groupId && <Icon name="join" size={14} className="text-[var(--pe-muted)]" />}
              <button
                type="button"
                data-tip={el.hidden ? 'แสดง' : 'ซ่อน'}
                aria-label={el.hidden ? 'แสดง' : 'ซ่อน'}
                onClick={(e) => {
                  e.stopPropagation();
                  st().toggleHidden(el.id);
                }}
                className={`flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--pe-active)] ${el.hidden ? '' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <Icon name={el.hidden ? 'visibility_off' : 'visibility'} size={15} />
              </button>
              <button
                type="button"
                data-tip={el.locked ? 'ปลดล็อก' : 'ล็อก'}
                aria-label={el.locked ? 'ปลดล็อก' : 'ล็อก'}
                onClick={(e) => {
                  e.stopPropagation();
                  st().toggleLock([el.id]);
                }}
                className={`flex h-6 w-6 items-center justify-center rounded hover:bg-[var(--pe-active)] ${el.locked ? '' : 'opacity-0 group-hover:opacity-100'}`}
              >
                <Icon name={el.locked ? 'lock' : 'lock_open'} size={15} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Thumb({ el }: { el: PlanElement }) {
  const box = 'flex h-7 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--pe-border-soft)] bg-[var(--pe-input)]';
  if (el.type === 'image' && el.src)
    return (
      <span className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={el.src} alt="" className="h-full w-full object-cover" />
      </span>
    );
  const color =
    el.type === 'shape' ? el.fill : el.type === 'text' ? el.fill : el.type === 'icon' ? el.fill : el.type === 'line' || el.type === 'connector' ? el.stroke : undefined;
  return (
    <span className={box} style={{ color }}>
      <Icon name={TYPE_ICON[el.type]} size={16} filled={el.type === 'shape'} />
    </span>
  );
}
