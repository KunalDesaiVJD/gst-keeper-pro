import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/gstr9/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspace } from '../WorkspaceContext';
import { OpenDifferences } from '../ui';
import Annexure1 from '../annexures/Annexure1';
import Annexure2 from '../annexures/Annexure2';
import Annexure3 from '../annexures/Annexure3';
import Annexure4 from '../annexures/Annexure4';
import { ANNEX_TAB_PARAM } from '../annexures/taxRows';

const TABS = [
  { key: 'a1', title: 'Annexure-1', sub: 'Income reco', diffPrefix: 'ann1.' },
  { key: 'a2', title: 'Annexure-2', sub: 'ITC reco', diffPrefix: 'ann2.' },
  { key: 'a3', title: 'Annexure-3', sub: 'DRC-03', diffPrefix: null },
  { key: 'a4', title: 'Annexure-4', sub: 'Previous-year GSTR-9', diffPrefix: 'ann4.' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** Step 9 — the ANNEXURE sheet: income reco, ITC reco, DRC-03 working, previous year's GSTR-9 clauses. */
const AnnexuresStep: React.FC = () => {
  const { workings } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get(ANNEX_TAB_PARAM);
  const tab: TabKey = TABS.some((t) => t.key === fromUrl) ? (fromUrl as TabKey) : 'a1';
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set(ANNEX_TAB_PARAM, v);
    setParams(next, { replace: true });
  };
  const openIn = (prefix: string | null) => (prefix ? workings.diffs.filter((d) => d.open && d.key.startsWith(prefix)).length : 0);

  return (
    <div className="space-y-3">
      <OpenDifferences step="annexures" />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="max-w-full overflow-x-auto">
          <TabsList className="h-8 gap-0.5 p-0.5" aria-label="Annexures">
            {TABS.map((t) => {
              const open = openIn(t.diffPrefix);
              return (
                <TabsTrigger key={t.key} value={t.key} className="h-7 gap-1.5 px-2.5 text-xs">
                  <span>{t.title}</span>
                  <span className="hidden font-normal text-muted-foreground sm:inline">· {t.sub}</span>
                  {open > 0 && (
                    <Badge variant="destructive" className="h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none" aria-label={`${open} open`}>
                      {open}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        <TabsContent value="a1" className="mt-3"><Annexure1 /></TabsContent>
        <TabsContent value="a2" className="mt-3"><Annexure2 /></TabsContent>
        <TabsContent value="a3" className="mt-3"><Annexure3 /></TabsContent>
        <TabsContent value="a4" className="mt-3"><Annexure4 /></TabsContent>
      </Tabs>
    </div>
  );
};

export default AnnexuresStep;
