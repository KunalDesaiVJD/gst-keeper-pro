import React, { useCallback, useMemo } from 'react';
import { useWorkspace } from '../WorkspaceContext';
import { JustifyControl, SectionCard, useDiffLine } from '../ui';
import { GridColumn, GridFooterRow, SheetGrid } from '../grid/SheetGrid';
import { moneyCol } from '../grid/columns';

interface AuditRow {
  id: 'partA' | 'partB' | 'total' | 'report';
  label: string;
  cell: string;
  value: number | null;
  hint?: string;
  f?: Record<string, string>;
}

/**
 * PL-OUTPUT D50–D56: books (Part A + Part B) against the total income as per
 * the audit report. Only "As per report" is typed; the rest is computed.
 */
const AuditReconciliation: React.FC = () => {
  const { docs, workings, update, readOnly } = useWorkspace();
  const s = workings.sales;
  const line = useDiffLine('sales.audit');

  const rows = useMemo<AuditRow[]>(
    () => [
      { id: 'partA', label: 'Total income — Part A', cell: 'D33', value: s.partATaxable },
      { id: 'partB', label: 'Total income — Part B', cell: 'D50', value: s.partBTotal },
      { id: 'total', label: 'Total income — Part A + B (books)', cell: 'D52', value: s.total, hint: 'Should match the audit report' },
      {
        id: 'report',
        label: 'Total income as per audit report',
        cell: 'D54',
        value: docs.sales.auditReportTotal,
        f: docs.sales.f?.auditReportTotal ? { amount: docs.sales.f.auditReportTotal } : undefined,
      },
    ],
    [s.partATaxable, s.partBTotal, s.total, docs.sales.auditReportTotal, docs.sales.f],
  );

  const onRowsChange = useCallback(
    (next: AuditRow[]) => {
      const report = next.find((r) => r.id === 'report');
      if (!report) return;
      const formula = report.f?.amount;
      if (report.value === docs.sales.auditReportTotal && formula === docs.sales.f?.auditReportTotal) return;
      update('sales', (d) => {
        const f = { ...(d.f || {}) };
        if (formula) f.auditReportTotal = formula;
        else delete f.auditReportTotal;
        return { ...d, auditReportTotal: report.value, f };
      });
    },
    [update, docs.sales.auditReportTotal, docs.sales.f],
  );

  const columns = useMemo<GridColumn<AuditRow>[]>(() => {
    const amount = moneyCol<AuditRow>('amount', 'Amount', (r) => r.value, (r, v) => ({ ...r, value: v }), {
      width: 140,
      nullable: true,
      editable: (r) => r.id === 'report',
    });
    return [
      { key: 'label', header: 'Particulars', type: 'display', align: 'left', width: 230, value: (r) => r.label },
      { key: 'cell', header: 'Excel', type: 'display', align: 'left', width: 52, value: (r) => r.cell, tone: () => 'muted' },
      { ...amount, placeholder: (r) => (r.id === 'report' ? 'Type the audit report total' : null) },
      {
        key: 'status',
        header: 'Status',
        type: 'display',
        align: 'left',
        width: 150,
        value: (r) => r.hint ?? null,
        render: (r) => (r.hint ? <span className="text-[11px] text-muted-foreground">{r.hint}</span> : null),
      },
    ];
  }, []);

  const diff = s.auditDiff;
  const footer: GridFooterRow[] = [
    {
      key: 'diff',
      label: 'Difference (Report − Books)',
      tone: line?.open ? 'diff' : 'total',
      cells: {
        cell: 'D56',
        amount: diff ?? <span className="font-normal text-muted-foreground">—</span>,
        status:
          diff === null ? (
            <span className="text-[11px] font-normal text-muted-foreground">Enter the audit report total</span>
          ) : (
            <JustifyControl lineKey="sales.audit" />
          ),
      },
    },
  ];

  return (
    <SectionCard
      title="Audit report reconciliation"
      description="Books total income against the total income as per the audit report."
      excelRef="PL-OUTPUT D50–D56"
    >
      <SheetGrid<AuditRow>
        label="Total income: books against the audit report"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowsChange={onRowsChange}
        readOnly={readOnly}
        footer={footer}
      />
    </SectionCard>
  );
};

export default AuditReconciliation;
