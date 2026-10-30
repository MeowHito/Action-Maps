'use client';

/**
 * In-place editor for text elements and image captions: a textarea laid
 * exactly over the Konva text node (position, rotation, font, zoom).
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import type { PlanElement, TextStyle } from '../types';
import { runtime } from '../runtime';
import { getPageElements, useEditor } from '../store';

export default function TextEditor() {
  const editing = useEditor((s) => s.editing)!;
  const view = useEditor((s) => s.view);
  const el = getPageElements().find((e) => e.id === editing.id);
  const isCaption = editing.field === 'caption';
  const initial = el?.type === 'text' ? el.text : el?.type === 'image' ? el.caption : '';
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus();
    t.select();
  }, []);

  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  }, [value, view.scale]);

  if (!el || (el.type !== 'text' && el.type !== 'image')) return null;
  const node = runtime.page?.findOne(isCaption ? `#cap-${el.id}` : `#${el.id}`) as Konva.Text | undefined;
  if (!node) return null;

  const style: TextStyle = el.type === 'text' ? el : el.captionStyle;
  // Captions above/beside a picture are bottom/middle-aligned in a tall box.
  let offsetY = 0;
  const lines = (node as unknown as { textArr?: unknown[] }).textArr?.length ?? 1;
  const contentH = lines * style.fontSize * style.lineHeight;
  if (node.verticalAlign() === 'bottom') offsetY = node.height() - contentH;
  if (node.verticalAlign() === 'middle') offsetY = (node.height() - contentH) / 2;
  const pos = node.getAbsoluteTransform().point({ x: 0, y: offsetY });
  const rotation = node.getAbsoluteRotation();
  const align = isCaption ? node.align() : style.align;

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const st = useEditor.getState();
    st.setEditing(null);
    if (value === initial) return;
    if (el.type === 'text' && !value.trim()) return st.deleteElements([el.id]);
    if (el.type === 'image') return st.updateElement(el.id, { caption: value } as Partial<PlanElement>);
    // Widen the box so typed lines don't wrap (up to the page edge), like Canva.
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? 'bold ' : ''}${el.fontSize}px "${el.fontFamily}"`;
    const longest = Math.max(...value.split('\n').map((l) => ctx.measureText(l).width + el.letterSpacing * l.length));
    const width = Math.min(Math.max(el.width, st.doc!.width - el.x), Math.max(el.width, Math.ceil(longest + el.fontSize * 0.1)));
    st.updateElement(el.id, { text: value, width } as Partial<PlanElement>);
  };

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        }
      }}
      spellCheck={false}
      className="absolute m-0 resize-none overflow-hidden border-0 bg-transparent p-0 outline outline-2 outline-offset-2 outline-[#004cca]/60"
      style={{
        left: pos.x,
        top: pos.y,
        width: node.width() * view.scale,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'top left',
        fontFamily: `"${style.fontFamily}", sans-serif`,
        fontSize: style.fontSize * view.scale,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        textDecoration: style.underline ? 'underline' : 'none',
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing * view.scale,
        color: style.fill,
        textAlign: align as React.CSSProperties['textAlign'],
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    />
  );
}
