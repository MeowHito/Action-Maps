'use client';

/**
 * Plan editor root: loads the event's routes/photos, restores the last
 * plan, autosaves, wires keyboard shortcuts and lays out the chrome
 * (top bar, sidebar, context bar, canvas, pages bar, properties panel).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { FONTS_HREF } from './constants';
import { useEditor } from './store';
import { ensureRouteGeom } from './runtime';
import { getLastPlanId, getStoredTheme, loadPlan, savePlan, setLastPlanId, storeTheme } from './storage';
import { pageThumbnail } from './exporter';
import { uploadFiles } from './actions';
import Canvas from './canvas/Canvas';
import Toolbar from './Toolbar';
import Sidebar from './Sidebar';
import PagesBar from './PagesBar';
import PropertiesPanel, { ContextBar } from './PropertiesPanel';
import StartScreen from './StartScreen';
import ExportDialog from './ExportDialog';
import { TooltipLayer } from './ui';

export default function Editor({ slug }: { slug: string }) {
  const doc = useEditor((s) => s.doc);
  const theme = useEditor((s) => s.theme);
  const [ready, setReady] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // ---- Event data (routes are parsed up-front so maps render immediately) ----
  useEffect(() => {
    const st = useEditor.getState();
    st.setDoc(null);
    api.getEvent(slug).then((event) => st.setEventData({ event }), () => undefined);
    api.listRoutes(slug).then(
      (routes) => {
        st.setEventData({ routes });
        routes.forEach((r) => void ensureRouteGeom(r));
      },
      () => undefined,
    );
    api.listPhotos(slug).then((photos) => st.setEventData({ photos }), () => undefined);
  }, [slug]);

  // ---- Theme ----
  useEffect(() => {
    const stored = getStoredTheme();
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    useEditor.getState().setTheme(stored ?? sys);
  }, []);
  useEffect(() => {
    if (ready) storeTheme(theme);
  }, [theme, ready]);

  // ---- Restore the last plan for this event ----
  useEffect(() => {
    const last = getLastPlanId(slug);
    const done = () => setReady(true);
    if (!last) return done();
    loadPlan(last)
      .then((d) => d && useEditor.getState().setDoc(d))
      .catch(() => undefined)
      .finally(done);
  }, [slug]);

  // ---- Autosave (debounced) ----
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.doc || s.doc === prev.doc || s.exporting) return;
      // Opening / switching plans is not an edit.
      if (!prev.doc || prev.doc.id !== s.doc.id) return;
      if (s.savedAt) useEditor.setState({ savedAt: null });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const st = useEditor.getState();
        if (!st.doc) return;
        const thumb = st.pageIndex === 0 ? pageThumbnail(360) : undefined;
        savePlan({ ...st.doc, updatedAt: new Date().toISOString() }, thumb)
          .then(() => {
            setLastPlanId(slug, st.doc!.id);
            st.markSaved();
          })
          .catch(() => undefined);
      }, 900);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [slug]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      const st = useEditor.getState();
      if (!st.doc || st.exporting) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const step = e.shiftKey ? 10 : 1;
      if (mod && k === 'z' && !e.shiftKey) st.undo();
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) st.redo();
      else if (mod && k === 'c') st.copy();
      else if (mod && k === 'x') {
        st.copy();
        st.deleteElements(st.selectedIds);
      } else if (mod && k === 'v') return; // handled by the paste event (images or internal clipboard)
      else if (mod && k === 'd') st.duplicate(st.selectedIds);
      else if (mod && k === 'g') {
        if (e.shiftKey) st.ungroup();
        else st.group();
      }
      else if (mod && k === 'a') {
        const s = useEditor.getState();
        st.select(s.doc!.pages[s.pageIndex].elements.filter((x) => x.type !== 'connector' && !x.hidden).map((x) => x.id));
      } else if (mod && (k === '=' || k === '+')) st.zoomAt(st.view.scale * 1.25);
      else if (mod && k === '-') st.zoomAt(st.view.scale / 1.25);
      else if (mod && k === '0') st.fitView();
      else if (k === 'delete' || k === 'backspace') st.deleteElements(st.selectedIds);
      else if (k === 'escape') {
        if (st.tool.mode !== 'select') st.setTool({ mode: 'select' });
        else if (st.cropId) st.setCrop(null);
        else st.select([]);
      } else if (k === 'arrowleft') st.nudge(-step, 0);
      else if (k === 'arrowright') st.nudge(step, 0);
      else if (k === 'arrowup') st.nudge(0, -step);
      else if (k === 'arrowdown') st.nudge(0, step);
      else return;
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA/.test(t.tagName) || t.isContentEditable) return;
      const st = useEditor.getState();
      if (!st.doc) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (files.length) void uploadFiles(files, {});
      else st.paste();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    <div className="pe-root fixed inset-0 flex flex-col bg-[var(--pe-bg)] text-[var(--pe-text)]" data-theme={theme}>
      {/* React hoists this into <head>; Thai-capable fonts for the canvas. */}
      <link rel="stylesheet" href={FONTS_HREF} precedence="default" />
      {!ready ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--pe-muted)]">กำลังโหลด…</div>
      ) : doc ? (
        <>
          <Toolbar
            slug={slug}
            onExport={() => setExportOpen(true)}
            onOpenFiles={() => useEditor.getState().setDoc(null)}
          />
          <div className="relative flex min-h-0 flex-1">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <ContextBar />
              <Canvas key={doc.id} />
              <PagesBar />
            </div>
            <PropertiesPanel />
          </div>
        </>
      ) : (
        <StartScreen slug={slug} />
      )}
      {exportOpen && doc && <ExportDialog onClose={() => setExportOpen(false)} />}
      <TooltipLayer />
    </div>
  );
}
