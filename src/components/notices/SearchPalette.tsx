import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, FileText, Loader2, Search } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { searchNotices, type SearchResult } from '@/lib/noticeCommandCentre';
import { stageLabel } from '@/lib/noticeStages';
import { fmtDate, sentenceCase } from '@/lib/noticeFormat';
import { cn } from '@/lib/utils';

const OPEN_EVENT = 'gstk:open-notice-search';

/** Opens the search palette from anywhere (the header's search button). */
export const openNoticeSearch = () => window.dispatchEvent(new Event(OPEN_EVENT));

const MATCHED: Record<string, string> = {
  reference: 'reference', case: 'case ID / ARN', reply: 'reply / submission ARN', order: 'order number',
  form: 'form', folder: 'case folder (DIN / reference)', text: 'description',
};

/**
 * Ctrl K / ⌘K (audit U-04-1): clients by name or GSTIN, notices by reference,
 * case ID / ARN, reply or order number, form, or a DIN inside the case folder.
 * Every result is a keyboard-selectable row (U-04-2).
 */
export const SearchPalette: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult>({ clients: [], notices: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes({ clients: [], notices: [] }); setError(null); return; }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchNotices(term);
        if (mine === seq.current) { setRes(r); setError(null); }
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const go = (to: string) => { setOpen(false); setQ(''); navigate(to); };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12%] translate-y-0 overflow-hidden p-0 shadow-lg sm:max-w-xl">
        <DialogTitle className="sr-only">Search clients and notices</DialogTitle>
        <DialogDescription className="sr-only">Results update as you type. Use the arrow keys and Enter to open one.</DialogDescription>
        {/* Results come from the server: cmdk must not filter them again. */}
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
      <CommandInput value={q} onValueChange={setQ} placeholder="Search clients and notices — GSTIN, name, reference, ARN, DIN, case ID…" aria-label="Search clients and notices" />
      <CommandList>
        {q.trim().length < 2 && <div className="p-4 text-xs text-muted-foreground">Type at least 2 characters.</div>}
        {loading && <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…</div>}
        {error && <div className="p-3 text-xs text-destructive-strong">Couldn't search: {error}</div>}
        {q.trim().length >= 2 && !loading && !error && <CommandEmpty>Nothing matches "{q.trim()}".</CommandEmpty>}
        {res.notices.length > 0 && (
          <CommandGroup heading="Notices">
            {res.notices.map((n) => (
              <CommandItem key={n.id} value={`notice-${n.id}`} onSelect={() => go(`/notices/${n.id}`)} className="items-start">
                <FileText className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {[n.form_code, sentenceCase(n.notice_type)].filter(Boolean).join(' · ')} — {n.client_name}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{n.reference_number || n.case_id || '—'}</span>
                    {' · '}{stageLabel(n.stage)}{n.issue_date ? ` · issued ${fmtDate(n.issue_date)}` : ''}
                    {' · '}matched on {MATCHED[n.matched_on] ?? n.matched_on}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {res.clients.length > 0 && (
          <CommandGroup heading="Clients">
            {res.clients.map((c) => (
              <CommandItem key={c.id} value={`client-${c.id}`} onSelect={() => go(`/notices-company/${c.id}`)}>
                <Building2 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{c.name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{c.gstin}</span>
                <span className={cn('ml-auto text-xs', c.overdue > 0 ? 'text-destructive-strong' : 'text-muted-foreground')}>
                  {c.open} open{c.overdue > 0 ? ` · ${c.overdue} overdue` : ''}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};

/** The header's search field look-alike; Ctrl K works anywhere. */
export const SearchButton: React.FC<{ className?: string }> = ({ className }) => {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <Button type="button" variant="outline" onClick={openNoticeSearch}
      className={cn('h-8 w-full justify-start gap-2 px-2.5 text-xs font-normal text-muted-foreground sm:w-64', className)}
      aria-keyshortcuts="Control+K Meta+K">
      <Search className="h-3.5 w-3.5" aria-hidden />
      <span className="truncate">Search GSTIN, client, ARN, DIN…</span>
      <kbd className="ml-auto hidden rounded border bg-background px-1.5 font-mono text-[10px] text-foreground/80 sm:inline">{mac ? '⌘' : 'Ctrl'} K</kbd>
    </Button>
  );
};

export default SearchPalette;
