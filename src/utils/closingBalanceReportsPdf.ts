// Every Reports Hub PDF (and the Clients page's and the notice summary's) goes
// out in the firm's Big4 working-paper style: src/lib/reportExport/pdf.ts,
// which keeps what this renderer used to do (a "PDF" link column printed as a
// clickable "View PDF", a report's pdfColumns, wide tables breaking across
// pages rather than crushing columns) on the house letterhead.
import { downloadReportPdf } from '@/lib/reportExport/pdf';
import type { ReportTable } from './allClientsReports';

export const renderReportToPdf = (report: ReportTable): Promise<void> => downloadReportPdf(report);
