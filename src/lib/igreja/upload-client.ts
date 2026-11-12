/**
 * Navegador → Google Drive direto (o arquivo não passa pelo servidor do app, que na Vercel aceita no máximo 4,5 MB).
 * Um PUT único no session URI criado pelo servidor (guia "Perform a resumable upload" da Drive API), com progresso.
 */
export type PutResult = { ok: true } | { ok: false; status: number };

export function putToSession(url: string, file: Blob, onProgress: (pct: number) => void, XHR: typeof XMLHttpRequest = XMLHttpRequest): Promise<PutResult> {
  return new Promise((resolve) => {
    const xhr = new XHR();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.onabort = () => resolve({ ok: false, status: 0 });
    xhr.send(file);
  });
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
