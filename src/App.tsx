import { lazy, Suspense } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { MonthProvider } from "@/contexts/MonthContext";
import { ClientProvider } from "@/contexts/ClientContext";
import MainLayout from "@/components/layout/MainLayout";
import { PageLoading } from "@/components/layout/PageLoading";
import { StaffGuard } from "@/components/guards/StaffGuard";
import LoginPage from "@/pages/LoginPage";
const AgreementConfirmPage = lazy(() => import("@/pages/AgreementConfirmPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const AddClientPage = lazy(() => import("@/pages/AddClientPage"));
const EditClientPage = lazy(() => import("@/pages/EditClientPage"));
const ClientsPage = lazy(() => import("@/pages/ClientsPage"));
const TwoBReconciliationPage = lazy(() => import("@/pages/TwoBReconciliationPage"));
const TwoBAndRCMPage = lazy(() => import("@/pages/TwoBAndRCMPage"));
const SuspendedRecoPage = lazy(() => import("@/pages/SuspendedRecoPage"));
const ITCAndReceivablePage = lazy(() => import("@/pages/ITCAndReceivablePage"));
const RCMSummaryPage = lazy(() => import("@/pages/RCMSummaryPage"));
const ManageMastersPage = lazy(() => import("@/pages/ManageMastersPage"));
const FilingStatusPage = lazy(() => import("@/pages/FilingStatusPage"));
const GSTRunningUpdatePage = lazy(() => import("@/pages/GSTRunningUpdatePage"));
const GSTR1DataPage = lazy(() => import("@/pages/GSTR1DataPage"));
const Gstr3bPage = lazy(() => import("@/pages/Gstr3bPage"));
const Gstr3bAdjustmentsPage = lazy(() => import("@/pages/Gstr3bAdjustmentsPage"));
const AdvancesPage = lazy(() => import("@/pages/AdvancesPage"));
const AnnualReturnPage = lazy(() => import("@/pages/AnnualReturnPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const NoticesDashboardPage = lazy(() => import("@/pages/NoticesDashboardPage"));
const CompanyListPage = lazy(() => import("@/pages/CompanyListPage"));
const CompanyProfilePage = lazy(() => import("@/pages/CompanyProfilePage"));
const NoticeSummaryReportPage = lazy(() => import("@/pages/NoticeSummaryReportPage"));
const GstinWiseNoticeCountPage = lazy(() => import("@/pages/GstinWiseNoticeCountPage"));
const CaseFolderRedirect = lazy(() => import("@/pages/CaseFolderRedirect"));
const ClientCountRedirect = lazy(() => import("@/pages/NoticesRedirects").then((m) => ({ default: m.ClientCountRedirect })));
const HearingsRedirect = lazy(() => import("@/pages/NoticesRedirects").then((m) => ({ default: m.HearingsRedirect })));
const QueueRedirect = lazy(() => import("@/pages/NoticesRedirects").then((m) => ({ default: m.QueueRedirect })));
const AllClientsNoticesPage = lazy(() => import("@/pages/AllClientsNoticesPage"));
const NoticeWorkspacePage = lazy(() => import("@/pages/NoticeWorkspacePage"));
const NoticesCalendarPage = lazy(() => import("@/pages/NoticesCalendarPage"));
const NoticesAutopilotPage = lazy(() => import("@/pages/NoticesAutopilotPage"));
const NoticesReplyFactoryPage = lazy(() => import("@/pages/NoticesReplyFactoryPage"));
const NoticesSettingsPage = lazy(() => import("@/pages/NoticesSettingsPage"));
const NoticeCasesPage = lazy(() => import("@/pages/NoticeCasesPage"));
const NoticeCasePage = lazy(() => import("@/pages/NoticeCasePage"));
const NoticeOpenPage = lazy(() => import("@/pages/NoticeOpenPage"));
const ClientDocumentsPage = lazy(() => import("@/pages/ClientDocumentsPage"));
const AllClientsRefundsPage = lazy(() => import("@/pages/AllClientsRefundsPage"));
const RefundPage = lazy(() => import("@/pages/RefundPage"));
const AllClientsDrc03Page = lazy(() => import("@/pages/AllClientsDrc03Page"));
const BuilderWorkspacePage = lazy(() => import("@/pages/BuilderWorkspacePage"));
const BuilderSettingsPage = lazy(() => import("@/pages/BuilderSettingsPage"));
const BuilderProjectsPage = lazy(() => import("@/pages/BuilderProjectsPage"));
const BuilderProjectDetailPage = lazy(() => import("@/pages/BuilderProjectDetailPage"));
const BuilderBookingsPage = lazy(() => import("@/pages/BuilderBookingsPage"));
const BuilderReturnsPage = lazy(() => import("@/pages/BuilderReturnsPage"));
const BuilderBuEventsPage = lazy(() => import("@/pages/BuilderBuEventsPage"));
const BuilderDastavejPage = lazy(() => import("@/pages/BuilderDastavejPage"));
const BuilderAdjustmentsPage = lazy(() => import("@/pages/BuilderAdjustmentsPage"));
const BuilderFsiPage = lazy(() => import("@/pages/BuilderFsiPage"));
const BuilderReportsPage = lazy(() => import("@/pages/BuilderReportsPage"));
const ManageEmployeesPage = lazy(() => import("@/pages/ManageEmployeesPage"));
const UserControlPage = lazy(() => import("@/pages/UserControlPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const RemindersPage = lazy(() => import("@/pages/RemindersPage"));
const LitigationMattersPage = lazy(() => import("@/pages/LitigationMattersPage"));
const LitigationMatterDetailPage = lazy(() => import("@/pages/LitigationMatterDetailPage"));
const LitigationMISPage = lazy(() => import("@/pages/LitigationMISPage"));
const ChangeHistoryPage = lazy(() => import("@/pages/ChangeHistoryPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ConfirmProvider>
      <Sonner offset={96} />
      <BrowserRouter>
        <AuthProvider>
          <MonthProvider>
            <ClientProvider>
              <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/agreement-confirm/:token" element={<AgreementConfirmPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/" element={<Navigate to="/login" replace />} />
                
                {/* Protected Routes */}
                <Route element={<MainLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/client-documents" element={<ClientDocumentsPage />} />
                  <Route path="/add-client" element={<StaffGuard><AddClientPage /></StaffGuard>} />
                  <Route path="/edit-client/:clientId" element={<StaffGuard><EditClientPage /></StaffGuard>} />
                  <Route path="/clients" element={<StaffGuard><ClientsPage /></StaffGuard>} />
                  <Route path="/2b-reconciliation" element={<TwoBReconciliationPage />} />
                  <Route path="/2b-and-rcm" element={<TwoBAndRCMPage />} />
                  <Route path="/suspended-reco" element={<SuspendedRecoPage />} />
                  <Route path="/itc-summary" element={<ITCAndReceivablePage />} />
                  <Route path="/rcm-summary" element={<RCMSummaryPage />} />
                  <Route path="/manage-masters" element={<StaffGuard><ManageMastersPage /></StaffGuard>} />
                  <Route path="/filing-status" element={<FilingStatusPage />} />
                  <Route path="/reminders" element={<RemindersPage />} />
                  <Route path="/gst-running-update" element={<GSTRunningUpdatePage />} />
                  <Route path="/gstr1-data" element={<GSTR1DataPage />} />
                  <Route path="/gstr3b" element={<Gstr3bPage />} />
                  <Route path="/gstr3b-adjustments" element={<Gstr3bAdjustmentsPage />} />
                  <Route path="/advances" element={<AdvancesPage />} />
                  <Route path="/annual-return" element={<AnnualReturnPage />} />
                  {/* The workspace is the way in. The individual routes below stay
                      live so existing links and bookmarks keep working. */}
                  <Route path="/builder" element={<BuilderWorkspacePage />} />
                  <Route path="/builder-setup" element={<BuilderSettingsPage />} />
                  <Route path="/builder-projects" element={<BuilderProjectsPage />} />
                  <Route path="/builder-projects/:projectId" element={<BuilderProjectDetailPage />} />
                  <Route path="/builder-projects/:projectId/bookings" element={<BuilderBookingsPage />} />
                  <Route path="/builder-projects/:projectId/bu-events" element={<BuilderBuEventsPage />} />
                  <Route path="/builder-projects/:projectId/adjustments" element={<BuilderAdjustmentsPage />} />
                  <Route path="/builder-projects/:projectId/fsi" element={<BuilderFsiPage />} />
                  <Route path="/builder-returns" element={<BuilderReturnsPage />} />
                  <Route path="/builder-dastavej" element={<BuilderDastavejPage />} />
                  <Route path="/builder-reports" element={<BuilderReportsPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/notices-dashboard" element={<NoticesDashboardPage />} />
                  <Route path="/notices-company-list" element={<GstinWiseNoticeCountPage />} />
                  <Route path="/notices-portal-sync" element={<CompanyListPage />} />
                  <Route path="/notices-company/:clientId" element={<CompanyProfilePage />} />
                  <Route path="/notices-report" element={<NoticeSummaryReportPage />} />
                  <Route path="/notices-gstin-wise-count" element={<ClientCountRedirect />} />
                  <Route path="/notices-case-folder/:clientId/:caseId" element={<CaseFolderRedirect />} />
                  <Route path="/notices-all" element={<AllClientsNoticesPage />} />
                  <Route path="/notices/:id" element={<NoticeWorkspacePage />} />
                  <Route path="/notices-queue" element={<QueueRedirect />} />
                  <Route path="/notices-hearings" element={<HearingsRedirect />} />
                  <Route path="/notices-calendar" element={<NoticesCalendarPage />} />
                  <Route path="/notices-autopilot" element={<NoticesAutopilotPage />} />
                  <Route path="/notices-reply-factory" element={<NoticesReplyFactoryPage />} />
                  <Route path="/notices-settings" element={<NoticesSettingsPage />} />
                  <Route path="/notices-cases" element={<NoticeCasesPage />} />
                  <Route path="/notices-case/:clientId/:caseKey" element={<NoticeCasePage />} />
                  <Route path="/notices-open/:id" element={<NoticeOpenPage />} />
                  <Route path="/litigation" element={<LitigationMattersPage />} />
                  <Route path="/litigation/:id" element={<LitigationMatterDetailPage />} />
                  <Route path="/litigation-mis" element={<LitigationMISPage />} />
                  <Route path="/refunds-all" element={<AllClientsRefundsPage />} />
                  <Route path="/refunds/:clientId/:arn" element={<RefundPage />} />
                  <Route path="/drc03-all" element={<AllClientsDrc03Page />} />
                  <Route path="/manage-employees" element={<ManageEmployeesPage />} />
                  <Route path="/user-control" element={<UserControlPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/change-history" element={<StaffGuard><ChangeHistoryPage /></StaffGuard>} />
                </Route>
                
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </ClientProvider>
          </MonthProvider>
        </AuthProvider>
      </BrowserRouter>
      </ConfirmProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
