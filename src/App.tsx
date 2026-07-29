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
import ReportsPage from "@/pages/ReportsPage";
import BuilderSettingsPage from "@/pages/BuilderSettingsPage";
import BuilderProjectsPage from "@/pages/BuilderProjectsPage";
import BuilderProjectDetailPage from "@/pages/BuilderProjectDetailPage";
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
                  <Route path="/builder-setup" element={<BuilderSettingsPage />} />
                  <Route path="/builder-projects" element={<BuilderProjectsPage />} />
                  <Route path="/builder-projects/:projectId" element={<BuilderProjectDetailPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
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
