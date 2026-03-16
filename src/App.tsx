import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";

// Critical path – loaded eagerly
import Login from "@/pages/Login";

// Route-level code splitting – lazy loaded
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Leads = lazy(() => import("@/pages/Leads"));
const Clients = lazy(() => import("@/pages/Clients"));
const Proposals = lazy(() => import("@/pages/Proposals"));
const ApprovalsPage = lazy(() => import("@/pages/Approvals"));
const Projects = lazy(() => import("@/pages/Projects"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const Payments = lazy(() => import("@/pages/Payments"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const AuditLog = lazy(() => import("@/pages/AuditLog"));
const Team = lazy(() => import("@/pages/Team"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const ClientUpdates = lazy(() => import("@/pages/ClientUpdates"));
const PortalEntry = lazy(() => import("@/pages/portal/PortalEntry"));
const Renewals = lazy(() => import("@/pages/Renewals"));
const DigestInspector = lazy(() => import("@/pages/DigestInspector"));
const InviteAccept = lazy(() => import("@/pages/InviteAccept"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const BetaFeedback = lazy(() => import("@/pages/BetaFeedback"));
const NotFound = lazy(() => import("@/pages/NotFound"));

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
              <Route path="/team" element={<Team />} />
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
