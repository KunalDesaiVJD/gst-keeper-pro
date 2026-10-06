// One .zip instead of a browser tab per PDF (audit U-75-5).

/** Saves the files behind these links as one .zip; returns how many made it. */
export async function downloadZip(files: { url: string; name: string }[], zipName: string): Promise<{ ok: number; failed: number }> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const used = new Set<string>();
  let ok = 0;
  let failed = 0;
  const one = async (f: { url: string; name: string }) => {
    try {
      const res = await fetch(f.url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const base = f.name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.pdf$/i, '') || 'document';
      let name = `${base}.pdf`;
      for (let i = 2; used.has(name); i++) name = `${base} (${i}).pdf`;
      used.add(name);
      zip.file(name, blob);
      ok++;
    } catch {
      failed++;
    }
  };
  for (let i = 0; i < files.length; i += 4) await Promise.all(files.slice(i, i + 4).map(one));
  if (ok > 0) {
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }
  return { ok, failed };
}
