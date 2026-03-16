import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

import { AppLayout } from "@/components/layout/AppLayout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Leads from "@/pages/Leads";
import Clients from "@/pages/Clients";
import Proposals from "@/pages/Proposals";
import ApprovalsPage from "@/pages/Approvals";
import Projects from "@/pages/Projects";
import Invoices from "@/pages/Invoices";
import Payments from "@/pages/Payments";
import Notifications from "@/pages/Notifications";
import AuditLog from "@/pages/AuditLog";
import Team from "@/pages/Team";
import SettingsPage from "@/pages/SettingsPage";
import ClientUpdates from "@/pages/ClientUpdates";
import PortalEntry from "@/pages/portal/PortalEntry";
import Renewals from "@/pages/Renewals";
import DigestInspector from "@/pages/DigestInspector";
import InviteAccept from "@/pages/InviteAccept";
import ResetPassword from "@/pages/ResetPassword";
import BetaFeedback from "@/pages/BetaFeedback";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/invite" element={<InviteAccept />} />

            {/* External client portal (completely decoupled auth — Phase 6) */}
            <Route path="/portal/*" element={<PortalEntry />} />

            {/* Internal authenticated routes */}
            <Route
              element={
                <ProtectedRoute>
                  <WorkspaceProvider>
                    <AppLayout />
                  </WorkspaceProvider>
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/proposals" element={<Proposals />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/payments" element={<Payments />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/client-updates" element={<ClientUpdates />} />
              <Route path="/renewals" element={<Renewals />} />
              <Route path="/digest-inspector" element={<DigestInspector />} />
              <Route path="/beta-feedback" element={<BetaFeedback />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>

            {/* Redirects */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
