// /d/:id — opens a stored file by its short link (src/lib/docLinks.ts).
// Signed out: to the login page, and back here after it. Signed in: the Edge
// Function doc-open checks the person and streams the file, which is shown
// from memory (the address bar keeps /d/<id>, the storage address is never
// seen). ?download=<name> saves it under that name instead.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, Download, FileText, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { AFTER_LOGIN_KEY, fetchDocById } from '@/lib/docLinks';
import { DOC_LINK_RE } from '../../supabase/functions/_shared/docLink.ts';



type State =
  | { kind: 'loading' }
  | { kind: 'shown'; url: string; name: string; type: string }
  | { kind: 'saved'; url: string; name: string }
  | { kind: 'failed'; message: string; relogin: boolean };

const saveBlob = (url: string, name: string) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

export default function DocumentOpenPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { user, isLoading, logout } = useAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const objectUrl = useRef<string | null>(null);
  const download = new URLSearchParams(location.search).get('download');

  useEffect(() => {
    if (isLoading || !user) return;
    if (!DOC_LINK_RE.test(id)) {
      setState({ kind: 'failed', message: 'This link is not a document link.', relogin: false });
      return;
    }
    let live = true;
    setState({ kind: 'loading' });
    (async () => {
      try {
        const r = await fetchDocById(id, download, { id: user.id, sessionsEndedAt: user.sessionsEndedAt ?? null });
        if (!r.ok) {
          const j = await r.json().catch(() => null) as { error?: string } | null;
          if (live) setState({ kind: 'failed', message: j?.error || `The document could not be opened (${r.status}).`, relogin: r.status === 401 });
          return;
        }
        const blob = await r.blob();
        if (!live) return;
        const raw = r.headers.get('x-doc-name');
        let name = download || 'document';
        if (raw) { try { name = decodeURIComponent(raw); } catch { name = raw; } }
        const type = blob.type || r.headers.get('content-type') || '';
        const url = URL.createObjectURL(blob);
        objectUrl.current = url;
        document.title = name;
        const viewable = type.startsWith('application/pdf') || type.startsWith('image/') || type.startsWith('text/plain');
        if (download || !viewable) {
          saveBlob(url, name);
          setState({ kind: 'saved', url, name });
        } else {
          setState({ kind: 'shown', url, name, type });
        }
      } catch {
        if (live) setState({ kind: 'failed', message: 'The document could not be opened. Check the connection and try again.', relogin: false });
      }
    })();
    return () => {
      live = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
  }, [id, download, isLoading, user]);

  if (isLoading) return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></Centered>;
  if (!user) {
    try { sessionStorage.setItem(AFTER_LOGIN_KEY, location.pathname + location.search); } catch { /* still goes to login */ }
    return <Navigate to="/login" replace />;
  }

  if (state.kind === 'loading') {
    return <Centered><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden /><p className="mt-3 text-sm text-muted-foreground">Opening the document…</p></Centered>;
  }
  if (state.kind === 'failed') {
    return (
      <Centered>
        <AlertTriangle className="h-8 w-8 text-warning" aria-hidden />
        <p className="mt-3 max-w-md text-center text-sm">{state.message}</p>
        {state.relogin && (
          <Button className="mt-4" size="sm" onClick={async () => {
            try { sessionStorage.setItem(AFTER_LOGIN_KEY, location.pathname + location.search); } catch { /* ignore */ }
            await logout();
          }}>Log in again</Button>
        )}
      </Centered>
    );
  }
  if (state.kind === 'saved') {
    return (
      <Centered>
        <FileText className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm">“{state.name}” is downloading.</p>
        <Button className="mt-4" size="sm" variant="outline" onClick={() => saveBlob(state.url, state.name)}>
          <Download className="mr-2 h-4 w-4" aria-hidden /> Download again
        </Button>
      </Centered>
    );
  }
  return (
    <div className="flex h-screen flex-col bg-muted">
      <div className="flex items-center gap-3 border-b bg-card px-4 py-2">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={state.name}>{state.name}</span>
        <Button size="sm" variant="outline" onClick={() => saveBlob(state.url, state.name)}>
          <Download className="mr-2 h-4 w-4" aria-hidden /> Download
        </Button>
      </div>
      {state.type.startsWith('image/')
        ? <div className="flex flex-1 items-center justify-center overflow-auto p-4"><img src={state.url} alt={state.name} className="max-h-full max-w-full" /></div>
        : <iframe src={state.url} title={state.name} className="w-full flex-1 border-0 bg-white" />}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">{children}</div>;
}
