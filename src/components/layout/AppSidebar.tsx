import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Inbox,
  Building2,
  FileText,
  CheckSquare,
  FolderKanban,
  Receipt,
  CreditCard,
  Bell,
  Shield,
  Settings,
  LogOut,
  ChevronsUpDown,
  MessageSquare,
  RefreshCw,
  FileSearch,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  section?: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard", section: "Overview" },
  { label: "Leads", icon: Inbox, path: "/leads", section: "Pre-Sales" },
  { label: "Clients", icon: Building2, path: "/clients", section: "Pre-Sales" },
  { label: "Proposals", icon: FileText, path: "/proposals", section: "Commercial" },
  { label: "Approvals", icon: CheckSquare, path: "/approvals", section: "Commercial" },
  { label: "Projects", icon: FolderKanban, path: "/projects", section: "Operations" },
  { label: "Client Updates", icon: MessageSquare, path: "/client-updates", section: "Operations" },
  { label: "Invoices", icon: Receipt, path: "/invoices", section: "Finance", adminOnly: true },
  { label: "Payments", icon: CreditCard, path: "/payments", section: "Finance", adminOnly: true },
  { label: "Renewals", icon: RefreshCw, path: "/renewals", section: "Finance" },
  { label: "Notifications", icon: Bell, path: "/notifications", section: "System" },
  { label: "Digest Inspector", icon: FileSearch, path: "/digest-inspector", section: "System", adminOnly: true },
  { label: "Beta Feedback", icon: MessageSquarePlus, path: "/beta-feedback", section: "System", adminOnly: true },
  { label: "Audit Log", icon: Shield, path: "/audit", section: "System", adminOnly: true },
  { label: "Team", icon: Users, path: "/team", section: "System", adminOnly: true },
  { label: "Settings", icon: Settings, path: "/settings", section: "System" },
];

interface Props {
  mobileOpen: boolean;
  onClose: () => void;
}

export function AppSidebar({ mobileOpen, onClose }: Props) {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const { currentWorkspace, currentRole, workspaces, setCurrentWorkspaceId } = useWorkspace();
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

  const filteredItems = navItems.filter(
    (item) => !item.adminOnly || currentRole === "admin"
  );

  const sections = filteredItems.reduce<Record<string, NavItem[]>>((acc, item) => {
    const section = item.section || "Other";
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {});

  const handleNavClick = () => {
    onClose(); // close mobile drawer on nav
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-sidebar border-r border-sidebar-border transition-transform duration-200",
        // Desktop: always visible
        "lg:translate-x-0 lg:z-30",
        // Mobile: slide in/out
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Logo + mobile close */}
      <div className="flex h-14 items-center justify-between px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary shrink-0">
            <span className="text-sm font-bold text-sidebar-primary-foreground">CF</span>
          </div>
          <span className="text-sm font-semibold text-sidebar-accent-foreground">CoreFlow OS</span>
        </div>
        <button
          onClick={onClose}
          className="lg:hidden p-1 rounded-md text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Workspace selector */}
      {currentWorkspace && (
        <div className="px-2 py-2 border-b border-sidebar-border">
          <button
            onClick={() => setShowWorkspacePicker(!showWorkspacePicker)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <span className="truncate font-medium">{currentWorkspace.name}</span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-sidebar-muted" />
          </button>
          {showWorkspacePicker && workspaces.length > 1 && (
            <div className="mt-1 rounded-md border border-sidebar-border bg-sidebar-accent p-1">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => {
                    setCurrentWorkspaceId(ws.id);
                    setShowWorkspacePicker(false);
                  }}
                  className={cn(
                    "flex w-full rounded px-3 py-1.5 text-xs transition-colors",
                    ws.id === currentWorkspace.id
                      ? "text-sidebar-primary font-medium"
                      : "text-sidebar-foreground hover:text-sidebar-accent-foreground"
                  )}
                >
                  {ws.name}
                </button>
              ))}
            </div>
          )}
          {currentRole && (
            <p className="mt-1 px-3 text-[10px] uppercase tracking-wider text-sidebar-muted">
              {currentRole === "admin" ? "Admin" : "Team Member"}
            </p>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-4">
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
              {section}
            </p>
            {items.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={handleNavClick}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 space-y-1">
        {user && (
          <div className="px-3 py-1">
            <p className="text-xs text-sidebar-foreground truncate">{user.email}</p>
          </div>
        )}
        <button
          onClick={() => { onClose(); signOut(); }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
