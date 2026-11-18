-- builder_unit_ledger counted the opening balance twice (18 Nov 2026).
-- Since 13 Aug 2026 a BU / dastavej differential invoice is raised gross,
-- opening balance included, with an equal Table 11B adjustment from the
-- opening (builder_opening_balance_adjustments). The view added the opening
-- (cumulative_value_taxed) and the gross invoice but never took off that
-- adjustment, so value_taxed, cgst_discharged and sgst_discharged were high by
-- the opening for every such unit (90 units; e.g. SWENI F-108: 27,05,000 taxed
-- against an agreement of 24,85,000). The returns and the tax were right; the
-- view fed the Dastavej register's variance and a conversion's carried value.
-- computeUnitLedger (src/utils/builderLedger.ts) already subtracts it.

CREATE OR REPLACE VIEW public.builder_unit_ledger AS
 SELECT u.id AS unit_id,
    u.project_id,
    p.client_id,
    u.unit_no,
    ((((COALESCE(ob.cumulative_value_taxed, (0)::numeric) + COALESCE(adv.consideration, (0)::numeric)) + COALESCE(inv.consideration, (0)::numeric)) - COALESCE(adj.consideration, (0)::numeric)) - COALESCE(cn.consideration, (0)::numeric)) - COALESCE(oadj.consideration, (0)::numeric) AS value_taxed,
    ((((COALESCE(ob.cumulative_cgst, (0)::numeric) + COALESCE(adv.cgst, (0)::numeric)) + COALESCE(inv.cgst, (0)::numeric)) - COALESCE(adj.cgst, (0)::numeric)) - COALESCE(cn.cgst, (0)::numeric)) - COALESCE(oadj.cgst, (0)::numeric) AS cgst_discharged,
    ((((COALESCE(ob.cumulative_sgst, (0)::numeric) + COALESCE(adv.sgst, (0)::numeric)) + COALESCE(inv.sgst, (0)::numeric)) - COALESCE(adj.sgst, (0)::numeric)) - COALESCE(cn.sgst, (0)::numeric)) - COALESCE(oadj.sgst, (0)::numeric) AS sgst_discharged,
    (COALESCE(adv.consideration, (0)::numeric) - COALESCE(adj.consideration, (0)::numeric)) AS open_advance,
    COALESCE(rec.received, (0)::numeric) AS total_received,
    COALESCE(rec.tds, (0)::numeric) AS total_tds_194ia,
    COALESCE(ob.agreement_value, (0)::numeric) AS opening_agreement_value,
    COALESCE(ob.cumulative_value_taxed, (0)::numeric) AS opening_value_taxed
   FROM ((((((((builder_units u
     JOIN builder_projects p ON ((p.id = u.project_id)))
     LEFT JOIN builder_opening_balances ob ON ((ob.unit_id = u.id)))
     LEFT JOIN ( SELECT builder_receipts.unit_id,
            sum(builder_receipts.consideration) AS consideration,
            sum(builder_receipts.cgst) AS cgst,
            sum(builder_receipts.sgst) AS sgst
           FROM builder_receipts
          WHERE ((builder_receipts.receipt_nature = 'ADVANCE'::text) AND (builder_receipts.cheque_status <> 'Bounced'::text) AND (builder_receipts.gst_already_discharged = false) AND (builder_receipts.subsumed_by_bu_event_id IS NULL))
          GROUP BY builder_receipts.unit_id) adv ON ((adv.unit_id = u.id)))
     LEFT JOIN ( SELECT builder_invoices.unit_id,
            sum(builder_invoices.consideration) AS consideration,
            sum(builder_invoices.cgst) AS cgst,
            sum(builder_invoices.sgst) AS sgst
           FROM builder_invoices
          GROUP BY builder_invoices.unit_id) inv ON ((inv.unit_id = u.id)))
     LEFT JOIN ( SELECT i.unit_id,
            sum(a.consideration_adjusted) AS consideration,
            sum(a.cgst) AS cgst,
            sum(a.sgst) AS sgst
           FROM (builder_advance_adjustments a
             JOIN builder_invoices i ON ((i.id = a.invoice_id)))
          GROUP BY i.unit_id) adj ON ((adj.unit_id = u.id)))
     LEFT JOIN ( SELECT builder_credit_notes.unit_id,
            sum(builder_credit_notes.consideration) AS consideration,
            sum(builder_credit_notes.cgst) AS cgst,
            sum(builder_credit_notes.sgst) AS sgst
           FROM builder_credit_notes
          WHERE (builder_credit_notes.within_window = true)
          GROUP BY builder_credit_notes.unit_id) cn ON ((cn.unit_id = u.id)))
     LEFT JOIN ( SELECT builder_receipts.unit_id,
            sum(COALESCE(builder_receipts.bank_credit, (((builder_receipts.consideration + builder_receipts.cgst) + builder_receipts.sgst) - builder_receipts.tds_194ia))) AS received,
            sum(builder_receipts.tds_194ia) AS tds
           FROM builder_receipts
          WHERE (builder_receipts.cheque_status <> 'Bounced'::text)
          GROUP BY builder_receipts.unit_id) rec ON ((rec.unit_id = u.id)))
     LEFT JOIN ( SELECT builder_opening_balance_adjustments.unit_id,
            sum(builder_opening_balance_adjustments.consideration_adjusted) AS consideration,
            sum(builder_opening_balance_adjustments.cgst) AS cgst,
            sum(builder_opening_balance_adjustments.sgst) AS sgst
           FROM builder_opening_balance_adjustments
          GROUP BY builder_opening_balance_adjustments.unit_id) oadj ON ((oadj.unit_id = u.id)));
