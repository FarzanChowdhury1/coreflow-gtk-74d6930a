import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { PlatformAdminGuard } from "@/components/auth/PlatformAdminGuard";
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
const OpsHealth = lazy(() => import("@/pages/OpsHealth"));
const InviteAccept = lazy(() => import("@/pages/InviteAccept"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const BetaFeedback = lazy(() => import("@/pages/BetaFeedback"));
const Meetings = lazy(() => import("@/pages/Meetings"));
const Vendors = lazy(() => import("@/pages/Vendors"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Subscriptions = lazy(() => import("@/pages/Subscriptions"));
const BudgetActual = lazy(() => import("@/pages/BudgetActual"));
const EmailHealth = lazy(() => import("@/pages/EmailHealth"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const PlatformFeedback = lazy(() => import("@/pages/platform/PlatformFeedback"));
const Landing = lazy(() => import("@/pages/Landing"));

const PageFallback = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes — wrapped in own Suspense */}
            <Route path="/login" element={<Suspense fallback={<PageFallback />}><Login /></Suspense>} />
            <Route path="/reset-password" element={<Suspense fallback={<PageFallback />}><ResetPassword /></Suspense>} />
            <Route path="/invite" element={<Suspense fallback={<PageFallback />}><InviteAccept /></Suspense>} />

            {/* External client portal */}
            <Route path="/portal/*" element={<Suspense fallback={<PageFallback />}><PortalEntry /></Suspense>} />

              {/* Platform admin routes (cross-workspace, no workspace context needed) */}
              <Route path="/platform/feedback" element={<Suspense fallback={<PageFallback />}><PlatformAdminGuard><PlatformFeedback /></PlatformAdminGuard></Suspense>} />

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
                {/* Team-visible routes */}
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/leads" element={<Leads />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/proposals" element={<Proposals />} />
                <Route path="/approvals" element={<ApprovalsPage />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/meetings" element={<Meetings />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/client-updates" element={<ClientUpdates />} />
                <Route path="/settings" element={<SettingsPage />} />

                {/* Admin-only routes — guarded at route level */}
                <Route path="/invoices" element={<AdminGuard><Invoices /></AdminGuard>} />
                <Route path="/payments" element={<AdminGuard><Payments /></AdminGuard>} />
                <Route path="/renewals" element={<AdminGuard><Renewals /></AdminGuard>} />
                <Route path="/vendors" element={<AdminGuard><Vendors /></AdminGuard>} />
                <Route path="/expenses" element={<AdminGuard><Expenses /></AdminGuard>} />
                <Route path="/subscriptions" element={<AdminGuard><Subscriptions /></AdminGuard>} />
                <Route path="/budget" element={<AdminGuard><BudgetActual /></AdminGuard>} />
                <Route path="/audit" element={<AdminGuard><AuditLog /></AdminGuard>} />
                <Route path="/team" element={<AdminGuard><Team /></AdminGuard>} />
                <Route path="/digest-inspector" element={<AdminGuard><DigestInspector /></AdminGuard>} />
                <Route path="/ops" element={<AdminGuard><OpsHealth /></AdminGuard>} />
                <Route path="/beta-feedback" element={<AdminGuard><BetaFeedback /></AdminGuard>} />
                <Route path="/email-health" element={<AdminGuard><EmailHealth /></AdminGuard>} />
              </Route>

            {/* Public landing page */}
            <Route path="/" element={<Suspense fallback={<PageFallback />}><Landing /></Suspense>} />
            <Route path="*" element={<Suspense fallback={<PageFallback />}><NotFound /></Suspense>} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
