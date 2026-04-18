import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Inbox, FileText, FolderKanban, Receipt, CreditCard, RefreshCw,
  ArrowRight, Check, Users, Building2, BarChart3, ShieldCheck, Globe,
} from "lucide-react";

const PLANS = [
  {
    name: "Starter",
    price: "৳799",
    period: "user / month",
    description: "For small Bangladeshi teams running their first structured operations.",
    cta: "Start Free",
    ctaVariant: "outline" as const,
    ctaLink: "/login",
    highlight: false,
    features: [
      "Up to 3 seats per workspace",
      "Leads, proposals & projects",
      "Client portal",
      "Invoicing & payments (Mushak 6.3 ready)",
      "CSV exports",
    ],
  },
  {
    name: "Growth",
    price: "৳1,799",
    period: "user / month",
    description: "For growing Bangladeshi agencies and service firms that need full operational control.",
    cta: "Start 14-Day Free Trial",
    ctaVariant: "default" as const,
    ctaLink: "/login",
    highlight: true,
    badge: "Most Popular",
    features: [
      "Everything in Starter",
      "Unlimited seats",
      "Approval workflows",
      "Expense & vendor tracking",
      "Subscriptions & renewals",
      "Budget vs actual reporting",
      "Priority support",
    ],
    trialNote: "No payment details required during trial",
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "talk to us",
    description: "For larger Bangladeshi organisations needing custom setup and a direct commercial conversation.",
    cta: "Contact Us",
    ctaVariant: "outline" as const,
    ctaLink: "mailto:hello@coreflow.app?subject=Enterprise%20inquiry",
    highlight: false,
    features: [
      "Everything in Growth",
      "Built for larger teams",
      "Custom workspace setup",
      "Direct commercial discussion",
      "Audit & compliance support",
    ],
  },
];

const WORKFLOW_STEPS = [
  { icon: Inbox, label: "Capture Leads" },
  { icon: FileText, label: "Send Proposals" },
  { icon: FolderKanban, label: "Run Projects" },
  { icon: Receipt, label: "Invoice Clients" },
  { icon: CreditCard, label: "Record Payments" },
  { icon: RefreshCw, label: "Automate Renewals" },
];

const BENEFITS = [
  { icon: Building2, title: "Client-centric", description: "Every lead, project, invoice, and payment is tied to a client — no orphaned records." },
  { icon: Users, title: "Team-ready", description: "Role-based access, project-scoped visibility, and approval workflows for growing teams." },
  { icon: Globe, title: "Client Portal", description: "Give clients a branded portal to view proposals, invoices, onboarding tasks, and updates." },
  { icon: BarChart3, title: "Financial clarity", description: "Track expenses, subscriptions, budgets, and revenue — all in one place." },
  { icon: ShieldCheck, title: "Secure by default", description: "Row-level security, workspace isolation, and audit logging built in from day one." },
  { icon: Receipt, title: "Built for Bangladesh", description: "Mushak 6.3-ready invoicing, BIN fields, BDT-native amounts, and bKash/Nagad payment recording." },
];

export default function Landing() {
  useEffect(() => {
    const id = "coreflow-jsonld";
    if (!document.getElementById(id)) {
      const script = document.createElement("script");
      script.id = id;
      script.type = "application/ld+json";
      script.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "CoreFlow",
        url: "https://coreflow-gtk.lovable.app/",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "Bangladesh-first operations platform for agencies and service firms. Manage leads, proposals, projects, invoicing, payments, and renewals with a client portal.",
        offers: [
          {
            "@type": "Offer",
            price: "799",
            priceCurrency: "BDT",
            name: "Starter",
            description: "Per user per month, up to 3 seats per workspace",
          },
          {
            "@type": "Offer",
            price: "1799",
            priceCurrency: "BDT",
            name: "Growth",
            description: "Per user per month, unlimited seats",
          },
        ],
      });
      document.head.appendChild(script);
    }
    return () => {
      document.getElementById(id)?.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <span className="text-xs font-bold text-primary-foreground">CF</span>
            </div>
            <span className="text-lg font-semibold text-foreground">CoreFlow</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <a href="#pricing">Pricing</a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/login">Sign In</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/login">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
      {/* Hero */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center">
        <Badge variant="secondary" className="mb-4">Built in Bangladesh, for Bangladeshi service businesses</Badge>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Run your client business<br />
          <span className="text-primary">from lead to renewal</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
          CoreFlow is the operations platform for Bangladeshi agencies, service firms, and distributor–supplier teams. Manage leads, proposals, projects, Mushak 6.3-ready invoicing, payments, and renewals — with a client portal your customers will actually use.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button size="lg" asChild>
            <Link to="/login">Get Started Free</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a href="#pricing">View Pricing</a>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Free Starter tier up to 3 seats · 14-day Growth trial included</p>
      </section>

      {/* Workflow spine */}
      <section className="border-y bg-muted/30 py-16">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="mb-10 text-center text-2xl font-semibold text-foreground">One connected workflow</h2>
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
            {WORKFLOW_STEPS.map((step, i) => (
              <span key={step.label} className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm">
                  <step.icon className="h-4 w-4 text-primary" />
                  {step.label}
                </span>
                {i < WORKFLOW_STEPS.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
                )}
              </span>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-xl text-center text-sm text-muted-foreground">
            Every stage is connected. A lead becomes a proposal, an approved proposal converts to a project, and invoices flow into payment tracking and renewals — automatically.
          </p>
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="mb-10 text-center text-2xl font-semibold text-foreground">Why teams choose CoreFlow</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <Card key={b.title} className="border bg-card">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <b.icon className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">{b.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{b.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="mb-2 text-center text-2xl font-semibold text-foreground">Simple, transparent pricing</h2>
          <p className="mb-10 text-center text-sm text-muted-foreground">
            Billed per user, per workspace, in BDT. Same person in multiple workspaces is billed separately.
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            {PLANS.map((plan) => (
              <Card
                key={plan.name}
                className={`relative flex flex-col ${plan.highlight ? "border-primary ring-1 ring-primary shadow-md" : "border"}`}
              >
                {plan.badge && (
                  <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs">
                    {plan.badge}
                  </Badge>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                    {plan.period && <span className="ml-1 text-sm text-muted-foreground">/ {plan.period}</span>}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col">
                  <ul className="mb-6 flex-1 space-y-2">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant={plan.ctaVariant}
                    className={`w-full ${plan.highlight ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
                    asChild
                  >
                    {plan.ctaLink.startsWith("mailto") ? (
                      <a href={plan.ctaLink}>{plan.cta}</a>
                    ) : (
                      <Link to={plan.ctaLink}>{plan.cta}</Link>
                    )}
                  </Button>
                  {plan.trialNote && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">{plan.trialNote}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-4 py-20 text-center">
        <h2 className="text-2xl font-semibold text-foreground">Ready to streamline your operations?</h2>
        <p className="mt-3 text-muted-foreground">
          Start with the free Starter tier — move to Growth when your team is ready.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button size="lg" asChild>
            <Link to="/login">Get Started for Free</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a href="mailto:hello@coreflow.app?subject=CoreFlow%20Demo%20Request">Book a Demo</a>
          </Button>
        </div>
      </section>

      </main>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} CoreFlow. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
