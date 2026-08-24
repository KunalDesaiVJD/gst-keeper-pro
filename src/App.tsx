import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { MonthProvider } from "@/contexts/MonthContext";
import { ClientProvider } from "@/contexts/ClientContext";
import MainLayout from "@/components/layout/MainLayout";
import LoginPage from "@/pages/LoginPage";
import AgreementConfirmPage from "@/pages/AgreementConfirmPage";
import DashboardPage from "@/pages/DashboardPage";
import AddClientPage from "@/pages/AddClientPage";
import EditClientPage from "@/pages/EditClientPage";
import ClientsPage from "@/pages/ClientsPage";
import TwoBReconciliationPage from "@/pages/TwoBReconciliationPage";
import TwoBAndRCMPage from "@/pages/TwoBAndRCMPage";
import SuspendedRecoPage from "@/pages/SuspendedRecoPage";
import ITCAndReceivablePage from "@/pages/ITCAndReceivablePage";
import RCMSummaryPage from "@/pages/RCMSummaryPage";
import ManageMastersPage from "@/pages/ManageMastersPage";
import FilingStatusPage from "@/pages/FilingStatusPage";
import GSTRunningUpdatePage from "@/pages/GSTRunningUpdatePage";
import GSTR1DataPage from "@/pages/GSTR1DataPage";
import Gstr3bPage from "@/pages/Gstr3bPage";
import Gstr3bAdjustmentsPage from "@/pages/Gstr3bAdjustmentsPage";
import ReportsPage from "@/pages/ReportsPage";
import NoticesDashboardPage from "@/pages/NoticesDashboardPage";
import BuilderWorkspacePage from "@/pages/BuilderWorkspacePage";
import BuilderSettingsPage from "@/pages/BuilderSettingsPage";
import BuilderProjectsPage from "@/pages/BuilderProjectsPage";
import BuilderProjectDetailPage from "@/pages/BuilderProjectDetailPage";
import BuilderBookingsPage from "@/pages/BuilderBookingsPage";
import BuilderReturnsPage from "@/pages/BuilderReturnsPage";
import BuilderBuEventsPage from "@/pages/BuilderBuEventsPage";
import BuilderDastavejPage from "@/pages/BuilderDastavejPage";
import BuilderAdjustmentsPage from "@/pages/BuilderAdjustmentsPage";
import BuilderFsiPage from "@/pages/BuilderFsiPage";
import BuilderReportsPage from "@/pages/BuilderReportsPage";
import ManageEmployeesPage from "@/pages/ManageEmployeesPage";
import UserControlPage from "@/pages/UserControlPage";
import SettingsPage from "@/pages/SettingsPage";
import RemindersPage from "@/pages/RemindersPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ConfirmProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <MonthProvider>
            <ClientProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/agreement-confirm/:token" element={<AgreementConfirmPage />} />
                <Route path="/" element={<Navigate to="/login" replace />} />
                
                {/* Protected Routes */}
                <Route element={<MainLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/add-client" element={<AddClientPage />} />
                  <Route path="/edit-client/:clientId" element={<EditClientPage />} />
                  <Route path="/clients" element={<ClientsPage />} />
                  <Route path="/2b-reconciliation" element={<TwoBReconciliationPage />} />
                  <Route path="/2b-and-rcm" element={<TwoBAndRCMPage />} />
                  <Route path="/suspended-reco" element={<SuspendedRecoPage />} />
                  <Route path="/itc-summary" element={<ITCAndReceivablePage />} />
                  <Route path="/rcm-summary" element={<RCMSummaryPage />} />
                  <Route path="/manage-masters" element={<ManageMastersPage />} />
                  <Route path="/filing-status" element={<FilingStatusPage />} />
                  <Route path="/reminders" element={<RemindersPage />} />
                  <Route path="/gst-running-update" element={<GSTRunningUpdatePage />} />
                  <Route path="/gstr1-data" element={<GSTR1DataPage />} />
                  <Route path="/gstr3b" element={<Gstr3bPage />} />
                  <Route path="/gstr3b-adjustments" element={<Gstr3bAdjustmentsPage />} />
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
                  <Route path="/manage-employees" element={<ManageEmployeesPage />} />
                  <Route path="/user-control" element={<UserControlPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
                
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ClientProvider>
          </MonthProvider>
        </AuthProvider>
      </BrowserRouter>
      </ConfirmProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
