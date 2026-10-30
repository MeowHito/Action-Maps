/**
 * Export pages to PNG / JPG / PDF. Each page is shown in turn on the live
 * stage, we wait for its images and basemaps, then rasterise the page group
 * (which excludes selection handles and guides).
 */
import { useEditor } from './store';
import { runtime, waitForIdle } from './runtime';

export type ExportFormat = 'png' | 'jpg' | 'pdf';

export interface ExportOptions {
  format: ExportFormat;
  /** Output pixels per page pixel. */
  scale: number;
  pages: 'current' | 'all';
  quality: number;
}

function download(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'plan';

/** Rasterise the page currently on screen. */
function capturePage(mime: string, scale: number, quality: number): string {
  const { doc, view } = useEditor.getState();
  const page = runtime.page;
  if (!doc || !page) throw new Error('stage not ready');
  return page.toDataURL({
    x: view.x,
    y: view.y,
    width: doc.width * view.scale,
    height: doc.height * view.scale,
    pixelRatio: scale / view.scale,
    mimeType: mime,
    quality,
  });
}

export async function exportPlan(opts: ExportOptions, onProgress?: (done: number, total: number) => void) {
  const st = useEditor.getState();
  const doc = st.doc;
  if (!doc) return;
  const startPage = st.pageIndex;
  const indexes = opts.pages === 'all' ? doc.pages.map((_, i) => i) : [startPage];
  const name = safeName(doc.name);

  st.setExporting(true);
  st.select([]);
  st.setCrop(null);
  st.setEditing(null);
  try {
    const mime = opts.format === 'png' ? 'image/png' : 'image/jpeg';
    let pdf: import('jspdf').jsPDF | null = null;
    if (opts.format === 'pdf') {
      const { jsPDF } = await import('jspdf');
      pdf = new jsPDF({
        orientation: doc.width >= doc.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [doc.width, doc.height],
        hotfixes: ['px_scaling'],
        compress: true,
      });
    }
    for (let n = 0; n < indexes.length; n++) {
      const i = indexes[n];
      useEditor.getState().setPageIndex(i);
      await waitForIdle();
      const url = capturePage(mime, opts.scale, opts.quality);
      if (pdf) {
        if (n > 0) pdf.addPage([doc.width, doc.height], doc.width >= doc.height ? 'landscape' : 'portrait');
        pdf.addImage(url, 'JPEG', 0, 0, doc.width, doc.height, undefined, 'FAST');
      } else {
        const suffix = indexes.length > 1 ? `-${i + 1}` : '';
        download(url, `${name}${suffix}.${opts.format}`);
        // Give the browser a moment between multiple downloads.
        if (indexes.length > 1) await new Promise((r) => setTimeout(r, 350));
      }
      onProgress?.(n + 1, indexes.length);
    }
    if (pdf) pdf.save(`${name}.pdf`);
  } finally {
    useEditor.getState().setPageIndex(startPage);
    useEditor.getState().setExporting(false);
  }
}

/** Small JPEG of the current page for the recent-plans list / pages bar. */
export function pageThumbnail(maxSide = 360): string | undefined {
  try {
    const { doc } = useEditor.getState();
    if (!doc) return;
    return capturePage('image/jpeg', maxSide / Math.max(doc.width, doc.height), 0.7);
  } catch {
    return undefined;
  }
}
