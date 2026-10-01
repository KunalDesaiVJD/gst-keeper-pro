import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge } from '@/components/gstr9/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FY_MONTHS } from '@/lib/gstr9/types';
import { fmtWhen } from '@/lib/gstr9/portalImport';
import { Note, OpenDifferences } from '../ui';
import { useWorkspace } from '../WorkspaceContext';
import { Gstr9Section } from '../portal/Gstr9Section';
import { useExtensionBridge } from '../portal/useExtensionBridge';
import { Gstr3bSection } from '../portal/Gstr3bSection';

const SOURCE_TEXT: Record<string, string> = {
  extension: 'From the portal',
  upload: 'Uploaded',
  as_filed_3b: 'As-filed 3B',
  manual: 'Typed',
};

/** URL parameter that remembers the open section (the page keeps ?client= and ?step= alongside). */
const TAB_PARAM = 'portaltab';
const TABS = ['gstr9', 'gstr3b'] as const;
type TabKey = (typeof TABS)[number];

/**
 * Step 1 — Portal data. Where every portal figure the workings compare
 * against comes from: the GSTR-9 system-computed JSON (annual) and the
 * as-filed GSTR-3B (monthly), pulled by the extension, uploaded, or typed.
 * The app's own GSTR-1 / GSTR-3B are never read (docs/GSTR9_9C_WORKINGS.md §5).
 */
const PortalStep: React.FC = () => {
  const { client, docs } = useWorkspace();
  const bridge = useExtensionBridge(client.id);
  const portal = docs.portal;
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(TAB_PARAM);
  const tab: TabKey = TABS.some((t) => t === fromUrl) ? (fromUrl as TabKey) : 'gstr9';
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(TAB_PARAM, v);
    setParams(next, { replace: true });
  };

  const g9Source = portal.gstr9Meta?.source ?? null;
  const fromPortal = FY_MONTHS.filter((m) => portal.monthMeta[m]?.source === 'as_filed_3b').length;
  const typedMonths = FY_MONTHS.filter((m) => portal.monthMeta[m]?.source === 'manual').length;
  const typed = Object.keys(portal.manual || {}).length;

  const g9Fetched = g9Source === 'extension' || g9Source === 'upload';
  const g9Title = portal.gstr9Meta?.fetchedAt ? fmtWhen(portal.gstr9Meta.fetchedAt) : 'Tables 4, 6A, 6G, 8A, 9';
  const trigger = 'gap-1.5 px-2.5 py-1 text-xs';
  const pill = 'h-4 rounded-full px-1.5 text-[10px] font-normal leading-none';

  return (
    <div className="space-y-3">
      <OpenDifferences step="portal" />

      {/*
        Both sections stay mounted (forceMount) and the inactive one is only hidden: each keeps its own
        pull-polling timer and import preview, which must survive switching tabs while a pull is running.
      */}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="max-w-full overflow-x-auto">
            <TabsList className="h-8 w-max">
              <TabsTrigger value="gstr9" className={trigger} title={g9Title}>
                GSTR-9 system computed
                <Badge variant={g9Fetched ? 'success' : g9Source ? 'secondary' : 'warning'} className={pill}>
                  {g9Source ? SOURCE_TEXT[g9Source] ?? g9Source : 'Not fetched'}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="gstr3b" className={trigger} title={typedMonths ? `${typedMonths} more typed by hand` : 'Applied from the portal'}>
                As-filed GSTR-3B
                <Badge variant={fromPortal === 12 ? 'success' : fromPortal + typedMonths === 12 ? 'secondary' : 'warning'} className={pill}>
                  {fromPortal}/12 from the portal{typedMonths ? ` · ${typedMonths} typed` : ''}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span title="Kept on every re-import unless ticked in the preview">
              <span className="font-medium text-foreground tabular-nums">{typed}</span> figure{typed === 1 ? '' : 's'} typed by hand
            </span>
            {bridge.ready ? (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-success-strong" aria-hidden="true" />
                <span className="font-medium text-foreground">Extension connected</span>
                {bridge.version ? `v${bridge.version}` : 'ready to pull'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1" title="The browser extension is needed for Pull; Upload and typing work without it">
                <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-medium text-foreground">Extension not detected</span>— needed for Pull only
              </span>
            )}
          </div>
        </div>

        <TabsContent value="gstr9" forceMount className="data-[state=inactive]:hidden">
          <Gstr9Section bridge={bridge} />
        </TabsContent>
        <TabsContent value="gstr3b" forceMount className="data-[state=inactive]:hidden">
          <Gstr3bSection bridge={bridge} />
        </TabsContent>
      </Tabs>

      {/* The step heading already says it in short; the full rule sits under the figures. */}
      <Note tone="info">
        <span className="font-semibold">Portal figures only.</span> Everything on this step comes from the GST portal — pulled by the browser extension from the client&apos;s own login, uploaded from the JSON saved on the portal, or typed from the portal screen. The app&apos;s own GSTR-1 and GSTR-3B are never used in the GSTR-9 / 9C workings, because they may differ from what was actually filed.
      </Note>
    </div>
  );
};

export default PortalStep;
