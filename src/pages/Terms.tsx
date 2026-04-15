import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Terms() {
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

        <h1 className="text-3xl font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 15, 2026</p>

        <div className="prose prose-sm max-w-none text-foreground/90 space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-foreground">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using CoreFlow ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. CoreFlow is a business operations platform designed for agencies, service firms, and distributor-supplier businesses.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">2. Accounts &amp; Workspaces</h2>
            <p className="text-muted-foreground leading-relaxed">
              You must provide a valid email address and verify it before accessing the Service. Each user account may belong to one or more workspaces. You are responsible for maintaining the security of your account credentials and for all activity under your account.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">3. Plans &amp; Billing</h2>
            <p className="text-muted-foreground leading-relaxed">
              CoreFlow offers three tiers: <strong>Free</strong> (up to 3 seats, free forever), <strong>Growth</strong> ($4.99 per seat per month, with a one-time 14-day free trial per workspace), and <strong>Enterprise</strong> (custom pricing). Billing is per seat per workspace. Users belonging to multiple workspaces are billed separately in each. Plan features and limits are described on the landing page and may be updated with notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">4. Acceptable Use</h2>
            <p className="text-muted-foreground leading-relaxed">
              You agree not to misuse the Service. This includes but is not limited to: attempting to bypass access controls or rate limits, uploading malicious content, using the Service for illegal activity, or interfering with the platform's operation. We reserve the right to suspend accounts that violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">5. Data Ownership</h2>
            <p className="text-muted-foreground leading-relaxed">
              You retain ownership of all data you enter into the Service, including client records, invoices, proposals, project details, and files. CoreFlow does not claim ownership of your data. You may export your data at any time using the built-in data export feature.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">6. Service Availability</h2>
            <p className="text-muted-foreground leading-relaxed">
              We strive to maintain high availability but do not guarantee uninterrupted access. The Service may be temporarily unavailable for maintenance or updates. We will endeavor to provide advance notice of planned downtime.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">7. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">
              You may stop using the Service at any time. We may terminate or suspend your access for violations of these terms. Upon termination, your data will be retained for a reasonable period to allow export, after which it may be deleted.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">8. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Service is provided "as is" without warranties of any kind. To the maximum extent permitted by law, CoreFlow shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">9. Changes to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update these terms from time to time. Continued use of the Service after changes constitutes acceptance of the updated terms. Material changes will be communicated via email or in-app notification.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">10. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For questions about these terms, contact us at{" "}
              <a href="mailto:hello@coreflow.app" className="text-primary hover:underline">hello@coreflow.app</a>.
            </p>
          </section>
        </div>

        <div className="mt-12 border-t pt-6 flex gap-4 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
        </div>
      </div>
    </div>
  );
}
