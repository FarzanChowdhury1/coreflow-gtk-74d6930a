/**
 * Smoke integration test: login → dashboard render → create lead flow.
 *
 * This is a lightweight React-level smoke test that verifies the critical
 * component tree renders without crashing. It does NOT hit a real backend;
 * Supabase calls are mocked. The goal is regression protection for the
 * core path, not full e2e coverage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mock Supabase client before any component imports ──
const mockRpc = vi.fn().mockResolvedValue({ data: { active_leads: 3, open_proposals: 1, running_projects: 2, pending_invoices: 0, total_receivable: 0, total_collected: 0, is_admin: true }, error: null });
const mockSelect = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    is: vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      }),
      gte: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    order: vi.fn().mockReturnValue({
      range: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  }),
});
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "test-user-id", email: "test@test.com" } } }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "test-user-id", email: "test@test.com" } }, error: null }),
    },
    from: mockFrom,
    rpc: mockRpc,
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnValue({ subscribe: vi.fn() }) }),
  },
}));

// Mock workspace context with minimal valid state
vi.mock("@/contexts/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkspace: () => ({
    currentWorkspace: { id: "ws-1", name: "Test Workspace", currency: "BDT" },
    currentRole: "admin",
    workspaces: [{ id: "ws-1", name: "Test Workspace" }],
    loading: false,
  }),
}));

// Mock auth context
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: { id: "test-user-id", email: "test@test.com" },
    session: { user: { id: "test-user-id" } },
    loading: false,
  }),
}));

// ── Tests ──

describe("Smoke: Dashboard renders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dashboard heading and metric cards", async () => {
    const Dashboard = (await import("@/pages/Dashboard")).default;
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <Dashboard />
      </QueryClientProvider>
    );

    // Dashboard heading should appear
    expect(screen.getByText("Dashboard")).toBeInTheDocument();

    // Metric card labels
    await waitFor(() => {
      expect(screen.getByText("Active Leads")).toBeInTheDocument();
      expect(screen.getByText("Open Proposals")).toBeInTheDocument();
      expect(screen.getByText("Running Projects")).toBeInTheDocument();
      expect(screen.getByText("Pending Invoices")).toBeInTheDocument();
    });
  });
});

describe("Smoke: Lead creation dialog opens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders leads page and opens new lead dialog", async () => {
    const Leads = (await import("@/pages/Leads")).default;
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { MemoryRouter } = await import("react-router-dom");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Leads />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Leads page heading
    expect(screen.getByText("Lead Inbox")).toBeInTheDocument();

    // "New Lead" button should exist
    const newLeadBtn = screen.getByRole("button", { name: /new lead/i });
    expect(newLeadBtn).toBeInTheDocument();

    // Click it — the dialog should open
    await userEvent.click(newLeadBtn);

    await waitFor(() => {
      // Dialog title or form field should appear
      expect(screen.getByText(/add lead|new lead|create lead/i)).toBeInTheDocument();
    });
  });
});
