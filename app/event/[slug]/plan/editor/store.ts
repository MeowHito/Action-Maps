/**
 * Editor state (Zustand). Holds the open plan, selection, undo/redo history,
 * viewport and UI state. Every document mutation goes through `commit()`
 * first so it can be undone.
 */
import { create } from 'zustand';
import type { EventDoc, PhotoDoc, RouteDoc } from '@/lib/types';
import type { Background, Page, PlanDoc, PlanElement, UploadedImage } from './types';
import { uid } from './constants';
import { elementBox, unionBox } from './geometry';

const HISTORY_LIMIT = 100;
/** Changes with the same coalesce key within this window share one undo step. */
const COALESCE_MS = 800;

interface Snapshot {
  pages: Page[];
  width: number;
  height: number;
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

export type Tool = { mode: 'select' } | { mode: 'connect'; fromId: string; connectorId?: string };

export type SidebarTab =
  | 'templates'
  | 'maps'
  | 'photos'
  | 'elements'
  | 'text'
  | 'uploads'
  | 'background'
  | 'layers';

/** `true` = new undo step, `false` = no history, string = coalesce key. */
type CommitOpt = boolean | string;

export type AlignKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

interface EditorState {
  doc: PlanDoc | null;
  pageIndex: number;
  selectedIds: string[];
  past: Snapshot[];
  future: Snapshot[];
  lastCommit: { key: string; at: number } | null;
  clipboard: PlanElement[];
  tool: Tool;
  cropId: string | null;
  editing: { id: string; field: 'text' | 'caption' } | null;
  view: View;
  viewport: { w: number; h: number };
  event: EventDoc | null;
  routes: RouteDoc[];
  photos: PhotoDoc[];
  sidebarTab: SidebarTab | null;
  propsOpen: boolean;
  layersOpen: boolean;
  theme: 'light' | 'dark';
  savedAt: number | null;
  exporting: boolean;

  setDoc: (doc: PlanDoc | null) => void;
  setEventData: (d: { event?: EventDoc | null; routes?: RouteDoc[]; photos?: PhotoDoc[] }) => void;
  commit: (key?: string) => void;
  undo: () => void;
  redo: () => void;

  setPageIndex: (i: number) => void;
  addElements: (els: PlanElement[], select?: boolean) => void;
  updateElement: (id: string, patch: Partial<PlanElement>, commit?: CommitOpt) => void;
  updateElements: (patches: { id: string; patch: Partial<PlanElement> }[], commit?: CommitOpt) => void;
  deleteElements: (ids: string[]) => void;
  select: (ids: string[], additive?: boolean) => void;
  duplicate: (ids: string[]) => void;
  copy: () => void;
  paste: () => void;
  group: () => void;
  ungroup: () => void;
  arrange: (dir: 'forward' | 'backward' | 'front' | 'back') => void;
  moveElement: (id: string, toIndex: number) => void;
  toggleLock: (ids: string[]) => void;
  toggleHidden: (id: string) => void;
  align: (kind: AlignKind) => void;
  distribute: (axis: 'h' | 'v') => void;
  nudge: (dx: number, dy: number) => void;

  setBackground: (bg: Background, allPages?: boolean) => void;
  addPage: () => void;
  duplicatePage: (i: number) => void;
  deletePage: (i: number) => void;
  movePage: (from: number, to: number) => void;
  replacePage: (content: { background: Background; elements: PlanElement[] }) => void;
  appendPages: (pages: { background: Background; elements: PlanElement[] }[], replaceEmptyFirst?: boolean) => void;
  setDocName: (name: string) => void;
  resizeDoc: (w: number, h: number) => void;
  addUpload: (u: UploadedImage) => void;
  removeUpload: (id: string) => void;

  setViewport: (w: number, h: number) => void;
  setView: (v: Partial<View>) => void;
  zoomAt: (scale: number, center?: { x: number; y: number }) => void;
  fitView: () => void;
  setTool: (t: Tool) => void;
  setCrop: (id: string | null) => void;
  setEditing: (e: EditorState['editing']) => void;
  setSidebarTab: (t: SidebarTab | null) => void;
  setPropsOpen: (v: boolean) => void;
  setLayersOpen: (v: boolean) => void;
  setTheme: (t: 'light' | 'dark') => void;
  markSaved: () => void;
  setExporting: (v: boolean) => void;
}

const clone = <T,>(v: T): T => structuredClone(v);

/** Expand a selection so grouped elements are always selected together. */
function withGroups(ids: string[], els: PlanElement[]): string[] {
  const groups = new Set(
    els.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId as string),
  );
  if (!groups.size) return ids;
  const out = new Set(ids);
  els.forEach((e) => e.groupId && groups.has(e.groupId) && out.add(e.id));
  return [...out];
}

export const blankPage = (): Page => ({
  id: uid(),
  background: { type: 'color', color: '#ffffff' },
  elements: [],
});

/** Fresh copies of elements with new ids; connectors and groups are remapped. */
function cloneElements(els: PlanElement[], offset: number): PlanElement[] {
  const idMap = new Map(els.map((e) => [e.id, uid()]));
  const groupMap = new Map<string, string>();
  return els
    .filter((e) => e.type !== 'connector' || idMap.has(e.fromId))
    .map((e) => {
      const c = clone(e);
      c.id = idMap.get(e.id)!;
      if (c.groupId) {
        if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, uid());
        c.groupId = groupMap.get(c.groupId);
      }
      if (c.type === 'connector') {
        c.fromId = idMap.get(c.fromId)!;
        if (idMap.has(c.to.mapId)) c.to = { ...c.to, mapId: idMap.get(c.to.mapId)! };
      } else {
        c.x += offset;
        c.y += offset;
      }
      return c;
    });
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Apply a change to the current page's elements. */
  const mutateElements = (fn: (els: PlanElement[]) => PlanElement[], commit: CommitOpt = true) => {
    const { doc, pageIndex } = get();
    if (!doc) return;
    if (commit !== false) get().commit(typeof commit === 'string' ? commit : undefined);
    const pages = doc.pages.slice();
    const page = pages[pageIndex];
    pages[pageIndex] = { ...page, elements: fn(page.elements) };
    set({ doc: { ...get().doc!, pages } });
  };

  const mutatePages = (fn: (pages: Page[]) => Page[]) => {
    const { doc } = get();
    if (!doc) return;
    get().commit();
    set({ doc: { ...doc, pages: fn(doc.pages.slice()) } });
  };

  const currentElements = () => {
    const { doc, pageIndex } = get();
    return doc?.pages[pageIndex]?.elements ?? [];
  };

  return {
    doc: null,
    pageIndex: 0,
    selectedIds: [],
    past: [],
    future: [],
    lastCommit: null,
    clipboard: [],
    tool: { mode: 'select' },
    cropId: null,
    editing: null,
    view: { scale: 0.5, x: 40, y: 40 },
    viewport: { w: 800, h: 600 },
    event: null,
    routes: [],
    photos: [],
    sidebarTab: 'templates',
    propsOpen: false,
    layersOpen: false,
    theme: 'light',
    savedAt: null,
    exporting: false,

    setDoc: (doc) =>
      set({
        doc,
        pageIndex: 0,
        selectedIds: [],
        past: [],
        future: [],
        lastCommit: null,
        tool: { mode: 'select' },
        cropId: null,
        editing: null,
      }),
    setEventData: (d) => set(d as Partial<EditorState>),

    commit: (key) => {
      const { doc, past, lastCommit } = get();
      if (!doc) return;
      const now = Date.now();
      if (key && lastCommit?.key === key && now - lastCommit.at < COALESCE_MS) {
        set({ lastCommit: { key, at: now } });
        return;
      }
      const snap: Snapshot = { pages: doc.pages, width: doc.width, height: doc.height };
      set({
        past: [...past, snap].slice(-HISTORY_LIMIT),
        future: [],
        lastCommit: key ? { key, at: now } : null,
      });
    },
    undo: () => {
      const { doc, past, future, pageIndex } = get();
      if (!doc || !past.length) return;
      const prev = past[past.length - 1];
      set({
        doc: { ...doc, ...prev },
        past: past.slice(0, -1),
        future: [{ pages: doc.pages, width: doc.width, height: doc.height }, ...future],
        pageIndex: Math.min(pageIndex, prev.pages.length - 1),
        selectedIds: [],
        lastCommit: null,
        cropId: null,
      });
    },
    redo: () => {
      const { doc, past, future, pageIndex } = get();
      if (!doc || !future.length) return;
      const next = future[0];
      set({
        doc: { ...doc, ...next },
        future: future.slice(1),
        past: [...past, { pages: doc.pages, width: doc.width, height: doc.height }],
        pageIndex: Math.min(pageIndex, next.pages.length - 1),
        selectedIds: [],
        lastCommit: null,
        cropId: null,
      });
    },

    setPageIndex: (i) =>
      set({ pageIndex: i, selectedIds: [], cropId: null, editing: null, tool: { mode: 'select' } }),

    addElements: (els, select = true) => {
      mutateElements((cur) => [...cur, ...els]);
      if (select) set({ selectedIds: els.filter((e) => e.type !== 'connector').map((e) => e.id) });
    },
    updateElement: (id, patch, commit = true) =>
      mutateElements(
        (els) => els.map((e) => (e.id === id ? ({ ...e, ...patch } as PlanElement) : e)),
        commit,
      ),
    updateElements: (patches, commit = true) => {
      const byId = new Map(patches.map((p) => [p.id, p.patch]));
      mutateElements(
        (els) => els.map((e) => (byId.has(e.id) ? ({ ...e, ...byId.get(e.id) } as PlanElement) : e)),
        commit,
      );
    },
    deleteElements: (ids) => {
      if (!ids.length) return;
      const gone = new Set(ids);
      mutateElements((els) =>
        els.filter(
          (e) =>
            !gone.has(e.id) &&
            !(e.type === 'connector' && (gone.has(e.fromId) || gone.has(e.to.mapId))),
        ),
      );
      set({ selectedIds: [], cropId: null });
    },
    select: (ids, additive) => {
      const els = currentElements();
      const expanded = withGroups(ids, els);
      if (!additive) return set({ selectedIds: expanded, cropId: null });
      const cur = new Set(get().selectedIds);
      const allIn = expanded.every((id) => cur.has(id));
      expanded.forEach((id) => (allIn ? cur.delete(id) : cur.add(id)));
      set({ selectedIds: [...cur] });
    },
    duplicate: (ids) => {
      const els = currentElements().filter((e) => ids.includes(e.id));
      if (!els.length) return;
      // Bring along connectors that start at a duplicated element.
      const extra = currentElements().filter(
        (e) => e.type === 'connector' && ids.includes(e.fromId) && !ids.includes(e.id),
      );
      const copies = cloneElements([...els, ...extra], 24);
      get().addElements(copies);
    },
    copy: () => {
      const ids = get().selectedIds;
      const els = currentElements();
      const picked = els.filter(
        (e) => ids.includes(e.id) || (e.type === 'connector' && ids.includes(e.fromId)),
      );
      set({ clipboard: clone(picked) });
    },
    paste: () => {
      const { clipboard } = get();
      if (!clipboard.length) return;
      get().addElements(cloneElements(clipboard, 24));
      set({ clipboard: cloneElements(clipboard, 24) });
    },
    group: () => {
      const ids = get().selectedIds;
      if (ids.length < 2) return;
      const gid = uid();
      get().updateElements(ids.map((id) => ({ id, patch: { groupId: gid } })));
    },
    ungroup: () => {
      const ids = get().selectedIds;
      get().updateElements(ids.map((id) => ({ id, patch: { groupId: null } })));
    },
    arrange: (dir) => {
      const ids = new Set(get().selectedIds);
      if (!ids.size) return;
      mutateElements((els) => {
        const picked = els.filter((e) => ids.has(e.id));
        const rest = els.filter((e) => !ids.has(e.id));
        if (dir === 'front') return [...rest, ...picked];
        if (dir === 'back') return [...picked, ...rest];
        const out = els.slice();
        if (dir === 'forward') {
          for (let i = out.length - 2; i >= 0; i--) {
            if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
          }
        } else {
          for (let i = 1; i < out.length; i++) {
            if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
          }
        }
        return out;
      });
    },
    moveElement: (id, toIndex) =>
      mutateElements((els) => {
        const from = els.findIndex((e) => e.id === id);
        if (from < 0) return els;
        const out = els.slice();
        const [el] = out.splice(from, 1);
        out.splice(Math.max(0, Math.min(out.length, toIndex)), 0, el);
        return out;
      }),
    toggleLock: (ids) => {
      const els = currentElements().filter((e) => ids.includes(e.id));
      const lock = !els.every((e) => e.locked);
      get().updateElements(ids.map((id) => ({ id, patch: { locked: lock } })));
    },
    toggleHidden: (id) => {
      const el = currentElements().find((e) => e.id === id);
      if (el) get().updateElement(id, { hidden: !el.hidden });
    },
    align: (kind) => {
      const { selectedIds, doc } = get();
      if (!doc) return;
      const els = currentElements().filter((e) => selectedIds.includes(e.id) && e.type !== 'connector');
      if (!els.length) return;
      // One element (or one group) aligns to the page; several align to each other.
      const groups = new Set(els.map((e) => e.groupId ?? e.id));
      const target =
        groups.size <= 1
          ? { x: 0, y: 0, width: doc.width, height: doc.height }
          : unionBox(els.map(elementBox))!;
      const units = new Map<string, PlanElement[]>();
      els.forEach((e) => {
        const k = groups.size <= 1 ? 'all' : (e.groupId ?? e.id);
        units.set(k, [...(units.get(k) ?? []), e]);
      });
      const patches: { id: string; patch: Partial<PlanElement> }[] = [];
      units.forEach((members) => {
        const b = unionBox(members.map(elementBox))!;
        let dx = 0;
        let dy = 0;
        if (kind === 'left') dx = target.x - b.x;
        if (kind === 'center') dx = target.x + target.width / 2 - (b.x + b.width / 2);
        if (kind === 'right') dx = target.x + target.width - (b.x + b.width);
        if (kind === 'top') dy = target.y - b.y;
        if (kind === 'middle') dy = target.y + target.height / 2 - (b.y + b.height / 2);
        if (kind === 'bottom') dy = target.y + target.height - (b.y + b.height);
        members.forEach((m) => patches.push({ id: m.id, patch: { x: m.x + dx, y: m.y + dy } }));
      });
      get().updateElements(patches);
    },
    distribute: (axis) => {
      const { selectedIds } = get();
      const els = currentElements().filter((e) => selectedIds.includes(e.id) && e.type !== 'connector');
      const units = new Map<string, PlanElement[]>();
      els.forEach((e) => {
        const k = e.groupId ?? e.id;
        units.set(k, [...(units.get(k) ?? []), e]);
      });
      if (units.size < 3) return;
      const list = [...units.values()].map((m) => ({ m, b: unionBox(m.map(elementBox))! }));
      list.sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y));
      const first = list[0].b;
      const last = list[list.length - 1].b;
      const total = list.reduce((s, u) => s + (axis === 'h' ? u.b.width : u.b.height), 0);
      const span = axis === 'h' ? last.x + last.width - first.x : last.y + last.height - first.y;
      const gap = (span - total) / (list.length - 1);
      let cursor = axis === 'h' ? first.x : first.y;
      const patches: { id: string; patch: Partial<PlanElement> }[] = [];
      list.forEach(({ m, b }) => {
        const delta = cursor - (axis === 'h' ? b.x : b.y);
        m.forEach((e) =>
          patches.push({ id: e.id, patch: axis === 'h' ? { x: e.x + delta } : { y: e.y + delta } }),
        );
        cursor += (axis === 'h' ? b.width : b.height) + gap;
      });
      get().updateElements(patches);
    },
    nudge: (dx, dy) => {
      const { selectedIds } = get();
      const els = currentElements().filter(
        (e) => selectedIds.includes(e.id) && !e.locked && e.type !== 'connector',
      );
      if (!els.length) return;
      get().updateElements(
        els.map((e) => ({ id: e.id, patch: { x: e.x + dx, y: e.y + dy } })),
        'nudge',
      );
    },

    setBackground: (bg, allPages) =>
      mutatePages((pages) =>
        pages.map((p, i) => (allPages || i === get().pageIndex ? { ...p, background: bg } : p)),
      ),
    addPage: () => {
      const { doc, pageIndex } = get();
      if (!doc) return;
      const bg = doc.pages[pageIndex]?.background ?? blankPage().background;
      mutatePages((pages) => {
        pages.splice(pageIndex + 1, 0, { ...blankPage(), background: clone(bg) });
        return pages;
      });
      set({ pageIndex: pageIndex + 1, selectedIds: [] });
    },
    duplicatePage: (i) => {
      const { doc } = get();
      if (!doc) return;
      const src = doc.pages[i];
      mutatePages((pages) => {
        pages.splice(i + 1, 0, {
          id: uid(),
          background: clone(src.background),
          elements: cloneElements(src.elements, 0),
        });
        return pages;
      });
      set({ pageIndex: i + 1, selectedIds: [] });
    },
    deletePage: (i) => {
      const { doc, pageIndex } = get();
      if (!doc) return;
      if (doc.pages.length <= 1) {
        mutatePages(() => [blankPage()]);
        return set({ selectedIds: [] });
      }
      mutatePages((pages) => {
        pages.splice(i, 1);
        return pages;
      });
      set({ pageIndex: Math.min(pageIndex, doc.pages.length - 2), selectedIds: [] });
    },
    movePage: (from, to) => {
      const { doc } = get();
      if (!doc || to < 0 || to >= doc.pages.length || from === to) return;
      mutatePages((pages) => {
        const [p] = pages.splice(from, 1);
        pages.splice(to, 0, p);
        return pages;
      });
      set({ pageIndex: to });
    },
    replacePage: (content) => {
      const { pageIndex } = get();
      mutatePages((pages) =>
        pages.map((p, i) => (i === pageIndex ? { ...p, background: content.background, elements: content.elements } : p)),
      );
      set({ selectedIds: [] });
    },
    appendPages: (newPages, replaceEmptyFirst) => {
      const { doc } = get();
      if (!doc || !newPages.length) return;
      const firstEmpty = doc.pages.length === 1 && !doc.pages[0].elements.length;
      const start = replaceEmptyFirst && firstEmpty ? 0 : doc.pages.length;
      mutatePages((pages) => {
        const made = newPages.map((p) => ({ id: uid(), ...p }));
        return replaceEmptyFirst && firstEmpty ? made : [...pages, ...made];
      });
      set({ pageIndex: start, selectedIds: [] });
    },
    setDocName: (name) => {
      const { doc } = get();
      if (doc) set({ doc: { ...doc, name } });
    },
    resizeDoc: (w, h) => {
      const { doc } = get();
      if (!doc || (w === doc.width && h === doc.height)) return;
      get().commit();
      // Scale content uniformly and centre it in the new page.
      const k = Math.min(w / doc.width, h / doc.height);
      const ox = (w - doc.width * k) / 2;
      const oy = (h - doc.height * k) / 2;
      const pages = doc.pages.map((p) => ({
        ...p,
        elements: p.elements.map((e) => {
          if (e.type === 'connector') return { ...e, strokeWidth: e.strokeWidth * k };
          const c = { ...e, x: e.x * k + ox, y: e.y * k + oy, width: e.width * k, height: e.height * k } as PlanElement;
          if (c.type === 'text') c.fontSize *= k;
          if (c.type === 'image') c.captionStyle = { ...c.captionStyle, fontSize: c.captionStyle.fontSize * k };
          if (c.type === 'line' || c.type === 'shape') c.strokeWidth *= k;
          if (c.type === 'map') c.routeWidth *= k;
          return c;
        }),
      }));
      set({ doc: { ...doc, width: w, height: h, pages } });
      get().fitView();
    },
    addUpload: (u) => {
      const { doc } = get();
      if (doc) set({ doc: { ...doc, uploads: [u, ...doc.uploads] } });
    },
    removeUpload: (id) => {
      const { doc } = get();
      if (doc) set({ doc: { ...doc, uploads: doc.uploads.filter((u) => u.id !== id) } });
    },

    setViewport: (w, h) => {
      // Keep the same point centred when panels open/close around the canvas.
      const { viewport, view } = get();
      set({
        viewport: { w, h },
        view: { ...view, x: view.x + (w - viewport.w) / 2, y: view.y + (h - viewport.h) / 2 },
      });
    },
    setView: (v) => set({ view: { ...get().view, ...v } }),
    zoomAt: (scale, center) => {
      const { view, viewport } = get();
      const s = Math.min(8, Math.max(0.05, scale));
      const c = center ?? { x: viewport.w / 2, y: viewport.h / 2 };
      const px = (c.x - view.x) / view.scale;
      const py = (c.y - view.y) / view.scale;
      set({ view: { scale: s, x: c.x - px * s, y: c.y - py * s } });
    },
    fitView: () => {
      const { doc, viewport } = get();
      if (!doc) return;
      const pad = viewport.w < 640 ? 16 : 48;
      const s = Math.min((viewport.w - pad * 2) / doc.width, (viewport.h - pad * 2) / doc.height);
      const scale = Math.max(0.05, s);
      set({
        view: {
          scale,
          x: (viewport.w - doc.width * scale) / 2,
          y: (viewport.h - doc.height * scale) / 2,
        },
      });
    },
    setTool: (tool) => set({ tool }),
    setCrop: (cropId) => set({ cropId, editing: null }),
    setEditing: (editing) => set({ editing }),
    setSidebarTab: (sidebarTab) => set({ sidebarTab }),
    setPropsOpen: (propsOpen) => set({ propsOpen }),
    setLayersOpen: (layersOpen) => set({ layersOpen }),
    setTheme: (theme) => set({ theme }),
    markSaved: () => set({ savedAt: Date.now() }),
    setExporting: (exporting) => set({ exporting }),
  };
});

/** Elements of the page being edited. */
export const usePageElements = () =>
  useEditor((s) => s.doc?.pages[s.pageIndex]?.elements ?? EMPTY);
const EMPTY: PlanElement[] = [];

export const getPageElements = () => {
  const s = useEditor.getState();
  return s.doc?.pages[s.pageIndex]?.elements ?? EMPTY;
};
