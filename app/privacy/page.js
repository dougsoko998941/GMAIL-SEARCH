import Link from 'next/link';
import '../styles.css';

export const metadata = {
  title: 'Privacy Policy · Inbox Appointments',
  description: 'How Inbox Appointments accesses and uses your Google account data.',
};

export default function PrivacyPolicy() {
  const updated = 'September 10, 2026';
  return (
    <main className="doc">
      <header className="docHead">
        <div className="eyebrow">INBOX APPOINTMENTS</div>
        <h1>Privacy Policy</h1>
        <div className="muted">Last updated {updated}</div>
      </header>

      <section className="prose">
        <p>
          Inbox Appointments (&quot;the app&quot;, &quot;we&quot;, &quot;us&quot;) helps you see upcoming
          appointments and reservations that are already sitting in your Gmail inbox. This policy
          explains exactly what data we access, why, how it is stored, and how you can remove it.
        </p>

        <h2>What we access</h2>
        <p>
          When you choose to connect your Google account, we request read-only access to your Gmail
          messages using the <code>gmail.readonly</code> scope. We use this access solely to scan for
          emails that look like appointment confirmations, reservations, and reminders, and to
          extract the title, date, time, and location of those events.
        </p>
        <p>We do not send email, modify your inbox, delete messages, or read messages for any other purpose.</p>

        <h2>What we store</h2>
        <ul>
          <li>The extracted appointment details (title, date, time, location, category, and the sending service).</li>
          <li>A reference id for the source email, so re-scans update rather than duplicate an entry.</li>
          <li>A Google refresh token, stored securely, used only to re-scan your inbox without asking you to sign in every time.</li>
        </ul>
        <p>
          We do <strong>not</strong> store the full contents of your emails, attachments, or any
          message that is not identified as an appointment. Each user can only ever access their own
          data, enforced at the database level with row-level security.
        </p>

        <h2>Limited Use disclosure</h2>
        <p>
          Inbox Appointments&apos; use and transfer of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We do not transfer or sell Google user data to
          third parties, use it for advertising, or allow humans to read it except where required for
          security, to comply with law, or with your explicit consent.
        </p>

        <h2>How data is shared</h2>
        <p>
          We do not sell your data. Appointment data is processed using our database provider
          (Supabase) and an AI model provider (via Vercel AI Gateway) purely to extract event details
          from candidate emails. These providers process the data on our behalf and do not use it for
          their own purposes.
        </p>

        <h2>Deleting your data</h2>
        <p>
          You can delete individual appointments in the app at any time. To remove all stored data and
          revoke access, sign out and remove the app&apos;s access from your{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            Google Account permissions
          </a>
          . You may also contact us to request full deletion of your stored appointment data and
          refresh token.
        </p>

        <h2>Contact</h2>
        <p>Questions about this policy or your data can be sent to the app owner listed on the Google consent screen.</p>

        <p className="backLink"><Link href="/">← Back to app</Link></p>
      </section>
    </main>
  );
}
