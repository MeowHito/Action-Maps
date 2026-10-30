'use client';

/**
 * The editing surface: a Konva stage showing the current page on a grey
 * workspace. Handles zoom / pan / pinch, marquee selection, the transformer,
 * smart-guide drawing, the "point to route" tool, crop mode, drops from the
 * sidebar and inline text editing.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import Konva from 'konva';
import { Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import type { ConnectorElement, ImageElement, PlanElement } from '../types';
import { coverCrop } from '../constants';
import { connectorPath, elementBox, snapToRoutes, type Pt } from '../geometry';
import { runtime } from '../runtime';
import { getPageElements, useEditor, usePageElements } from '../store';
import { createConnector, toast, toastStore, uploadFiles } from '../actions';
import { takeDragPayload } from '../dnd';
import { BackgroundNode, ElementNode, useLoadedImage } from './nodes';
import { cancelDrag, isDragging, useOverlay } from './interaction';
import { trRef } from './trRef';
import TextEditor from './TextEditor';

const ALL_ANCHORS = [
  'top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right',
];
const PRIMARY = '#004cca';
const GUIDE = '#ec4899';

let spaceDown = false;

export default function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const pageRef = useRef<Konva.Group>(null);
  const tr = useRef<Konva.Transformer>(null);
  const doc = useEditor((s) => s.doc)!;
  const pageIndex = useEditor((s) => s.pageIndex);
  const view = useEditor((s) => s.view);
  const viewport = useEditor((s) => s.viewport);
  const selectedIds = useEditor((s) => s.selectedIds);
  const tool = useEditor((s) => s.tool);
  const cropId = useEditor((s) => s.cropId);
  const editing = useEditor((s) => s.editing);
  const exporting = useEditor((s) => s.exporting);
  const elements = usePageElements();
  const page = doc.pages[pageIndex];
  const [cursor, setCursor] = useState<string>('default');
  const coarse = useCoarsePointer();

  // ---- Viewport size + initial fit ----
  useLayoutEffect(() => {
    const el = containerRef.current!;
    let first = true;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      useEditor.getState().setViewport(width, height);
      if (first) {
        first = false;
        useEditor.getState().fitView();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    useEditor.getState().fitView();
  }, [doc.id]);

  useEffect(() => {
    runtime.stage = stageRef.current;
    runtime.page = pageRef.current;
    trRef.current = tr.current;
    return () => {
      runtime.stage = null;
      runtime.page = null;
      trRef.current = null;
    };
  }, []);

  // ---- Transformer follows the selection ----
  useEffect(() => {
    const t = tr.current;
    const pg = pageRef.current;
    if (!t || !pg) return;
    const sel = elements.filter((e) => selectedIds.includes(e.id) && e.type !== 'connector' && !e.hidden);
    const nodes =
      cropId || editing || exporting || tool.mode !== 'select'
        ? []
        : (sel.map((e) => pg.findOne(`#${e.id}`)).filter(Boolean) as Konva.Node[]);
    const single = sel.length === 1 ? sel[0] : null;
    const locked = sel.some((e) => e.locked);
    t.nodes(nodes);
    t.setAttrs({
      enabledAnchors: locked
        ? []
        : single?.type === 'line'
          ? ['middle-left', 'middle-right']
          : single?.type === 'text'
            ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
            : ALL_ANCHORS,
      rotateEnabled: !locked,
      borderDash: locked ? [4, 4] : undefined,
    });
    t.getLayer()?.batchDraw();
  }, [selectedIds, elements, cropId, editing, exporting, tool.mode]);

  // ---- Wheel: pan, ctrl/⌘ + wheel (or trackpad pinch) zooms ----
  useEffect(() => {
    const el = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useEditor.getState();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        st.zoomAt(st.view.scale * Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        st.setView({ x: st.view.x - e.deltaX, y: st.view.y - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- Two-finger pinch / pan on touch screens ----
  useEffect(() => {
    const el = containerRef.current!;
    let pinch: { d: number; cx: number; cy: number; view: { scale: number; x: number; y: number } } | null = null;
    const read = (t: TouchList) => {
      const r = el.getBoundingClientRect();
      const a = t[0];
      const b = t[1];
      return {
        d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        cx: (a.clientX + b.clientX) / 2 - r.left,
        cy: (a.clientY + b.clientY) / 2 - r.top,
      };
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      if (isDragging()) cancelDrag();
      tr.current?.stopTransform();
      pinch = { ...read(e.touches), view: useEditor.getState().view };
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const now = read(e.touches);
      const scale = Math.min(8, Math.max(0.05, pinch.view.scale * (now.d / pinch.d)));
      const px = (pinch.cx - pinch.view.x) / pinch.view.scale;
      const py = (pinch.cy - pinch.view.y) / pinch.view.scale;
      useEditor.getState().setView({ scale, x: now.cx - px * scale, y: now.cy - py * scale });
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    el.addEventListener('touchstart', start, { capture: true, passive: true });
    el.addEventListener('touchmove', move, { capture: true, passive: false });
    el.addEventListener('touchend', end, { capture: true });
    return () => {
      el.removeEventListener('touchstart', start, { capture: true });
      el.removeEventListener('touchmove', move, { capture: true });
      el.removeEventListener('touchend', end, { capture: true });
    };
  }, []);

  // ---- Space bar = hand tool ----
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) {
        spaceDown = true;
        setCursor('grab');
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown = false;
        setCursor('default');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---- Stage pointer: marquee, pan, route picking ----
  const gesture = useRef<{ kind: 'marquee' | 'pan'; sx: number; sy: number; view: typeof view; moved: boolean } | null>(null);

  const toPage = (p: Pt) => {
    const v = useEditor.getState().view;
    return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
  };

  const onStagePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const st = useEditor.getState();
    const stage = stageRef.current!;
    const pos = stage.getPointerPosition();
    if (!pos || st.tool.mode === 'connect') return;
    const target = e.target;
    const empty = target === stage || target.hasName('page-bg') || target.hasName('page-shadow');
    const evt = e.evt;
    if (evt.button === 1 || spaceDown || (empty && evt.pointerType === 'touch')) {
      gesture.current = { kind: 'pan', sx: pos.x, sy: pos.y, view: st.view, moved: false };
      setCursor('grabbing');
      return;
    }
    if (!empty) return;
    if (st.cropId) st.setCrop(null);
    if (st.editing) st.setEditing(null);
    gesture.current = { kind: 'marquee', sx: pos.x, sy: pos.y, view: st.view, moved: false };
    if (!evt.shiftKey) st.select([]);
  };

  const onStagePointerMove = () => {
    const st = useEditor.getState();
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    if (st.tool.mode === 'connect') {
      const p = toPage(pos);
      const snap = snapToRoutes(p, getPageElements());
      const ok = !!snap && snap.dist * st.view.scale < 80;
      useOverlay.setState({ connectPreview: { end: ok ? { x: snap!.x, y: snap!.y } : p, ok } });
      return;
    }
    const g = gesture.current;
    if (!g) return;
    if (Math.hypot(pos.x - g.sx, pos.y - g.sy) > 3) g.moved = true;
    if (g.kind === 'pan') {
      st.setView({ x: g.view.x + pos.x - g.sx, y: g.view.y + pos.y - g.sy });
    } else if (g.moved) {
      const a = toPage({ x: g.sx, y: g.sy });
      const b = toPage(pos);
      useOverlay.setState({
        marquee: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) },
      });
    }
  };

  const onStagePointerUp = () => {
    const st = useEditor.getState();
    if (st.tool.mode === 'connect') {
      const prev = useOverlay.getState().connectPreview;
      const pos = stageRef.current?.getPointerPosition();
      if (!pos) return;
      const snap = snapToRoutes(toPage(pos), getPageElements());
      if (prev?.ok && snap) {
        const to = { mapId: snap.mapId, routeId: snap.routeId, d: snap.d };
        if (st.tool.connectorId) st.updateElement(st.tool.connectorId, { to } as Partial<PlanElement>);
        else createConnector(st.tool.fromId, to);
        st.setTool({ mode: 'select' });
        useOverlay.setState({ connectPreview: null });
      } else {
        toast('คลิกบนเส้นทางในแผนที่เท่านั้น');
      }
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === 'pan') setCursor(spaceDown ? 'grab' : 'default');
    const m = useOverlay.getState().marquee;
    if (g?.kind === 'marquee' && m) {
      const hit = getPageElements()
        .filter((e) => e.type !== 'connector' && !e.hidden)
        .filter((e) => {
          const b = elementBox(e);
          return b.x < m.x + m.width && b.x + b.width > m.x && b.y < m.y + m.height && b.y + b.height > m.y;
        })
        .map((e) => e.id);
      st.select(hit, true);
    }
    useOverlay.setState({ marquee: null });
  };

  useEffect(() => {
    const up = () => gesture.current && onStagePointerUp();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });

  // ---- Drops from the sidebar or the file system ----
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const r = containerRef.current!.getBoundingClientRect();
    const at = toPage({ x: e.clientX - r.left, y: e.clientY - r.top });
    const target =
      ([...getPageElements()]
        .reverse()
        .find((el) => {
          if (el.type !== 'image' || el.src || el.hidden) return false;
          const b = elementBox(el);
          return at.x >= b.x && at.x <= b.x + b.width && at.y >= b.y && at.y <= b.y + b.height;
        }) as ImageElement | undefined) ?? null;
    const payload = takeDragPayload();
    if (payload) return payload(at, target);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) void uploadFiles(files, { at, target });
  };

  const connectorSel =
    selectedIds.length === 1
      ? (elements.find((e) => e.id === selectedIds[0] && e.type === 'connector') as ConnectorElement | undefined)
      : undefined;
  const cropEl = cropId ? (elements.find((e) => e.id === cropId) as ImageElement | undefined) : undefined;

  return (
    <div
      ref={containerRef}
      className="pe-canvas relative min-h-0 flex-1 overflow-hidden"
      style={{ cursor: tool.mode === 'connect' ? 'crosshair' : cursor, touchAction: 'none' }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      <Stage
        ref={stageRef}
        width={viewport.w}
        height={viewport.h}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
      >
        <Layer>
          <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
            <Rect
              name="page-shadow"
              width={doc.width}
              height={doc.height}
              fill="#ffffff"
              shadowColor="#191b24"
              shadowBlur={24 / view.scale}
              shadowOpacity={0.18}
              shadowOffsetY={4 / view.scale}
            />
            <Group ref={pageRef} clipX={0} clipY={0} clipWidth={doc.width} clipHeight={doc.height}>
              <BackgroundNode bg={page.background} w={doc.width} h={doc.height} />
              {elements.map((el) => (
                <ElementNode key={el.id} el={el} elements={elements} />
              ))}
            </Group>
            {!exporting && (
              <Overlay scale={view.scale} connector={connectorSel} cropEl={cropEl} elements={elements} />
            )}
          </Group>
          <Transformer
            ref={tr}
            anchorSize={coarse ? 18 : 10}
            anchorCornerRadius={20}
            anchorStroke={PRIMARY}
            anchorFill="#ffffff"
            anchorStrokeWidth={1.5}
            borderStroke={PRIMARY}
            borderStrokeWidth={1.5}
            rotateAnchorOffset={coarse ? 34 : 26}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={4}
            padding={2}
            ignoreStroke
            flipEnabled={false}
            boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 4 ? oldBox : newBox)}
            onTransformStart={() => useEditor.getState().commit()}
          />
        </Layer>
      </Stage>

      {editing && <TextEditor />}
      {tool.mode === 'connect' && <ConnectBanner />}
      {cropEl && <CropToolbar el={cropEl} />}
      <Toast />
    </div>
  );
}

function useCoarsePointer() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia('(pointer: coarse)');
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false,
  );
}

// ---- Overlay: hover, guides, marquee, connector handles, crop ----------------------------

function Overlay({
  scale,
  connector,
  cropEl,
  elements,
}: {
  scale: number;
  connector?: ConnectorElement;
  cropEl?: ImageElement;
  elements: PlanElement[];
}) {
  const { guides, hoverId, marquee, connectPreview } = useOverlay();
  const selectedIds = useEditor((s) => s.selectedIds);
  const tool = useEditor((s) => s.tool);
  const doc = useEditor((s) => s.doc)!;
  const px = 1 / scale;
  const hover = hoverId && !selectedIds.includes(hoverId) ? elements.find((e) => e.id === hoverId) : null;

  // Preview of the pointer being placed with the connect tool.
  let preview: number[] | null = null;
  if (tool.mode === 'connect' && connectPreview) {
    const from = elements.find((e) => e.id === tool.fromId);
    if (from) {
      const b = elementBox(from);
      const sx = connectPreview.end.x >= b.x + b.width / 2 ? b.x + b.width : b.x;
      preview = [sx, b.y + b.height / 2, connectPreview.end.x, connectPreview.end.y];
    }
  }
  const path = connector ? connectorPath(connector, elements) : null;

  return (
    <Group>
      {hover && hover.type !== 'connector' && (
        <Rect
          x={hover.x}
          y={hover.y}
          width={hover.width}
          height={hover.height}
          rotation={hover.rotation}
          stroke={PRIMARY}
          strokeWidth={1.5 * px}
          listening={false}
        />
      )}
      {hover?.type === 'connector' && (() => {
        const p = connectorPath(hover, elements);
        return p ? <Line points={p.points} stroke={PRIMARY} strokeWidth={6 * px} opacity={0.35} listening={false} /> : null;
      })()}
      {guides.v.map((x) => (
        <Line key={`v${x}`} points={[x, -doc.height, x, doc.height * 2]} stroke={GUIDE} strokeWidth={px} listening={false} />
      ))}
      {guides.h.map((y) => (
        <Line key={`h${y}`} points={[-doc.width, y, doc.width * 2, y]} stroke={GUIDE} strokeWidth={px} listening={false} />
      ))}
      {marquee && (
        <Rect {...marquee} fill="rgba(0,76,202,0.08)" stroke={PRIMARY} strokeWidth={px} dash={[4 * px, 3 * px]} listening={false} />
      )}
      {preview && (
        <>
          <Line points={preview} stroke={PRIMARY} strokeWidth={2 * px} dash={[6 * px, 4 * px]} listening={false} />
          <Circle
            x={preview[2]}
            y={preview[3]}
            radius={7 * px}
            fill={connectPreview?.ok ? '#22c55e' : '#c2c6d9'}
            stroke="#ffffff"
            strokeWidth={2 * px}
            listening={false}
          />
        </>
      )}
      {connector && path && <ConnectorHandles c={connector} path={path} px={px} />}
      {cropEl && <CropOverlay el={cropEl} px={px} />}
    </Group>
  );
}

/** Drag the route end (snaps along routes only) and the middle bend. */
function ConnectorHandles({
  c,
  path,
  px,
}: {
  c: ConnectorElement;
  path: { points: number[]; start: Pt; end: Pt };
  px: number;
}) {
  const st = useEditor.getState;
  const bendPos =
    c.routing === 'hvh'
      ? { x: path.points[2], y: (path.points[3] + path.points[5]) / 2 }
      : c.routing === 'vhv'
        ? { x: (path.points[2] + path.points[4]) / 2, y: path.points[3] }
        : null;
  return (
    <>
      <Line points={path.points} stroke={PRIMARY} strokeWidth={8 * px} opacity={0.25} listening={false} />
      {bendPos && (
        <Rect
          x={bendPos.x - 6 * px}
          y={bendPos.y - 6 * px}
          width={12 * px}
          height={12 * px}
          cornerRadius={2 * px}
          fill="#ffffff"
          stroke={PRIMARY}
          strokeWidth={1.5 * px}
          draggable
          onDragStart={() => st().commit()}
          onDragMove={(e) => {
            const n = e.target;
            const { start, end } = path;
            const bend =
              c.routing === 'hvh'
                ? (n.x() + 6 * px - start.x) / (end.x - start.x || 1)
                : (n.y() + 6 * px - start.y) / (end.y - start.y || 1);
            const clamped = Math.min(1, Math.max(0, bend));
            st().updateElement(c.id, { bend: clamped } as Partial<PlanElement>, false);
            if (c.routing === 'hvh') n.y(bendPos.y - 6 * px);
            else n.x(bendPos.x - 6 * px);
          }}
        />
      )}
      <Circle
        x={path.end.x}
        y={path.end.y}
        radius={9 * px}
        fill="#ffffff"
        stroke={PRIMARY}
        strokeWidth={2.5 * px}
        draggable
        onDragStart={() => st().commit()}
        onDragMove={(e) => {
          const n = e.target;
          const snap = snapToRoutes({ x: n.x(), y: n.y() }, getPageElements());
          if (!snap) return;
          n.position({ x: snap.x, y: snap.y });
          st().updateElement(c.id, { to: { mapId: snap.mapId, routeId: snap.routeId, d: snap.d } } as Partial<PlanElement>, false);
        }}
        onMouseEnter={(e) => {
          const s = e.target.getStage();
          if (s) s.container().style.cursor = 'move';
        }}
        onMouseLeave={(e) => {
          const s = e.target.getStage();
          if (s) s.container().style.cursor = '';
        }}
      />
    </>
  );
}

/** Drag the picture under its frame to choose the visible part. */
function CropOverlay({ el, px }: { el: ImageElement; px: number }) {
  const img = useLoadedImage(el.src);
  if (!img) return null;
  const dispW = el.width / el.crop.w;
  const dispH = el.height / el.crop.h;
  const gx = -el.crop.x * dispW;
  const gy = -el.crop.y * dispH;
  return (
    <Group x={el.x} y={el.y} rotation={el.rotation}>
      <KImage
        image={img}
        x={gx}
        y={gy}
        width={dispW}
        height={dispH}
        opacity={0.45}
        draggable
        onDragStart={() => useEditor.getState().commit()}
        onDragMove={(e) => {
          const n = e.target;
          const x = Math.min(0, Math.max(el.width - dispW, n.x()));
          const y = Math.min(0, Math.max(el.height - dispH, n.y()));
          n.position({ x, y });
          useEditor
            .getState()
            .updateElement(el.id, { crop: { ...el.crop, x: -x / dispW, y: -y / dispH } } as Partial<PlanElement>, false);
        }}
      />
      <Group clipX={0} clipY={0} clipWidth={el.width} clipHeight={el.height} listening={false}>
        <KImage image={img} x={gx} y={gy} width={dispW} height={dispH} />
      </Group>
      <Rect width={el.width} height={el.height} stroke={PRIMARY} strokeWidth={2 * px} listening={false} />
    </Group>
  );
}

// ---- HTML chrome over the canvas ------------------------------------------------------------

function ConnectBanner() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-[#191b24]/90 px-4 py-2 text-xs text-white shadow-lg backdrop-blur">
        <span className="material-symbols-outlined text-base text-[#b4c5ff]">conversion_path</span>
        <span>คลิกบนเส้นทางในแผนที่เพื่อวางปลายเส้นชี้</span>
        <button
          className="rounded-full bg-white/15 px-3 py-1 font-semibold hover:bg-white/25"
          onClick={() => {
            useEditor.getState().setTool({ mode: 'select' });
            useOverlay.setState({ connectPreview: null });
          }}
        >
          ยกเลิก (Esc)
        </button>
      </div>
    </div>
  );
}

function CropToolbar({ el }: { el: ImageElement }) {
  const base = coverCrop(el.naturalWidth, el.naturalHeight, el.width, el.height);
  const zoom = base.w / el.crop.w;
  const setZoom = (z: number) => {
    const center = { x: el.crop.x + el.crop.w / 2, y: el.crop.y + el.crop.h / 2 };
    useEditor
      .getState()
      .updateElement(el.id, { crop: coverCrop(el.naturalWidth, el.naturalHeight, el.width, el.height, center, z) } as Partial<PlanElement>, 'crop-zoom');
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--pe-border)] bg-[var(--pe-panel)] px-4 py-2 text-xs text-[var(--pe-text)] shadow-lg">
        <span className="material-symbols-outlined text-base text-[var(--pe-primary)]">crop</span>
        <span className="hidden sm:inline">ลากรูปเพื่อเลือกส่วนที่แสดง</span>
        <span className="material-symbols-outlined text-base text-[var(--pe-muted)]">zoom_out</span>
        <input
          type="range"
          min={1}
          max={5}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="pe-range w-28"
          aria-label="ซูมรูป"
        />
        <span className="material-symbols-outlined text-base text-[var(--pe-muted)]">zoom_in</span>
        <button className="rounded-full px-2 py-1 hover:bg-[var(--pe-hover)]" onClick={() => setZoom(1)}>
          รีเซ็ต
        </button>
        <button
          className="rounded-full bg-[var(--pe-primary)] px-3 py-1 font-semibold text-white"
          onClick={() => useEditor.getState().setCrop(null)}
        >
          เสร็จ
        </button>
      </div>
    </div>
  );
}

function Toast() {
  const msg = useSyncExternalStore(
    (cb) => {
      toastStore.listeners.add(cb);
      return () => toastStore.listeners.delete(cb);
    },
    () => toastStore.msg,
    () => '',
  );
  if (!msg) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
      <div className="rounded-full bg-[#191b24]/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur">{msg}</div>
    </div>
  );
}
