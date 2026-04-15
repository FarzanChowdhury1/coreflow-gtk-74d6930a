import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to CoreFlow
        </Link>

        <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 15, 2026</p>

        <div className="prose prose-sm max-w-none text-foreground/90 space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-foreground">1. Information We Collect</h2>
            <p className="text-muted-foreground leading-relaxed">
              We collect information you provide directly: your name, email address, and workspace data (clients, contacts, leads, proposals, projects, invoices, payments, expenses, and files). We also collect usage data such as login timestamps, feature usage events, and browser metadata for product improvement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">2. How We Use Your Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your data is used to provide and improve the Service, including: authenticating your account, delivering workspace functionality, sending transactional emails (invoices, digests, password resets), tracking product adoption for feature improvement, and generating aggregated analytics visible only within your workspace.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">3. Data Storage &amp; Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your data is stored on secure, managed infrastructure with row-level security ensuring strict tenant isolation — each workspace's data is accessible only to its members. Files are stored in encrypted cloud storage with scoped access controls. All connections use HTTPS/TLS encryption in transit.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">4. Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Service uses the following third-party providers to operate: cloud database and authentication infrastructure, and email delivery services for transactional notifications. Additional security services (such as bot protection) may be enabled over time. We do not sell your data to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">5. Data Sharing</h2>
            <p className="text-muted-foreground leading-relaxed">
              We do not share your personal data or workspace data with third parties for marketing purposes. Data may be shared only: with your consent, to comply with legal obligations, or to protect the rights and safety of CoreFlow and its users.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">6. Client Portal</h2>
            <p className="text-muted-foreground leading-relaxed">
              When you share portal access with your clients via magic link tokens, the client can view only the data explicitly shared with them (invoices, proposals, project updates, and onboarding tasks for their company). Portal tokens expire automatically and can be revoked at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">7. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your workspace data is retained as long as your account is active. System logs, notifications, and audit records follow automated retention schedules and are periodically cleaned. You may export your data at any time using the built-in data export tools (CSV and XLSX formats).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">8. Cookies &amp; Tracking</h2>
            <p className="text-muted-foreground leading-relaxed">
              CoreFlow uses essential cookies for authentication session management. We track product adoption events (feature usage) internally to improve the Service. We do not use third-party advertising trackers or cross-site tracking.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">9. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">
              You have the right to access, correct, and export your data at any time. To request data deletion, contact us and we will process your request within a reasonable timeframe. Workspace admins can manage team member access and data within their workspace.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">10. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For privacy questions or data requests, contact us at{" "}
              <a href="mailto:hello@coreflow.app" className="text-primary hover:underline">hello@coreflow.app</a>.
            </p>
          </section>
        </div>

        <div className="mt-12 border-t pt-6 flex gap-4 text-sm text-muted-foreground">
          <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
        </div>
      </div>
    </div>
  );
}
