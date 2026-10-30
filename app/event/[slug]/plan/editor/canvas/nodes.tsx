'use client';

/** Konva renderers for each element type plus the page background. */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Arrow, Circle, Ellipse, Group, Image as KImage, Line, Path, Rect, RegularPolygon, Text } from 'react-konva';
import type {
  Background,
  ConnectorElement,
  IconElement,
  ImageElement,
  LineElement,
  MapElement,
  PlanElement,
  ShapeElement,
  TextElement,
  TextStyle,
} from '../types';
import { dashArray, ICONS } from '../constants';
import {
  basemapCredit,
  basemapKey,
  connectorPath,
  mapGeoms,
  mapView,
  project,
  projectRoute,
  renderBasemap,
  worldAt,
} from '../geometry';
import { ensureFont, loadImage, track, useAssetVersion } from '../runtime';
import { useEditor } from '../store';
import {
  onDragEnd,
  onDragMove,
  onDragStart,
  onElementPointerDown,
  onTextTransform,
  onTransformEnd,
  pinBox,
  setHover,
} from './interaction';
import { trRef } from './trRef';

// ---- Shared hooks ---------------------------------------------------------------------

/** Loaded image for a src (null while loading / on error). */
export function useLoadedImage(src: string) {
  const [state, setState] = useState<{ src: string; img: HTMLImageElement | null }>({ src: '', img: null });
  useEffect(() => {
    if (!src) return;
    let alive = true;
    loadImage(src)
      .then((img) => alive && setState({ src, img }))
      .catch(() => alive && setState({ src, img: null }));
    return () => {
      alive = false;
    };
  }, [src]);
  return state.src === src ? state.img : null;
}

/** Props every element root needs: position, selection, drag, transform. */
function useCommon(el: PlanElement) {
  const selectMode = useEditor((s) => s.tool.mode === 'select');
  return {
    id: el.id,
    name: 'element',
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: el.opacity,
    draggable: !el.locked && selectMode,
    onPointerDown: (e: Konva.KonvaEventObject<PointerEvent>) => onElementPointerDown(e, el),
    onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => onDragStart(e, el),
    onDragMove,
    onDragEnd,
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => onTransformEnd(e, el.id),
    onMouseEnter: () => setHover(el.id),
    onMouseLeave: () => setHover(null),
  };
}

const fontStyle = (s: Pick<TextStyle, 'bold' | 'italic'>) =>
  `${s.italic ? 'italic ' : ''}${s.bold ? 'bold' : 'normal'}`;

/** Re-measure a Konva text node once its web font has loaded. */
function useFontRefresh(ref: React.RefObject<Konva.Text | null>, family: string) {
  const version = useAssetVersion();
  useEffect(() => ensureFont(family), [family]);
  useEffect(() => {
    const n = ref.current as unknown as { _setTextData?: () => void; getLayer: () => Konva.Layer | null } | null;
    n?._setTextData?.();
    n?.getLayer()?.batchDraw();
  }, [version, ref]);
  return version;
}

// ---- Background ----------------------------------------------------------------------

export function BackgroundNode({ bg, w, h }: { bg: Background; w: number; h: number }) {
  const img = useLoadedImage(bg.type === 'image' ? bg.src : '');
  if (bg.type === 'gradient') {
    const a = (bg.angle * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const len = Math.abs(w * dx) + Math.abs(h * dy);
    return (
      <Rect
        name="page-bg"
        width={w}
        height={h}
        fillLinearGradientStartPoint={{ x: w / 2 - (dx * len) / 2, y: h / 2 - (dy * len) / 2 }}
        fillLinearGradientEndPoint={{ x: w / 2 + (dx * len) / 2, y: h / 2 + (dy * len) / 2 }}
        fillLinearGradientColorStops={[0, bg.from, 1, bg.to]}
      />
    );
  }
  if (bg.type === 'image') {
    let crop: { x: number; y: number; width: number; height: number } | undefined;
    if (img) {
      const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const cw = w / k;
      const ch = h / k;
      crop = { x: (img.naturalWidth - cw) / 2, y: (img.naturalHeight - ch) / 2, width: cw, height: ch };
    }
    return (
      <Group name="page-bg">
        <Rect name="page-bg" width={w} height={h} fill="#191b24" />
        {img && <KImage name="page-bg" image={img} crop={crop} width={w} height={h} />}
        {bg.dim > 0 && <Rect name="page-bg" width={w} height={h} fill="#000" opacity={bg.dim} />}
      </Group>
    );
  }
  return <Rect name="page-bg" width={w} height={h} fill={bg.color} />;
}

// ---- Text -------------------------------------------------------------------------------

const TextNode = memo(function TextNode({ el }: { el: TextElement }) {
  const common = useCommon(el);
  const ref = useRef<Konva.Text>(null);
  const editing = useEditor((s) => s.editing?.id === el.id && s.editing.field === 'text');
  const version = useFontRefresh(ref, el.fontFamily);

  // Keep the stored height in sync with the wrapped text (used by guides/align).
  useLayoutEffect(() => {
    const n = ref.current;
    if (!n) return;
    const h = n.height();
    if (Math.abs(h - el.height) > 0.5) useEditor.getState().updateElement(el.id, { height: h }, false);
  });
  void version;

  return (
    <Text
      ref={ref}
      {...common}
      visible={!el.hidden && !editing}
      text={el.text}
      width={el.width}
      fontFamily={el.fontFamily}
      fontSize={el.fontSize}
      fontStyle={fontStyle(el)}
      textDecoration={el.underline ? 'underline' : ''}
      align={el.align}
      lineHeight={el.lineHeight}
      letterSpacing={el.letterSpacing}
      fill={el.fill}
      stroke={el.stroke ?? undefined}
      strokeWidth={el.stroke ? el.strokeWidth : 0}
      fillAfterStrokeEnabled
      onTransform={(e) => onTextTransform(e, trRef.current)}
      onDblClick={() => !el.locked && useEditor.getState().setEditing({ id: el.id, field: 'text' })}
      onDblTap={() => !el.locked && useEditor.getState().setEditing({ id: el.id, field: 'text' })}
    />
  );
});

// ---- Shapes ----------------------------------------------------------------------------

function starPoints(w: number, h: number) {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.2 : 0.5;
    pts.push(w / 2 + Math.cos(a) * r * w, h * 0.55 + Math.sin(a) * r * h * 1.05);
  }
  return pts;
}

const ShapeNode = memo(function ShapeNode({ el }: { el: ShapeElement }) {
  const common = useCommon(el);
  const { width: w, height: h } = el;
  const paint = {
    fill: el.fill,
    stroke: el.stroke ?? undefined,
    strokeWidth: el.stroke ? el.strokeWidth : 0,
  };
  let shape: React.ReactNode;
  switch (el.shape) {
    case 'circle':
      shape = <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...paint} />;
      break;
    case 'triangle':
      shape = <Line points={[w / 2, 0, w, h, 0, h]} closed lineJoin="round" {...paint} />;
      break;
    case 'diamond':
      shape = <Line points={[w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]} closed lineJoin="round" {...paint} />;
      break;
    case 'hexagon':
      shape = <Line points={[w * 0.25, 0, w * 0.75, 0, w, h / 2, w * 0.75, h, w * 0.25, h, 0, h / 2]} closed lineJoin="round" {...paint} />;
      break;
    case 'star':
      shape = <Line points={starPoints(w, h)} closed lineJoin="round" {...paint} />;
      break;
    default:
      shape = <Rect width={w} height={h} cornerRadius={Math.min(el.cornerRadius, w / 2, h / 2)} {...paint} />;
  }
  return (
    <Group ref={pinBox} {...common} visible={!el.hidden} width={w} height={h}>
      {shape}
    </Group>
  );
});

// ---- Lines -----------------------------------------------------------------------------

/** Path with optional arrow / dot ends; shared by lines and connectors. */
function Stroke({
  points,
  stroke,
  strokeWidth,
  dash,
  startCap,
  endCap,
}: {
  points: number[];
  stroke: string;
  strokeWidth: number;
  dash: LineElement['dash'];
  startCap: LineElement['startCap'];
  endCap: LineElement['endCap'];
}) {
  const n = points.length;
  const dot = Math.max(3, strokeWidth * 2);
  return (
    <>
      <Arrow
        points={points}
        stroke={stroke}
        fill={stroke}
        strokeWidth={strokeWidth}
        dash={dashArray(dash, strokeWidth)}
        lineCap={dash === 'dotted' ? 'round' : 'butt'}
        lineJoin="round"
        pointerAtBeginning={startCap === 'arrow'}
        pointerAtEnding={endCap === 'arrow'}
        pointerLength={strokeWidth * 3.2}
        pointerWidth={strokeWidth * 3.2}
        hitStrokeWidth={Math.max(16, strokeWidth + 10)}
      />
      {startCap === 'dot' && <Circle x={points[0]} y={points[1]} radius={dot} fill={stroke} />}
      {endCap === 'dot' && <Circle x={points[n - 2]} y={points[n - 1]} radius={dot} fill={stroke} />}
    </>
  );
}

const LineNode = memo(function LineNode({ el }: { el: LineElement }) {
  const common = useCommon(el);
  const pad = el.endCap === 'none' && el.startCap === 'none' ? 0 : el.strokeWidth * 2;
  return (
    <Group ref={pinBox} {...common} visible={!el.hidden} width={el.width} height={el.height}>
      <Rect width={el.width} height={el.height} fill="transparent" />
      <Stroke
        points={[pad, el.height / 2, el.width - pad, el.height / 2]}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        dash={el.dash}
        startCap={el.startCap}
        endCap={el.endCap}
      />
    </Group>
  );
});

// ---- Icons -------------------------------------------------------------------------------

const IconNode = memo(function IconNode({ el }: { el: IconElement }) {
  const common = useCommon(el);
  return (
    <Group ref={pinBox} {...common} visible={!el.hidden} width={el.width} height={el.height}>
      <Rect width={el.width} height={el.height} fill="transparent" />
      <Path data={ICONS[el.icon]?.path ?? ICONS.star.path} fill={el.fill} scaleX={el.width / 24} scaleY={el.height / 24} />
    </Group>
  );
});

// ---- Images (+ caption) --------------------------------------------------------------

function captionLayout(el: ImageElement) {
  const big = 2000;
  const sideW = Math.max(el.width, el.captionStyle.fontSize * 8);
  switch (el.captionPosition) {
    case 'top':
      return { x: 0, y: -el.captionGap - big, width: el.width, height: big, verticalAlign: 'bottom' };
    case 'left':
      return { x: -el.captionGap - sideW, y: 0, width: sideW, height: el.height, verticalAlign: 'middle' };
    case 'right':
      return { x: el.width + el.captionGap, y: 0, width: sideW, height: el.height, verticalAlign: 'middle' };
    default:
      return { x: 0, y: el.height + el.captionGap, width: el.width, height: undefined, verticalAlign: 'top' };
  }
}

export function ImagePicture({ el, img }: { el: ImageElement; img: HTMLImageElement | null }) {
  const ref = useRef<Konva.Image>(null);
  const filtered = el.brightness !== 0 || el.contrast !== 0 || el.grayscale || el.blur > 0;
  const nw = img?.naturalWidth ?? 1;
  const nh = img?.naturalHeight ?? 1;
  const crop = { x: el.crop.x * nw, y: el.crop.y * nh, width: el.crop.w * nw, height: el.crop.h * nh };

  useEffect(() => {
    const n = ref.current;
    if (!n || !img) return;
    if (filtered) n.cache({ pixelRatio: Math.min(3, Math.max(1, (crop.width / el.width) || 1)) });
    else n.clearCache();
    n.getLayer()?.batchDraw();
  });

  if (!img) return null;
  const filters = [
    el.brightness !== 0 && Konva.Filters.Brighten,
    el.contrast !== 0 && Konva.Filters.Contrast,
    el.grayscale && Konva.Filters.Grayscale,
    el.blur > 0 && Konva.Filters.Blur,
  ].filter(Boolean) as Konva.Filter[];
  return (
    <KImage
      ref={ref}
      image={img}
      crop={crop}
      width={el.width}
      height={el.height}
      cornerRadius={el.cornerRadius}
      scaleX={el.flipX ? -1 : 1}
      x={el.flipX ? el.width : 0}
      filters={filters}
      brightness={el.brightness}
      contrast={el.contrast}
      blurRadius={el.blur}
    />
  );
}

const ImageNode = memo(function ImageNode({ el }: { el: ImageElement }) {
  const common = useCommon(el);
  const img = useLoadedImage(el.src);
  const captionRef = useRef<Konva.Text>(null);
  const editingCaption = useEditor((s) => s.editing?.id === el.id && s.editing.field === 'caption');
  useFontRefresh(captionRef, el.captionStyle.fontFamily);
  const bw = el.borderWidth;
  const cap = captionLayout(el);
  const cs = el.captionStyle;

  return (
    <>
      <Group
        ref={pinBox}
        {...common}
        visible={!el.hidden}
        width={el.width}
        height={el.height}
        onDblClick={() => el.src && !el.locked && useEditor.getState().setCrop(el.id)}
        onDblTap={() => el.src && !el.locked && useEditor.getState().setCrop(el.id)}
      >
        {el.src ? (
          <>
            <Rect width={el.width} height={el.height} fill="#c2c6d9" opacity={img ? 0 : 0.4} cornerRadius={el.cornerRadius} />
            <ImagePicture el={el} img={img} />
          </>
        ) : (
          <>
            <Rect
              width={el.width}
              height={el.height}
              fill="#c2c6d9"
              opacity={0.45}
              stroke="#737687"
              strokeWidth={Math.max(1.5, el.width / 200)}
              dash={[8, 6]}
              cornerRadius={el.cornerRadius}
            />
            <Path
              data={ICONS.camera.path}
              fill="#737687"
              scaleX={Math.min(el.width, el.height) / 80}
              scaleY={Math.min(el.width, el.height) / 80}
              x={el.width / 2 - (Math.min(el.width, el.height) / 80) * 12}
              y={el.height / 2 - (Math.min(el.width, el.height) / 80) * 12}
            />
          </>
        )}
        {bw > 0 && (
          <Rect
            x={bw / 2}
            y={bw / 2}
            width={Math.max(0, el.width - bw)}
            height={Math.max(0, el.height - bw)}
            stroke={el.borderColor}
            strokeWidth={bw}
            cornerRadius={Math.max(0, el.cornerRadius - bw / 2)}
            listening={false}
          />
        )}
      </Group>
      {el.caption && !el.hidden && (
        <Group x={el.x} y={el.y} rotation={el.rotation} opacity={el.opacity}>
          <Text
            ref={captionRef}
            id={`cap-${el.id}`}
            name="caption"
            visible={!editingCaption}
            {...cap}
            verticalAlign={cap.verticalAlign}
            text={el.caption}
            fontFamily={cs.fontFamily}
            fontSize={cs.fontSize}
            fontStyle={fontStyle(cs)}
            textDecoration={cs.underline ? 'underline' : ''}
            align={el.captionPosition === 'left' ? 'right' : el.captionPosition === 'right' ? 'left' : cs.align}
            lineHeight={cs.lineHeight}
            letterSpacing={cs.letterSpacing}
            fill={cs.fill}
            onPointerDown={(e) => onElementPointerDown(e, el)}
            onDblClick={() => !el.locked && useEditor.getState().setEditing({ id: el.id, field: 'caption' })}
            onDblTap={() => !el.locked && useEditor.getState().setEditing({ id: el.id, field: 'caption' })}
          />
        </Group>
      )}
    </>
  );
});

// ---- Map -------------------------------------------------------------------------------------

/** Basemap canvas for the map's current view, debounced while resizing. */
function useBasemap(el: MapElement, view: ReturnType<typeof mapView>) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const key = view && el.basemap !== 'none' ? basemapKey(el, view) : '';
  useEffect(() => {
    if (!key || !view) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let release = () => {};
    // Track the debounce too so export waits for the final render.
    void track(
      new Promise<void>((resolve) => {
        release = resolve;
        timer = setTimeout(() => {
          if (!alive) return resolve();
          renderBasemap(el, view).then((c) => {
            if (alive) setCanvas(c);
            resolve();
          });
        }, 200);
      }),
    );
    return () => {
      alive = false;
      clearTimeout(timer);
      release();
    };
    // `key` captures everything about el/view that affects the tiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key ? canvas : null;
}

const MapNode = memo(function MapNode({ el }: { el: MapElement }) {
  const common = useCommon(el);
  const routes = useEditor((s) => s.routes);
  const version = useAssetVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geoms = useMemo(() => mapGeoms(el), [el.routeIds, version]);
  const view = useMemo(() => mapView(el, geoms), [el, geoms]);
  const basemap = useBasemap(el, view);
  const { width: w, height: h } = el;
  const rw = el.routeWidth;

  const drawn = useMemo(() => {
    if (!view) return [];
    return geoms.map((g) => {
      const color = el.routeColors[g.id] ?? routes.find((r) => r._id === g.id)?.color ?? '#ef4444';
      const at = (d: number) => {
        const p = worldAt(g, d);
        return { ...project(view, p.wx, p.wy), i: p.i };
      };
      const arrows: { x: number; y: number; angle: number }[] = [];
      if (el.showArrows && g.total > 0.5) {
        const step = g.total / 9;
        for (let d = step; d < g.total - step / 2; d += step) {
          const a = at(d);
          const b = at(Math.min(g.total, d + g.total / 400 + 0.02));
          arrows.push({ x: a.x, y: a.y, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI });
        }
      }
      const start = at(0);
      const end = at(g.total);
      return {
        id: g.id,
        color,
        points: projectRoute(view, g),
        arrows,
        cps: el.showCps ? g.cps.map((c) => ({ ...c, ...at(c.d) })) : [],
        start,
        end,
        loop: Math.hypot(start.x - end.x, start.y - end.y) < rw * 4,
      };
    });
  }, [geoms, view, el.routeColors, el.showArrows, el.showCps, routes, rw]);

  const clip = (ctx: Konva.Context) => {
    const r = Math.min(el.cornerRadius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
  };
  const loading = el.routeIds.length > 0 && !geoms.length;
  const labelSize = Math.max(11, rw * 3.4);

  return (
    <Group ref={pinBox} {...common} visible={!el.hidden} width={w} height={h}>
      <Group clipFunc={clip}>
        <Rect width={w} height={h} fill={el.background} />
        {basemap && <KImage image={basemap} width={w} height={h} listening={false} />}
        {el.basemap !== 'none' && el.basemapDim > 0 && (
          <Rect width={w} height={h} fill="#000" opacity={el.basemapDim} listening={false} />
        )}
        {drawn.map((r) => (
          <Group key={r.id} listening={false}>
            {el.routeOutline && (
              <Line points={r.points} stroke="#ffffff" strokeWidth={rw + Math.max(2, rw * 0.9)} lineCap="round" lineJoin="round" opacity={0.9} />
            )}
            <Line points={r.points} stroke={r.color} strokeWidth={rw} lineCap="round" lineJoin="round" />
            {r.arrows.map((a, i) => (
              <RegularPolygon key={i} x={a.x} y={a.y} sides={3} radius={rw * 2.2} rotation={a.angle + 90} fill="#ffffff" stroke={r.color} strokeWidth={Math.max(1, rw * 0.3)} />
            ))}
            {r.cps.map((c, i) => (
              <Group key={i} x={c.x} y={c.y}>
                <Circle radius={rw * 1.9} fill="#ffffff" stroke={r.color} strokeWidth={Math.max(1.5, rw * 0.6)} />
                {el.showCpLabels && (
                  <Text
                    x={rw * 2.6}
                    y={-labelSize * 1.1}
                    text={c.label}
                    fontFamily="Kanit"
                    fontStyle="bold"
                    fontSize={labelSize}
                    fill="#ffffff"
                    stroke="#191b24"
                    strokeWidth={labelSize / 5}
                    fillAfterStrokeEnabled
                  />
                )}
              </Group>
            ))}
            {el.showStartEnd && (
              <>
                {!r.loop && <Circle x={r.end.x} y={r.end.y} radius={rw * 2.3} fill="#191b24" stroke="#ffffff" strokeWidth={Math.max(2, rw * 0.7)} />}
                <Circle x={r.start.x} y={r.start.y} radius={rw * 2.3} fill="#ffffff" stroke={r.color} strokeWidth={Math.max(2, rw * 0.8)} />
                <Circle x={r.start.x} y={r.start.y} radius={rw * 0.9} fill={r.color} />
              </>
            )}
          </Group>
        ))}
        {(loading || !el.routeIds.length) && (
          <Text
            width={w}
            height={h}
            align="center"
            verticalAlign="middle"
            text={loading ? 'กำลังโหลดเส้นทาง…' : 'เลือกเส้นทางในแผงคุณสมบัติ'}
            fontFamily="Prompt"
            fontSize={Math.max(14, Math.min(w, h) / 18)}
            fill="#c2c6d9"
          />
        )}
        {el.showAttribution && el.basemap !== 'none' && (
          <Text
            x={0}
            y={h - Math.max(9, w / 140) * 1.6}
            width={w - 6}
            align="right"
            text={basemapCredit(el.basemap)}
            fontSize={Math.max(9, w / 140)}
            fill="#ffffff"
            opacity={0.7}
            listening={false}
          />
        )}
      </Group>
      {el.borderWidth > 0 && (
        <Rect
          x={el.borderWidth / 2}
          y={el.borderWidth / 2}
          width={w - el.borderWidth}
          height={h - el.borderWidth}
          cornerRadius={Math.max(0, el.cornerRadius - el.borderWidth / 2)}
          stroke={el.borderColor}
          strokeWidth={el.borderWidth}
          listening={false}
        />
      )}
    </Group>
  );
});

// ---- Connectors -------------------------------------------------------------------------

const ConnectorNode = memo(function ConnectorNode({ el, elements }: { el: ConnectorElement; elements: PlanElement[] }) {
  useAssetVersion();
  const path = connectorPath(el, elements);
  if (!path || el.hidden) return null;
  return (
    <Group
      id={el.id}
      name="element connector"
      opacity={el.opacity}
      onPointerDown={(e) => onElementPointerDown(e, el)}
      onMouseEnter={() => setHover(el.id)}
      onMouseLeave={() => setHover(null)}
    >
      <Stroke
        points={path.points}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        dash={el.dash}
        startCap={el.startCap}
        endCap={el.endCap}
      />
    </Group>
  );
});

// ---- Dispatcher ------------------------------------------------------------------------------

export function ElementNode({ el, elements }: { el: PlanElement; elements: PlanElement[] }) {
  switch (el.type) {
    case 'text':
      return <TextNode el={el} />;
    case 'shape':
      return <ShapeNode el={el} />;
    case 'line':
      return <LineNode el={el} />;
    case 'icon':
      return <IconNode el={el} />;
    case 'image':
      return <ImageNode el={el} />;
    case 'map':
      return <MapNode el={el} />;
    case 'connector':
      return <ConnectorNode el={el} elements={elements} />;
  }
}
