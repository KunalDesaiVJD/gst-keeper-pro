// Notices · Settings: the officers' book, every officer with a number saved,
// to find, call, edit or remove. Numbers are added from a case's Officer field.
import React, { useMemo, useState } from 'react';
import { Mail, Phone, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/notices/ui/Panel';
import { OfficerForm } from '@/components/notices/OfficerContact';
import { deleteOfficer, useOfficers, type Officer } from '@/lib/noticeOfficers';
import { fmtAgo } from '@/lib/noticeFormat';

const Row: React.FC<{ o: Officer; canEdit: boolean }> = ({ o, canEdit }) => {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = async () => {
    try { await deleteOfficer(o.id); await qc.invalidateQueries({ queryKey: ['notice-officers'] }); toast.success('Removed from the book.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{o.name}</div>
        <div className="text-xs text-muted-foreground">{[o.office, o.notes, o.updated_by_name && `by ${o.updated_by_name} ${fmtAgo(o.updated_at)}`].filter(Boolean).join(' · ')}</div>
      </div>
      {o.mobile && <a href={`tel:${o.mobile.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="h-3.5 w-3.5" aria-hidden />{o.mobile}</a>}
      {o.email && <a href={`mailto:${o.email}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><Mail className="h-3.5 w-3.5" aria-hidden />{o.email}</a>}
      {canEdit && (
        <>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild><button type="button" className="text-xs text-muted-foreground hover:text-primary">Edit</button></PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-3">{open && <OfficerForm name={o.name} officer={o} onDone={() => setOpen(false)} />}</PopoverContent>
          </Popover>
          <button type="button" onClick={remove} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${o.name}`}><Trash2 className="h-3.5 w-3.5" /></button>
        </>
      )}
    </li>
  );
};

export const OfficersPanel: React.FC<{ canEdit: boolean }> = ({ canEdit }) => {
  const q = useOfficers();
  const [search, setSearch] = useState('');
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return [...(q.data?.values() ?? [])].filter((o) => !s || o.name.toLowerCase().includes(s) || (o.mobile ?? '').includes(s) || (o.office ?? '').toLowerCase().includes(s));
  }, [q.data, search]);
  return (
    <Panel title={`Officers · ${q.data?.size ?? 0}`}
      info="Officers with a mobile or e-mail saved. Add one from the Officer field on a case or notice page (Add mobile); it then shows on every case of that officer.">
      {(q.data?.size ?? 0) > 6 && (
        <div className="relative mb-2 w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, number or office" className="h-9 pl-8 text-sm" aria-label="Search officers" />
        </div>
      )}
      {q.isLoading ? <Skeleton className="h-12 w-full" />
        : !list.length ? <p className="text-sm text-muted-foreground">{q.data?.size ? 'No officer matches.' : 'No officer saved yet. Add a mobile from the Officer field on any case.'}</p>
        : <ul className="divide-y">{list.map((o) => <Row key={o.id} o={o} canEdit={canEdit} />)}</ul>}
    </Panel>
  );
};

export default OfficersPanel;
