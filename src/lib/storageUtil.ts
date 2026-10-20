/** Helpers shared by the browser (extension) and cloud (website) storage. */

export const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/** Newest edit timestamp inside a data snapshot, so recovery prefers the most up-to-date copy. */
export function latestEdit(text: string): string {
  let latest = '';
  for (const m of text.matchAll(/"(?:updatedAt|createdAt|completedAt)"\s*:\s*"([^"]+)"/g)) if (m[1] > latest) latest = m[1];
  return latest;
}

export function counts(json: string): { courseCount: number | null; itemCount: number | null } {
  try {
    const d = JSON.parse(json) as { courses?: unknown[]; items?: unknown[] };
    return { courseCount: Array.isArray(d.courses) ? d.courses.length : null, itemCount: Array.isArray(d.items) ? d.items.length : null };
  } catch {
    return { courseCount: null, itemCount: null };
  }
}

export function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Some browsers never fire `change` on cancel; `cancel` covers the rest.
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

