/**
 * Data model of the plan editor ("แผนงาน"). A plan is a multi-page design
 * document; every page holds a background and a z-ordered list of elements.
 * Everything here is plain JSON so a plan can be autosaved and restored.
 */

export type TextAlign = 'left' | 'center' | 'right';

/** Text styling shared by text elements and image captions. */
export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fill: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
}

interface ElementBase {
  id: string;
  /** Optional custom name shown in the layers panel. */
  name?: string;
  /** Top-left corner in page pixels; rotation pivots around it (Konva default). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0–1. */
  opacity: number;
  locked?: boolean;
  hidden?: boolean;
  /** Elements sharing a groupId are selected and moved together. */
  groupId?: string | null;
}

export interface TextElement extends ElementBase, TextStyle {
  type: 'text';
  text: string;
  /** Outline around the glyphs, handy for text on top of photos. */
  stroke: string | null;
  strokeWidth: number;
}

export type ShapeKind = 'rect' | 'circle' | 'triangle' | 'star' | 'diamond' | 'hexagon';

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke: string | null;
  strokeWidth: number;
  /** Rect only. */
  cornerRadius: number;
}

export type DashStyle = 'solid' | 'dashed' | 'dotted' | 'longdash' | 'dashdot';
export type LineCap = 'none' | 'arrow' | 'dot';

/** A straight line of length `width`, drawn through the middle of its box. */
export interface LineElement extends ElementBase {
  type: 'line';
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  startCap: LineCap;
  endCap: LineCap;
}

export interface IconElement extends ElementBase {
  type: 'icon';
  icon: string;
  fill: string;
}

/** Visible part of an image as fractions (0–1) of its natural size. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CaptionPosition = 'bottom' | 'top' | 'left' | 'right';

export interface ImageElement extends ElementBase {
  type: 'image';
  /** Empty string = placeholder slot waiting for a picture. */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** Event photo this came from, plus where it was taken (for route pointers). */
  photoId?: string;
  lat?: number;
  lng?: number;
  crop: Crop;
  flipX: boolean;
  /** -1 … 1 */
  brightness: number;
  /** -100 … 100 */
  contrast: number;
  grayscale: boolean;
  blur: number;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
  /** Optional text shown next to the picture ("" = none). */
  caption: string;
  captionStyle: TextStyle;
  captionPosition: CaptionPosition;
  captionGap: number;
}

export type Basemap = 'none' | 'satellite' | 'street' | 'topo' | 'light' | 'dark';

/** A route diagram rendered from the event's GPX files. */
export interface MapElement extends ElementBase {
  type: 'map';
  routeIds: string[];
  basemap: Basemap;
  basemapGray: boolean;
  /** Black overlay on the basemap, 0–0.9. */
  basemapDim: number;
  /** Fill behind the route when there is no basemap. */
  background: string;
  routeWidth: number;
  /** Per-route colour overrides; falls back to the route's own colour. */
  routeColors: Record<string, string>;
  routeOutline: boolean;
  showCps: boolean;
  showCpLabels: boolean;
  showStartEnd: boolean;
  showArrows: boolean;
  showAttribution: boolean;
  /** 1 = whole route fits; >1 zooms in. */
  zoom: number;
  /** Pan as a fraction of the route's bounding box (-0.5 … 0.5). */
  panX: number;
  panY: number;
  cornerRadius: number;
  borderColor: string;
  borderWidth: number;
}

export type ConnectorRouting = 'straight' | 'hv' | 'vh' | 'hvh' | 'vhv';
export type AttachSide = 'auto' | 'left' | 'right' | 'top' | 'bottom';

/** Point on a route inside a map element, as distance (km) along the route. */
export interface RouteAnchor {
  mapId: string;
  routeId: string;
  d: number;
}

/**
 * Pointer line from an element (usually a photo) to a spot on a route. The
 * route end can only sit on a route — it is stored as a distance along it, so
 * it follows the route when the map is moved, resized or zoomed.
 */
export interface ConnectorElement extends ElementBase {
  type: 'connector';
  fromId: string;
  fromSide: AttachSide;
  to: RouteAnchor;
  routing: ConnectorRouting;
  /** Where the middle bend sits for hvh / vhv, 0–1. */
  bend: number;
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  startCap: LineCap;
  endCap: LineCap;
}

export type PlanElement =
  | TextElement
  | ShapeElement
  | LineElement
  | IconElement
  | ImageElement
  | MapElement
  | ConnectorElement;

export type ElementType = PlanElement['type'];

export type Background =
  | { type: 'color'; color: string }
  | { type: 'gradient'; from: string; to: string; angle: number }
  | { type: 'image'; src: string; dim: number };

export interface Page {
  id: string;
  background: Background;
  elements: PlanElement[];
}

export interface UploadedImage {
  id: string;
  src: string;
  width: number;
  height: number;
  name: string;
}

export interface PlanDoc {
  id: string;
  slug: string;
  name: string;
  width: number;
  height: number;
  pages: Page[];
  uploads: UploadedImage[];
  createdAt: string;
  updatedAt: string;
}

/** Summary row for the "recent plans" list. */
export interface PlanMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  pageCount: number;
  updatedAt: string;
  thumb?: string;
}
