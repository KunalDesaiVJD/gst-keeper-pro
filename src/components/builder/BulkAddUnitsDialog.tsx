/**
 * Add many units at once.
 *
 * A tower is entered once, at onboarding, and it is hundreds of rows: typing
 * them one dialog at a time is the single biggest cost of putting a promoter on
 * the system. Three ways in, because inventory arrives in three shapes:
 *
 *   Template — download a workbook shaped for this project, fill it, upload it
 *              back. The only route that carries **charge heads**, which is why
 *              it leads: a charge head is what pushes a unit past ₹45 lakh and
 *              out of the 1.5% bracket, so a list imported without its charges
 *              can look right today and be wrong once they are keyed in.
 *   Generate — floors × units per floor, for a regular tower. The firm knows
 *              the shape and the numbering convention; nothing needs typing per
 *              unit except the exceptions.
 *   Paste    — a quick tab- or comma-separated dump for a handful of units,
 *              when opening a spreadsheet would be the slower path.
 *
 * All three land in the same preview, where every row shows its derived rate and
 * affordability before anything is written. That preview is the point: rate is
 * derived from type, area and value, so a mis-typed carpet area is a wrong rate
 * on every receipt that follows, and it is far cheaper to catch here.
 */

import React, { useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Loader2, Layers, AlertTriangle, CheckCircle2, Download, Upload, FileSpreadsheet,
} from 'lucide-react';
import {
  RATE_CODE_LABEL, classifyUnit, formatINR,
  type ChargeInclusionSettings, type UnitType,
} from '@/utils/builderRates';
import {
  BULK_UNIT_STATUSES, generateUnits, parsePastedUnits,
} from '@/utils/builderBulkUnits';
import {
  downloadUnitTemplate, parseUnitWorkbook, type DraftUnitWithCharges,
} from '@/utils/builderUnitTemplate';

const UNIT_TYPES: UnitType[] = ['Residential', 'Commercial'];
const UNIT_STATUSES = [...BULK_UNIT_STATUSES];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  projectName?: string;
  groups: { id: string; name: string }[];
  groupingLabel: string;
  isMetro: boolean;
  isRrep: boolean;
  settings: ChargeInclusionSettings;
  /** Unit numbers already on the project, for duplicate detection. */
  existingUnitNos: string[];
  onSaved: () => void | Promise<void>;
}

const BulkAddUnitsDialog: React.FC<Props> = ({
  open, onOpenChange, projectId, projectName, groups, groupingLabel, isMetro, isRrep,
  settings, existingUnitNos, onSaved,
}) => {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [mode, setMode] = useState('template');

  // Generate mode
  const [gen, setGen] = useState({
    floorFrom: '1', floorTo: '10', perFloor: '4',
    pattern: '{F}{NN}', skipFloors: '',
    unit_type: 'Residential' as UnitType,
    carpet: '', consideration: '', status: 'Available', group_id: '',
  });

  // Paste mode
  const [pasted, setPasted] = useState('');

  // Template mode — rows read back from a filled workbook.
  const [uploaded, setUploaded] = useState<DraftUnitWithCharges[]>([]);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const drafts: DraftUnitWithCharges[] = useMemo(() => {
    // Only the template can express charge heads; the other two paths produce
    // units with none, to be added per unit afterwards where they apply.
    if (mode === 'template') return uploaded;
    if (mode === 'paste') {
      return parsePastedUnits(pasted, groups).map((d) => ({ ...d, charges: [] }));
    }
    return generateUnits({
      floorFrom: parseInt(gen.floorFrom, 10),
      floorTo: parseInt(gen.floorTo, 10),
      perFloor: parseInt(gen.perFloor, 10),
      pattern: gen.pattern,
      skipFloors: gen.skipFloors.split(',')
        .map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite),
      unitType: gen.unit_type,
      carpetAreaSqM: parseFloat(gen.carpet) || 0,
      baseConsideration: parseFloat(gen.consideration) || 0,
      status: gen.status,
      groupId: gen.group_id || null,
    }).map((d) => ({ ...d, charges: [] }));
  }, [mode, pasted, uploaded, groups, gen]);

  /** Derived rate per row, plus the two things that make a row unsaveable. */
  const previewed = useMemo(() => {
    const existing = new Set(existingUnitNos.map((u) => u.trim().toLowerCase()));
    const seen = new Set<string>();
    return drafts.map((d) => {
      const key = d.unit_no.trim().toLowerCase();
      let problem: string | undefined;
      if (!d.unit_no.trim()) problem = 'Unit number is blank';
      else if (existing.has(key)) problem = 'Already exists on this project';
      else if (seen.has(key)) problem = 'Duplicated in this batch';
      seen.add(key);

      const cls = classifyUnit({
        unitType: d.unit_type,
        carpetAreaSqM: d.carpet_area_sqm,
        baseConsideration: d.base_consideration,
        charges: d.charges,
        isMetro,
        isRrep,
        settings,
      });
      return { ...d, problem, cls };
    });
  }, [drafts, existingUnitNos, isMetro, isRrep, settings]);

  const okRows = previewed.filter((r) => !r.problem);
  const badRows = previewed.filter((r) => r.problem);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setUploadError(null); setUploadNote(null);
    try {
      const parsed = parseUnitWorkbook(await file.arrayBuffer(), groups);
      if (parsed.error) { setUploaded([]); setUploadError(parsed.error); return; }
      setUploaded(parsed.drafts);
      const charged = parsed.drafts.filter((d) => d.charges.length).length;
      setUploadNote(
        `${file.name} — ${parsed.drafts.length} unit${parsed.drafts.length === 1 ? '' : 's'} read`
        + (charged ? `, ${charged} carrying charge heads` : '')
        + (parsed.skippedRows ? `. ${parsed.skippedRows} row(s) had no unit number and were skipped.` : '.'),
      );
    } catch (err) {
      setUploaded([]);
      setUploadError(`Could not read the file: ${(err as Error).message}`);
    }
  };

  const handleSave = async () => {
    if (!okRows.length) return;
    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('builder_units')
        .insert(okRows.map((r) => ({
          project_id: projectId,
          group_id: r.group_id,
          unit_no: r.unit_no.trim(),
          unit_type: r.unit_type,
          carpet_area_sqm: r.carpet_area_sqm,
          base_consideration: r.base_consideration,
          status: r.status,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        })))
        .select('id, unit_no');
      if (error) throw error;
      if (!data || !data.length) {
        throw new Error('Write was rejected by the database (no rows returned).');
      }

      // Opening classification for each unit, in one write. This is the audit
      // trail a retrospective re-rating is built on, so a bulk-added unit has to
      // carry it exactly as a singly-added one does.
      const byNo = new Map(okRows.map((r) => [r.unit_no.trim(), r]));
      const history = (data as { id: string; unit_no: string }[]).map((u) => {
        const r = byNo.get(u.unit_no);
        if (!r) return null;
        return {
          unit_id: u.id,
          is_affordable: r.cls.affordable.isAffordable,
          rate_code: r.cls.rateCode,
          rate_pct: r.cls.ratePct,
          effective_rate_pct: r.cls.effectiveRatePct,
          gross_consideration: r.cls.gross.gross,
          carpet_area_sqm: r.carpet_area_sqm,
          area_limit_sqm: r.cls.areaLimitSqM,
          is_rrep: r.cls.isRrep,
          reason: 'INITIAL',
          created_by: user?.id ?? null,
        };
      }).filter(Boolean);
      if (history.length) {
        const { error: histErr } = await supabase
          .from('builder_unit_classification_history')
          .insert(history as never[]);
        // The units are in and usable; a missing history row is worth saying out
        // loud but is not a reason to claim the whole batch failed.
        if (histErr) toast.warning(`Units added, but classification history failed: ${histErr.message}`);
      }

      // Charge heads, where the template supplied them. Written after the units
      // because they hang off the unit id, and in one call for the same reason
      // the units were.
      const chargeRows = (data as { id: string; unit_no: string }[]).flatMap((u) => {
        const r = byNo.get(u.unit_no);
        return (r?.charges || []).map((c) => ({
          unit_id: u.id,
          charge_head: c.charge_head,
          amount: c.amount,
          include_override: c.include_override ?? null,
        }));
      });
      if (chargeRows.length) {
        const { error: chErr } = await supabase.from('builder_unit_charges').insert(chargeRows);
        // The units exist and are correct on their base value; say plainly that
        // the charges did not land, because the derived rate depends on them.
        if (chErr) {
          toast.warning(`Units added, but charge heads failed: ${chErr.message}. `
            + 'Add them per unit — they affect the ₹45 lakh test.');
        }
      }

      toast.success(
        `${data.length} unit${data.length === 1 ? '' : 's'} added`
        + (chargeRows.length ? ` with ${chargeRows.length} charge head rows.` : '.'),
      );
      onOpenChange(false);
      setPasted('');
      setUploaded([]);
      setUploadNote(null);
      await onSaved();
    } catch (e) {
      toast.error(`Could not add units: ${(e as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const totalValue = okRows.reduce((s, r) => s + r.cls.gross.gross, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Add units in bulk
          </DialogTitle>
          <DialogDescription>
            Rate and affordability are derived from type, carpet area and value — check them in the
            preview before saving. Charge heads are not set here; add them per unit afterwards where
            they apply, since a charge head can push a unit past ₹45 lakh and out of the 1.5% bracket.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={setMode}>
          <TabsList>
            <TabsTrigger value="template">Excel template</TabsTrigger>
            <TabsTrigger value="generate">Generate a tower</TabsTrigger>
            <TabsTrigger value="paste">Quick paste</TabsTrigger>
          </TabsList>

          {/* ── Template ──────────────────────────────────────────────────── */}
          <TabsContent value="template" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">1</span>
                  Download the template
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Pre-filled with this project&apos;s {groupingLabel.toLowerCase()}s, your client&apos;s
                  confirmed charge-head elections, and a reference sheet explaining what drives the rate.
                </p>
                <Button
                  variant="outline" size="sm" className="mt-3"
                  onClick={() => {
                    downloadUnitTemplate({
                      projectName, groupingLabel,
                      groupNames: groups.map((g) => g.name),
                      settings, isMetro,
                    });
                    toast.success('Template downloaded.');
                  }}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Download template
                </Button>
              </div>

              <div className="rounded-lg border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">2</span>
                  Upload it back
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Columns are matched by name, so reordering, deleting unused columns or adding your
                  own is fine. .xlsx, .xls or .csv.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" /> Choose file
                </Button>
                <input
                  ref={fileRef} type="file" className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFile}
                />
              </div>
            </div>

            {uploadNote && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                {uploadNote}
              </p>
            )}
            {uploadError && (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {uploadError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              This is the only route that carries charge heads. That matters: a charge head is what
              pushes a unit past ₹45 lakh and out of the 1.5% bracket, so importing the unit list
              without its charges can classify correctly today and be wrong once the charges are
              keyed in later.
            </p>
          </TabsContent>

          {/* ── Generate ──────────────────────────────────────────────────── */}
          <TabsContent value="generate" className="space-y-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <div>
                <Label className="mb-1.5 block">Floor from</Label>
                <Input
                  type="number" value={gen.floorFrom}
                  onChange={(e) => setGen({ ...gen, floorFrom: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Floor to</Label>
                <Input
                  type="number" value={gen.floorTo}
                  onChange={(e) => setGen({ ...gen, floorTo: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Units per floor</Label>
                <Input
                  type="number" value={gen.perFloor}
                  onChange={(e) => setGen({ ...gen, perFloor: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Skip floors</Label>
                <Input
                  placeholder="e.g. 13"
                  value={gen.skipFloors}
                  onChange={(e) => setGen({ ...gen, skipFloors: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block">Numbering pattern</Label>
                <Input
                  value={gen.pattern}
                  onChange={(e) => setGen({ ...gen, pattern: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {'{F}'} floor · {'{N}'} unit · {'{NN}'} padded. {'{F}{NN}'} → 302 on floor 3.
                </p>
              </div>
              <div>
                <Label className="mb-1.5 block">Type</Label>
                <Select
                  value={gen.unit_type}
                  onValueChange={(v) => setGen({ ...gen, unit_type: v as UnitType })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Status</Label>
                <Select value={gen.status} onValueChange={(v) => setGen({ ...gen, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Carpet area (sq m)</Label>
                <Input
                  type="number" value={gen.carpet}
                  onChange={(e) => setGen({ ...gen, carpet: e.target.value })}
                />
              </div>
              <div>
                <Label className="mb-1.5 block">Base consideration</Label>
                <Input
                  type="number" value={gen.consideration}
                  onChange={(e) => setGen({ ...gen, consideration: e.target.value })}
                />
              </div>
              {groups.length > 0 && (
                <div>
                  <Label className="mb-1.5 block">{groupingLabel}</Label>
                  <Select
                    value={gen.group_id || 'NONE'}
                    onValueChange={(v) => setGen({ ...gen, group_id: v === 'NONE' ? '' : v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Ungrouped</SelectItem>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Area and value apply to every generated unit. Where they differ by unit — and on a real
              tower they usually do — paste from the client's sheet instead, or edit the outliers
              after saving.
            </p>
          </TabsContent>

          {/* ── Paste ─────────────────────────────────────────────────────── */}
          <TabsContent value="paste" className="space-y-3 pt-4">
            <div>
              <Label className="mb-1.5 block">Paste rows</Label>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                placeholder={'Unit\tType\tCarpet (sq m)\tConsideration\tStatus\tBlock\n'
                  + '101\tResidential\t58\t4200000\tBooked\tA\n'
                  + '102\tResidential\t72\t5100000\tAvailable\tA\n'
                  + '\nCopy straight out of Excel — tabs or commas both work, and a header row is '
                  + 'detected and skipped.'}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Columns in order: unit number, type, carpet area in sq m, base consideration, status,
              {' '}{groupingLabel.toLowerCase()}. Only the unit number is required. Amounts may carry
              ₹ and Indian digit grouping.
            </p>
          </TabsContent>
        </Tabs>

        {/* ── Preview ─────────────────────────────────────────────────────── */}
        {previewed.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {okRows.length} ready
              </Badge>
              {badRows.length > 0 && (
                <Badge variant="outline" className="gap-1 border-destructive/40">
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                  {badRows.length} skipped
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                Total gross consideration {formatINR(totalValue)}
              </span>
            </div>

            <div className="max-h-[40vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Unit</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Carpet</TableHead>
                    <TableHead className="text-right">Charges</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead>Affordable</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewed.slice(0, 300).map((r, i) => (
                    <TableRow key={`${r.unit_no}-${i}`} className={r.problem ? 'opacity-50' : undefined}>
                      <TableCell className="font-medium text-sm">
                        {r.unit_no || <span className="text-muted-foreground">—</span>}
                        {r.problem && (
                          <span className="block text-xs text-destructive">{r.problem}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{r.unit_type}</TableCell>
                      <TableCell className="text-right text-sm">{r.carpet_area_sqm || '—'}</TableCell>
                      <TableCell className="text-right text-sm">
                        {r.charges.length
                          ? formatINR(r.charges.reduce((s2, c) => s2 + c.amount, 0))
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatINR(r.cls.gross.gross)}</TableCell>
                      <TableCell className="text-sm">
                        {r.unit_type === 'Commercial'
                          ? <span className="text-muted-foreground">n/a</span>
                          : r.cls.affordable.isAffordable
                            ? <Badge variant="outline" className="text-xs">Yes</Badge>
                            : <span className="text-muted-foreground text-xs">No</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.cls.ratePct}%
                        <span className="block text-xs text-muted-foreground">
                          {RATE_CODE_LABEL[r.cls.rateCode]}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">{r.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {previewed.length > 300 && (
              <p className="text-xs text-muted-foreground">
                Showing the first 300 of {previewed.length} rows. All {okRows.length} valid rows
                will be saved.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaving || !okRows.length}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add {okRows.length || ''} unit{okRows.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkAddUnitsDialog;
