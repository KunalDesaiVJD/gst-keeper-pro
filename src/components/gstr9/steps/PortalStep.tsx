import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { FY_MONTHS } from '@/lib/gstr9/types';
import { fmtWhen } from '@/lib/gstr9/portalImport';
import { KpiTile, Note, OpenDifferences } from '../ui';
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

  const g9Source = portal.gstr9Meta?.source ?? null;
  const fromPortal = FY_MONTHS.filter((m) => portal.monthMeta[m]?.source === 'as_filed_3b').length;
  const typedMonths = FY_MONTHS.filter((m) => portal.monthMeta[m]?.source === 'manual').length;
  const typed = Object.keys(portal.manual || {}).length;

  return (
    <div className="space-y-4">
      <OpenDifferences step="portal" />

      <Note tone="info">
        <span className="font-semibold">Portal figures only.</span> Everything on this step comes from the GST portal — pulled by the browser extension from the client&apos;s own login, uploaded from the JSON saved on the portal, or typed from the portal screen. The app&apos;s own GSTR-1 and GSTR-3B are never used in the GSTR-9 / 9C workings, because they may differ from what was actually filed.
      </Note>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiTile
          label="GSTR-9 system computed"
          value={g9Source ? SOURCE_TEXT[g9Source] ?? g9Source : 'Not fetched'}
          hint={portal.gstr9Meta?.fetchedAt ? fmtWhen(portal.gstr9Meta.fetchedAt) : 'Tables 4, 6A, 6G, 8A, 9'}
          tone={g9Source === 'extension' || g9Source === 'upload' ? 'ok' : g9Source ? 'neutral' : 'warn'}
        />
        <KpiTile
          label="As-filed GSTR-3B"
          value={`${fromPortal}/12 months`}
          hint={typedMonths ? `${typedMonths} more typed by hand` : 'applied from the portal'}
          tone={fromPortal === 12 ? 'ok' : fromPortal + typedMonths === 12 ? 'neutral' : 'warn'}
        />
        <KpiTile label="Typed by hand" value={typed} hint="kept on every re-import unless ticked" />
        <KpiTile
          label="Browser extension"
          value={
            bridge.ready ? (
              <span className="inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4 text-success-strong" /> Connected</span>
            ) : 'Not detected'
          }
          hint={bridge.ready ? (bridge.version ? `v${bridge.version}` : 'ready to pull') : 'needed for Pull; Upload and typing work without it'}
          tone={bridge.ready ? 'ok' : 'neutral'}
        />
      </div>

      <Gstr9Section bridge={bridge} />
      <Gstr3bSection bridge={bridge} />
    </div>
  );
};

export default PortalStep;
