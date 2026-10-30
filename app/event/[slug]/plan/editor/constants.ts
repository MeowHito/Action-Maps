import type {
  DashStyle,
  IconElement,
  ImageElement,
  LineElement,
  MapElement,
  ShapeElement,
  ShapeKind,
  TextElement,
  TextStyle,
} from './types';

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---- Page sizes offered when starting a plan ----------------------------

export interface SizePreset {
  id: string;
  label: string;
  hint: string;
  icon: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'presentation', label: 'Presentation', hint: '1920 × 1080', icon: 'slideshow', width: 1920, height: 1080 },
  { id: 'ig-post', label: 'Instagram Post', hint: '1080 × 1080', icon: 'crop_square', width: 1080, height: 1080 },
  { id: 'ig-story', label: 'Story', hint: '1080 × 1920', icon: 'smartphone', width: 1080, height: 1920 },
  { id: 'a4', label: 'A4 แนวตั้ง', hint: '1240 × 1754', icon: 'description', width: 1240, height: 1754 },
  { id: 'a4-land', label: 'A4 แนวนอน', hint: '1754 × 1240', icon: 'landscape', width: 1754, height: 1240 },
];

// ---- Fonts (Thai-capable first) -----------------------------------------

export const FONTS: { family: string; thai: boolean }[] = [
  { family: 'Prompt', thai: true },
  { family: 'Kanit', thai: true },
  { family: 'Sarabun', thai: true },
  { family: 'Mitr', thai: true },
  { family: 'Noto Sans Thai', thai: true },
  { family: 'IBM Plex Sans Thai', thai: true },
  { family: 'Bai Jamjuree', thai: true },
  { family: 'Chakra Petch', thai: true },
  { family: 'Inter', thai: false },
  { family: 'Space Grotesk', thai: false },
  { family: 'Montserrat', thai: false },
  { family: 'Bebas Neue', thai: false },
];

/** Google Fonts stylesheet for every family in FONTS. */
export const FONTS_HREF =
  'https://fonts.googleapis.com/css2?' +
  [
    'family=Prompt:ital,wght@0,400;0,600;0,700;1,400;1,700',
    'family=Kanit:ital,wght@0,400;0,600;0,700;1,400;1,700',
    'family=Sarabun:ital,wght@0,400;0,700;1,400;1,700',
    'family=Mitr:wght@400;600',
    'family=Noto+Sans+Thai:wght@400;700',
    'family=IBM+Plex+Sans+Thai:wght@400;700',
    'family=Bai+Jamjuree:ital,wght@0,400;0,700;1,400;1,700',
    'family=Chakra+Petch:ital,wght@0,400;0,700;1,400;1,700',
    'family=Inter:ital,wght@0,400;0,700;1,400;1,700',
    'family=Space+Grotesk:wght@400;700',
    'family=Montserrat:ital,wght@0,400;0,700;1,400;1,700',
    'family=Bebas+Neue',
  ].join('&') +
  '&display=swap';

// ---- Colours ---------------------------------------------------------------

export const SWATCHES = [
  '#ffffff', '#f2f3ff', '#c2c6d9', '#737687', '#424656', '#191b24', '#000000',
  '#004cca', '#0062ff', '#b4c5ff', '#22c55e', '#16a34a', '#a3e635', '#facc15',
  '#f97316', '#ef4444', '#dc2626', '#ec4899', '#a855f7', '#14b8a6', '#2f5d3a',
];

export const GRADIENTS: { from: string; to: string; angle: number }[] = [
  { from: '#004cca', to: '#0062ff', angle: 135 },
  { from: '#191b24', to: '#424656', angle: 160 },
  { from: '#0f2027', to: '#2c5364', angle: 135 },
  { from: '#f97316', to: '#ef4444', angle: 135 },
  { from: '#22c55e', to: '#14b8a6', angle: 135 },
  { from: '#facc15', to: '#f97316', angle: 160 },
  { from: '#a855f7', to: '#004cca', angle: 135 },
  { from: '#f2f3ff', to: '#b4c5ff', angle: 180 },
];

// ---- Icons (Material Design paths, 24 × 24 viewBox) -----------------------

export const ICONS: Record<string, { label: string; path: string }> = {
  place: { label: 'หมุด', path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' },
  flag: { label: 'ธง', path: 'M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z' },
  star: { label: 'ดาว', path: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z' },
  car: { label: 'รถ', path: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z' },
  run: { label: 'นักวิ่ง', path: 'M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z' },
  camera: { label: 'กล้อง', path: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z' },
  clock: { label: 'เวลา', path: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z' },
  water: { label: 'น้ำ', path: 'M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8z' },
  food: { label: 'อาหาร', path: 'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z' },
  medical: { label: 'พยาบาล', path: 'M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z' },
  mountain: { label: 'ภูเขา', path: 'M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z' },
  home: { label: 'บ้าน', path: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z' },
  parking: { label: 'ที่จอดรถ', path: 'M13 3H6v18h4v-6h3c3.31 0 6-2.69 6-6s-2.69-6-6-6zm.2 8H10V7h3.2c1.1 0 2 .9 2 2s-.9 2-2 2z' },
  compass: { label: 'เข็มทิศ', path: 'M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z' },
  north: { label: 'ทิศเหนือ', path: 'M5 9l1.41 1.41L11 5.83V22h2V5.83l4.59 4.59L19 9l-7-7-7 7z' },
  info: { label: 'ข้อมูล', path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z' },
  warning: { label: 'ระวัง', path: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z' },
  check: { label: 'ถูก', path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z' },
  heart: { label: 'หัวใจ', path: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
};

// ---- Dash patterns (scaled by stroke width) ---------------------------------

export const DASH_STYLES: { id: DashStyle; label: string }[] = [
  { id: 'solid', label: 'เส้นทึบ' },
  { id: 'dashed', label: 'เส้นประ' },
  { id: 'longdash', label: 'ประยาว' },
  { id: 'dotted', label: 'จุดไข่ปลา' },
  { id: 'dashdot', label: 'ประ-จุด' },
];

export function dashArray(style: DashStyle, w: number): number[] | undefined {
  const s = Math.max(1, w);
  switch (style) {
    case 'dashed':
      return [s * 4, s * 3];
    case 'longdash':
      return [s * 9, s * 4];
    case 'dotted':
      return [0.001, s * 2.2];
    case 'dashdot':
      return [s * 6, s * 3, 0.001, s * 3];
    default:
      return undefined;
  }
}

// ---- Element factories ------------------------------------------------------

export const defaultTextStyle = (fontSize: number): TextStyle => ({
  fontFamily: 'Prompt',
  fontSize,
  fill: '#191b24',
  bold: false,
  italic: false,
  underline: false,
  align: 'left',
  lineHeight: 1.25,
  letterSpacing: 0,
});

export function makeText(
  text: string,
  x: number,
  y: number,
  style: Partial<TextStyle> & { fontSize: number },
  width?: number,
): TextElement {
  const s = { ...defaultTextStyle(style.fontSize), ...style };
  return {
    id: uid(),
    type: 'text',
    text,
    x,
    y,
    width: width ?? Math.max(120, s.fontSize * Math.max(4, text.length * 0.62)),
    height: s.fontSize * s.lineHeight,
    rotation: 0,
    opacity: 1,
    stroke: null,
    strokeWidth: 0,
    ...s,
  };
}

export function makeShape(shape: ShapeKind, x: number, y: number, size: number): ShapeElement {
  return {
    id: uid(),
    type: 'shape',
    shape,
    x,
    y,
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    fill: '#004cca',
    stroke: null,
    strokeWidth: 0,
    cornerRadius: 0,
  };
}

export function makeLine(
  x: number,
  y: number,
  length: number,
  opts: Partial<Pick<LineElement, 'dash' | 'startCap' | 'endCap' | 'stroke' | 'strokeWidth'>> = {},
): LineElement {
  const strokeWidth = opts.strokeWidth ?? Math.max(3, length / 80);
  return {
    id: uid(),
    type: 'line',
    x,
    y,
    width: length,
    height: Math.max(strokeWidth, 12),
    rotation: 0,
    opacity: 1,
    stroke: '#191b24',
    strokeWidth,
    dash: 'solid',
    startCap: 'none',
    endCap: 'none',
    ...opts,
  };
}

export function makeIcon(icon: string, x: number, y: number, size: number): IconElement {
  return {
    id: uid(),
    type: 'icon',
    icon,
    x,
    y,
    width: size,
    height: size,
    rotation: 0,
    opacity: 1,
    fill: '#004cca',
  };
}

/** Largest crop with the box's aspect ratio, centred on `center`. */
export function coverCrop(
  natW: number,
  natH: number,
  boxW: number,
  boxH: number,
  center = { x: 0.5, y: 0.5 },
  zoom = 1,
) {
  if (!natW || !natH || !boxW || !boxH) return { x: 0, y: 0, w: 1, h: 1 };
  const boxAspect = boxW / boxH;
  const natAspect = natW / natH;
  let w = 1;
  let h = 1;
  if (natAspect > boxAspect) w = boxAspect / natAspect;
  else h = natAspect / boxAspect;
  w /= zoom;
  h /= zoom;
  const x = Math.min(1 - w, Math.max(0, center.x - w / 2));
  const y = Math.min(1 - h, Math.max(0, center.y - h / 2));
  return { x, y, w, h };
}

export function makeImage(
  src: string,
  naturalWidth: number,
  naturalHeight: number,
  x: number,
  y: number,
  width: number,
  height?: number,
  extra: Partial<ImageElement> = {},
): ImageElement {
  const h = height ?? (naturalWidth ? (width * naturalHeight) / naturalWidth : width * 0.66);
  return {
    id: uid(),
    type: 'image',
    src,
    naturalWidth,
    naturalHeight,
    x,
    y,
    width,
    height: h,
    rotation: 0,
    opacity: 1,
    crop: coverCrop(naturalWidth, naturalHeight, width, h),
    flipX: false,
    brightness: 0,
    contrast: 0,
    grayscale: false,
    blur: 0,
    borderColor: '#004cca',
    borderWidth: 0,
    cornerRadius: 0,
    caption: '',
    captionStyle: { ...defaultTextStyle(Math.max(14, Math.round(width / 9))), bold: true },
    captionPosition: 'bottom',
    captionGap: 8,
    ...extra,
  };
}

export function makeMap(
  routeIds: string[],
  x: number,
  y: number,
  width: number,
  height: number,
): MapElement {
  return {
    id: uid(),
    type: 'map',
    routeIds,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    basemap: 'satellite',
    basemapGray: true,
    basemapDim: 0.35,
    background: '#1f2230',
    routeWidth: Math.max(3, Math.round(Math.min(width, height) / 160)),
    routeColors: {},
    routeOutline: true,
    showCps: true,
    showCpLabels: true,
    showStartEnd: true,
    showArrows: true,
    showAttribution: true,
    zoom: 1,
    panX: 0,
    panY: 0,
    cornerRadius: 0,
    borderColor: '#ffffff',
    borderWidth: 0,
  };
}

/** Human-friendly default name for the layers panel. */
export function elementLabel(el: { type: string; name?: string } & Record<string, unknown>): string {
  if (el.name) return el.name;
  switch (el.type) {
    case 'text':
      return String(el.text || 'ข้อความ').split('\n')[0].slice(0, 28);
    case 'shape':
      return 'รูปทรง';
    case 'line':
      return 'เส้น';
    case 'icon':
      return ICONS[String(el.icon)]?.label ?? 'ไอคอน';
    case 'image':
      return el.caption ? `รูป · ${String(el.caption).split('\n')[0].slice(0, 20)}` : el.src ? 'รูปภาพ' : 'ช่องใส่รูป';
    case 'map':
      return 'แผนที่';
    case 'connector':
      return 'เส้นชี้';
    default:
      return el.type;
  }
}

/** "17KM", "49.5KM". */
export const formatKm = (d: number) => `${(Math.round(d * 10) / 10).toString()}KM`;
