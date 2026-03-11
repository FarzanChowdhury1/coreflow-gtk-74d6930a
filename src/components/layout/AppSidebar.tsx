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
  Globe,
  Bell,
  Shield,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: string;
  section?: string;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/dashboard", section: "Overview" },
  { label: "Leads", icon: Inbox, path: "/leads", section: "Pre-Sales" },
  { label: "Clients", icon: Building2, path: "/clients", section: "Pre-Sales" },
  { label: "Proposals", icon: FileText, path: "/proposals", section: "Commercial" },
  { label: "Approvals", icon: CheckSquare, path: "/approvals", section: "Commercial" },
  { label: "Projects", icon: FolderKanban, path: "/projects", section: "Operations" },
  { label: "Invoices", icon: Receipt, path: "/invoices", section: "Finance" },
  { label: "Payments", icon: CreditCard, path: "/payments", section: "Finance" },
  { label: "Notifications", icon: Bell, path: "/notifications", section: "System" },
  { label: "Audit Log", icon: Shield, path: "/audit", section: "System" },
  { label: "Settings", icon: Settings, path: "/settings", section: "System" },
];

export function AppSidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const sections = navItems.reduce<Record<string, NavItem[]>>((acc, item) => {
    const section = item.section || "Other";
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {});

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
          <span className="text-sm font-bold text-sidebar-primary-foreground">CF</span>
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold text-sidebar-accent-foreground">CoreFlow OS</span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-4">
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
                {section}
              </p>
            )}
            {items.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-md py-2 text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
