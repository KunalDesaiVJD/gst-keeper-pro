// One reply template, read only: its wording with the {{placeholders}} marked,
// a preview on an open notice it applies to, and the notices that hold an
// option from it (the same number as the list's count). Which part is open is
// in the URL (?rt=<key>&rview=preview|notices), so a count links straight to it.
import React, { useEffect, useState } from 'react';
import { Copy, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TAB_LIST_CLASS, TAB_TRIGGER_CLASS } from '@/components/gstr9/reco/StepTabs';
import { WS_BTN } from '@/components/workspace/theme';
import { StanceChip } from '@/components/notices/workspace/ReplyOptions';
import { EmptyBox, LoadError } from '@/components/notices/autopilot/parts';
import { plural } from '@/lib/noticeFormat';
import { istDay, templateChangedWords, useTemplateOptions, type ReplyTemplate } from '@/lib/replyFactory';
import { NoticeCell } from './parts';
import { TemplatePreview } from './TemplatePreview';
import { MarkedText, PlaceholdersPanel } from './TextChecks';
import { cn } from '@/lib/utils';

export type TemplateView = 'wording' | 'preview' | 'notices';


const PAGE = 25;

export const TemplateViewDialog: React.FC<{
  t: ReplyTemplate | null;
  view: TemplateView;
  onView: (v: TemplateView) => void;
  onClose: () => void;
  /** How many notices hold an option from it (the list's own count). */
  count: number | null;
  ownForms: string[];
  canEdit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
}> = ({ t, view, onView, onClose, count, ownForms, canEdit, onEdit, onDuplicate }) => {
  const options = useTemplateOptions(t?.key ?? null, view === 'notices');
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setShown(PAGE); }, [t?.key]);
  if (!t) return null;
  const n = options.data?.length ?? count;

  return (
    <Dialog open={!!t} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{t.title}</DialogTitle>
          <DialogDescription>{t.summary || 'No line on when to use it yet.'}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground/80">
          <StanceChip stance={t.stance} />
          <span>Version {t.version}</span>
          <span aria-hidden>·</span>
          <span>{t.forms.length ? `For ${t.forms.join(', ')}` : 'General: for a notice whose form has no template of its own'}</span>
          <span aria-hidden>·</span>
          <span className={cn(!t.is_active && 'font-semibold text-foreground')}>{t.is_active ? 'Offered on open notices' : 'Switched off'}</span>
          <span aria-hidden>·</span>
          <span className="font-mono">{t.key}</span>
          <span aria-hidden>·</span>
          <span>{templateChangedWords(t)}</span>
        </div>

        <Tabs value={view} onValueChange={(v) => onView(v as TemplateView)} className="space-y-2">
          <TabsList className={cn(TAB_LIST_CLASS, 'w-full sm:w-auto')} aria-label="This template">
            <TabsTrigger value="wording" className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>Wording</TabsTrigger>
            <TabsTrigger value="preview" className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>Preview on a notice</TabsTrigger>
            <TabsTrigger value="notices" className={cn(TAB_TRIGGER_CLASS, 'h-8 px-3')}>
              Notices{n !== null && n !== undefined && <span className="tabular-nums"> ({n.toLocaleString('en-IN')})</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wording" className="mt-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              Placeholders are marked in blue; point at one to see what it prints. A red one is not filled by the app.
            </p>
            <div className="max-h-[55vh] overflow-y-auto rounded-md border bg-card p-3">
              <MarkedText text={t.body} className="font-serif text-[13.5px]" />
            </div>
            <PlaceholdersPanel />
          </TabsContent>

          <TabsContent value="preview" className="mt-0">
            <TemplatePreview body={t.body} forms={t.forms} ownForms={ownForms} />
          </TabsContent>

          <TabsContent value="notices" className="mt-0 space-y-2">
            <p className="text-xs text-muted-foreground">
              Notices holding a reply prepared from this template. A closed notice keeps the one it had when it closed.
            </p>
            {options.error ? <LoadError what="the notices" error={options.error} onRetry={() => options.refetch()} />
              : options.isLoading ? <div className="space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              : !options.data?.length ? <EmptyBox className="p-4">No notice holds a reply from this template.</EmptyBox>
              : (
                <>
                  <h3 className="sr-only">{plural(options.data.length, 'notice')} with this reply</h3>
                  <ul className="divide-y rounded-md border">
                    {options.data.slice(0, shown).map((o) => (
                      <li key={o.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-2.5 py-2">
                        <NoticeCell n={o.notice} id={o.notice_id} tab="draft" className="max-w-full sm:max-w-[60%]" />
                        <div className="text-right text-xs text-foreground/80">
                          <div className={cn(o.status === 'used' && 'font-medium text-foreground')}>
                            {o.status === 'used' ? `Used for a draft${o.used_by_name ? ` by ${o.used_by_name}` : ''}${o.used_at ? ` on ${istDay(o.used_at)}` : ''}` : 'Ready to use'}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {o.notice ? (o.notice.is_open ? 'Open' : 'Closed') : 'Removed'} · prepared from version {o.template_version} on {istDay(o.rendered_at)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {options.data.length > shown && (
                    <Button type="button" size="sm" variant="outline" className={WS_BTN} onClick={() => setShown((s) => s + PAGE)}>
                      Show {Math.min(PAGE, options.data.length - shown)} more of {options.data.length.toLocaleString('en-IN')}
                    </Button>
                  )}
                </>
              )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          {canEdit && (
            <>
              <Button type="button" variant="outline" className={WS_BTN} onClick={onDuplicate}><Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate</Button>
              <Button type="button" className={WS_BTN} onClick={onEdit}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Button>
            </>
          )}
          <Button type="button" variant="ghost" className={WS_BTN} onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateViewDialog;
