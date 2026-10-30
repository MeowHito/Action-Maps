/**
 * Pointer behaviour shared by all canvas nodes: selection, multi-drag with
 * smart guides, and baking Konva's transformer scale into element sizes.
 */
import Konva from 'konva';
import { create } from 'zustand';
import type { ImageElement, PlanElement } from '../types';
import { coverCrop } from '../constants';
import { elementBox, unionBox, type Box, type Pt } from '../geometry';
import { getPageElements, useEditor } from '../store';

/** Transient canvas decorations that don't belong in the document. */
export const useOverlay = create<{
  guides: { v: number[]; h: number[] };
  hoverId: string | null;
  marquee: Box | null;
  connectPreview: { end: Pt; ok: boolean } | null;
}>(() => ({ guides: { v: [], h: [] }, hoverId: null, marquee: null, connectPreview: null }));

export const setHover = (hoverId: string | null) => useOverlay.setState({ hoverId });

/** Make a group's bounding box its declared width/height (ignoring overflow). */
export function pinBox(node: Konva.Group | null) {
  if (!node || (node as unknown as { _pinned?: boolean })._pinned) return;
  (node as unknown as { _pinned?: boolean })._pinned = true;
  const self = node as unknown as {
    _transformedRect: (r: Box, top?: Konva.Node) => Box;
  };
  node.getClientRect = function (
    this: Konva.Group,
    config?: { skipTransform?: boolean; relativeTo?: Konva.Container },
  ) {
    const rect = { x: 0, y: 0, width: this.width(), height: this.height() };
    if (config?.skipTransform) return rect;
    return self._transformedRect.call(this, rect, config?.relativeTo);
  } as Konva.Group['getClientRect'];
}

// ---- Selection ---------------------------------------------------------------------

export function onElementPointerDown(e: Konva.KonvaEventObject<PointerEvent>, el: PlanElement) {
  const st = useEditor.getState();
  if (st.tool.mode !== 'select') return;
  // Middle/right mouse buttons fall through to the stage (pan).
  if (e.evt.pointerType === 'mouse' && e.evt.button !== 0) return;
  e.cancelBubble = true;
  const additive = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
  if (additive) st.select([el.id], true);
  else if (!st.selectedIds.includes(el.id)) st.select([el.id]);
}

// ---- Dragging with smart guides -------------------------------------------------------

let drag: {
  node: Konva.Node;
  ids: string[];
  starts: Map<string, Pt>;
  anchor: Pt;
  box: Box;
} | null = null;

export const isDragging = () => !!drag;
export function cancelDrag() {
  drag?.node.stopDrag();
  drag = null;
  useOverlay.setState({ guides: { v: [], h: [] } });
}

export function onDragStart(e: Konva.KonvaEventObject<DragEvent>, el: PlanElement) {
  const st = useEditor.getState();
  if (!st.selectedIds.includes(el.id)) st.select([el.id]);
  const ids = useEditor.getState().selectedIds;
  const els = getPageElements().filter((x) => ids.includes(x.id) && !x.locked && x.type !== 'connector');
  st.commit();
  drag = {
    node: e.target,
    ids: els.map((x) => x.id),
    starts: new Map(els.map((x) => [x.id, { x: x.x, y: x.y }])),
    anchor: { x: el.x, y: el.y },
    box: unionBox(els.map(elementBox)) ?? elementBox(el),
  };
}

const SNAP_PX = 6;

/** Snap a moving box to page edges/centre and to other elements. */
function snap(box: Box, exclude: Set<string>, scale: number) {
  const doc = useEditor.getState().doc!;
  const tol = SNAP_PX / scale;
  const vStops = [0, doc.width / 2, doc.width];
  const hStops = [0, doc.height / 2, doc.height];
  for (const e of getPageElements()) {
    if (exclude.has(e.id) || e.hidden || e.type === 'connector') continue;
    const b = elementBox(e);
    vStops.push(b.x, b.x + b.width / 2, b.x + b.width);
    hStops.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  const pick = (edges: number[], stops: number[]) => {
    let best: number | null = null;
    for (const s of stops) for (const ed of edges) {
      const d = s - ed;
      if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
    return best ?? 0;
  };
  const vx = [box.x, box.x + box.width / 2, box.x + box.width];
  const hy = [box.y, box.y + box.height / 2, box.y + box.height];
  const dx = pick(vx, vStops);
  const dy = pick(hy, hStops);
  const near = (vals: number[], stops: number[], d: number) =>
    [...new Set(stops.filter((s) => vals.some((v) => Math.abs(v + d - s) < 0.5)))];
  return { dx, dy, v: near(vx, vStops, dx), h: near(hy, hStops, dy) };
}

export function onDragMove(e: Konva.KonvaEventObject<DragEvent>) {
  if (!drag || e.target !== drag.node) return;
  const st = useEditor.getState();
  let dx = drag.node.x() - drag.anchor.x;
  let dy = drag.node.y() - drag.anchor.y;
  const moved = { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
  if (!e.evt?.altKey) {
    const s = snap(moved, new Set(drag.ids), st.view.scale);
    dx += s.dx;
    dy += s.dy;
    useOverlay.setState({ guides: { v: s.v, h: s.h } });
  }
  drag.node.position({ x: drag.anchor.x + dx, y: drag.anchor.y + dy });
  st.updateElements(
    drag.ids.map((id) => {
      const p = drag!.starts.get(id)!;
      return { id, patch: { x: p.x + dx, y: p.y + dy } };
    }),
    false,
  );
}

export function onDragEnd() {
  drag = null;
  useOverlay.setState({ guides: { v: [], h: [] } });
}

// ---- Transformer ----------------------------------------------------------------------

/** Text reflows while resizing instead of stretching (Canva behaviour). */
export function onTextTransform(e: Konva.KonvaEventObject<Event>, tr: Konva.Transformer | null) {
  const node = e.target as Konva.Text;
  const anchor = tr?.getActiveAnchor() ?? '';
  const sx = node.scaleX();
  const sy = node.scaleY();
  if (anchor === 'middle-left' || anchor === 'middle-right') {
    node.setAttrs({ width: Math.max(20, node.width() * sx), scaleX: 1, scaleY: 1 });
  } else if (anchor !== 'rotater') {
    node.setAttrs({
      width: Math.max(20, node.width() * sx),
      fontSize: Math.max(4, node.fontSize() * sy),
      scaleX: 1,
      scaleY: 1,
    });
  }
}

/** Fold the transformer's scale into width/height so nothing stays scaled. */
export function onTransformEnd(e: Konva.KonvaEventObject<Event>, id: string) {
  const node = e.target;
  const el = getPageElements().find((x) => x.id === id);
  if (!el) return;
  const sx = node.scaleX();
  const sy = node.scaleY();
  node.scale({ x: 1, y: 1 });
  const patch: Record<string, unknown> = { x: node.x(), y: node.y(), rotation: node.rotation() };
  switch (el.type) {
    case 'text': {
      const t = node as Konva.Text;
      patch.width = t.width();
      patch.fontSize = t.fontSize();
      break;
    }
    case 'line':
      patch.width = Math.max(10, el.width * sx);
      break;
    case 'image': {
      const w = Math.max(10, el.width * sx);
      const h = Math.max(10, el.height * sy);
      patch.width = w;
      patch.height = h;
      if (Math.abs(sx - sy) > 0.01) patch.crop = refitCrop(el, w, h);
      else patch.captionStyle = { ...el.captionStyle, fontSize: Math.max(6, el.captionStyle.fontSize * sx) };
      break;
    }
    default:
      patch.width = Math.max(5, el.width * sx);
      patch.height = Math.max(5, el.height * sy);
  }
  useEditor.getState().updateElement(id, patch as Partial<PlanElement>, false);
}

/** Keep the same crop centre and zoom when an image frame changes shape. */
export function refitCrop(el: ImageElement, w: number, h: number) {
  const base = coverCrop(el.naturalWidth, el.naturalHeight, el.width, el.height);
  const zoom = base.w / Math.max(1e-6, el.crop.w);
  const center = { x: el.crop.x + el.crop.w / 2, y: el.crop.y + el.crop.h / 2 };
  return coverCrop(el.naturalWidth, el.naturalHeight, w, h, center, Math.max(1, zoom));
}
