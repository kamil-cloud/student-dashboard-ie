/**
 * Reads the positioned text of a PDF with pdf.js, entirely in the browser — the file is never
 * uploaded anywhere. pdf.js is loaded on demand so it does not slow down app start.
 */
import type { PdfTextItem } from './ie';

export class PdfReadError extends Error {}

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 30;

export async function readPdfText(data: ArrayBuffer): Promise<PdfTextItem[]> {
  if (data.byteLength > MAX_PDF_BYTES) throw new PdfReadError('That file is too large for a transcript (over 15 MB).');
  const head = new Uint8Array(data.slice(0, 5));
  if (String.fromCharCode(...head) !== '%PDF-') throw new PdfReadError('That file is not a PDF.');

  // The "legacy" build: the modern one needs JavaScript features Safari does not have yet
  // (e.g. Promise.try, Map.prototype.getOrInsertComputed), and failed there.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    void task.destroy();
    const name = err instanceof Error ? err.name : '';
    if (name === 'PasswordException') throw new PdfReadError('This PDF is password-protected. Download an unprotected copy of your transcript.');
    throw new PdfReadError('This PDF could not be read. Try downloading your transcript again.');
  }
  try {
    const items: PdfTextItem[] = [];
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
      }
      page.cleanup();
    }
    if (items.length === 0) throw new PdfReadError('This PDF has no readable text (it may be a scan).');
    return items;
  } finally {
    void task.destroy();
  }
}
