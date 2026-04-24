import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminGuard } from "@/components/auth/AdminGuard";
import { PlatformAdminGuard } from "@/components/auth/PlatformAdminGuard";
import { ModuleAccessGuard } from "@/components/auth/ModuleAccessGuard";
import { FeatureGate } from "@/components/auth/FeatureGate";
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
const Collections = lazy(() => import("@/pages/Collections"));
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
const Profitability = lazy(() => import("@/pages/Profitability"));
const EmailHealth = lazy(() => import("@/pages/EmailHealth"));
const DataExport = lazy(() => import("@/pages/DataExport"));
const Reports = lazy(() => import("@/pages/Reports"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const PlatformFeedback = lazy(() => import("@/pages/platform/PlatformFeedback"));
const PlatformDashboard = lazy(() => import("@/pages/platform/PlatformDashboard"));
const PlatformActivations = lazy(() => import("@/pages/platform/PlatformActivations"));
const Landing = lazy(() => import("@/pages/Landing"));
const Terms = lazy(() => import("@/pages/Terms"));
const Privacy = lazy(() => import("@/pages/Privacy"));

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
              <Route path="/platform/dashboard" element={<Suspense fallback={<PageFallback />}><PlatformAdminGuard><PlatformDashboard /></PlatformAdminGuard></Suspense>} />
              <Route path="/platform/activations" element={<Suspense fallback={<PageFallback />}><PlatformAdminGuard><PlatformActivations /></PlatformAdminGuard></Suspense>} />

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
                <Route path="/approvals" element={<FeatureGate feature="approvalWorkflows" label="Approval Workflows"><ApprovalsPage /></FeatureGate>} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/meetings" element={<Meetings />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/client-updates" element={<ClientUpdates />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/reports" element={<AdminGuard><Reports /></AdminGuard>} />

                {/* Admin-only routes — guarded at route level */}
                <Route path="/invoices" element={<AdminGuard><Invoices /></AdminGuard>} />
                <Route path="/payments" element={<AdminGuard><Payments /></AdminGuard>} />
                <Route path="/renewals" element={<AdminGuard><Renewals /></AdminGuard>} />
                <Route path="/collections" element={<AdminGuard><Collections /></AdminGuard>} />
                <Route path="/vendors" element={<ModuleAccessGuard module="vendor_management"><FeatureGate feature="vendorManagement" label="Vendor Management"><Vendors /></FeatureGate></ModuleAccessGuard>} />
                <Route path="/expenses" element={<AdminGuard><FeatureGate feature="expenseTracking" label="Expense Tracking"><Expenses /></FeatureGate></AdminGuard>} />
                <Route path="/subscriptions" element={<ModuleAccessGuard module="subscription_management"><FeatureGate feature="subscriptionTracking" label="Subscription Tracking"><Subscriptions /></FeatureGate></ModuleAccessGuard>} />
                <Route path="/budget" element={<AdminGuard><FeatureGate feature="budgetVsActual" label="Budget vs Actual"><BudgetActual /></FeatureGate></AdminGuard>} />
                <Route path="/profitability" element={<AdminGuard><FeatureGate feature="profitability" label="Project Profitability"><Profitability /></FeatureGate></AdminGuard>} />
                <Route path="/audit" element={<AdminGuard><FeatureGate feature="auditLog" label="Audit Log"><AuditLog /></FeatureGate></AdminGuard>} />
                <Route path="/team" element={<AdminGuard><Team /></AdminGuard>} />
                <Route path="/digest-inspector" element={<AdminGuard><DigestInspector /></AdminGuard>} />
                <Route path="/ops" element={<AdminGuard><OpsHealth /></AdminGuard>} />
                <Route path="/beta-feedback" element={<AdminGuard><BetaFeedback /></AdminGuard>} />
                <Route path="/email-health" element={<AdminGuard><EmailHealth /></AdminGuard>} />
                <Route path="/data-export" element={<AdminGuard><FeatureGate feature="csvExport" label="Data Export"><DataExport /></FeatureGate></AdminGuard>} />
              </Route>

            {/* Public pages */}
            <Route path="/" element={<Suspense fallback={<PageFallback />}><Landing /></Suspense>} />
            <Route path="/terms" element={<Suspense fallback={<PageFallback />}><Terms /></Suspense>} />
            <Route path="/privacy" element={<Suspense fallback={<PageFallback />}><Privacy /></Suspense>} />
            <Route path="*" element={<Suspense fallback={<PageFallback />}><NotFound /></Suspense>} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
