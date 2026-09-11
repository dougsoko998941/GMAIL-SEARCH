'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const demo = [
  { id:'1', title:'Dentist Appointment', date:'2026-09-09', time:'3:30 PM', location:'Darien, CT', sender:'appointments@example.com', type:'Medical', confidence:96 },
  { id:'2', title:'Parent / Teacher Meeting', date:'2026-09-10', time:'6:00 PM', location:'Darien, CT', sender:'school@example.com', type:'School', confidence:93 },
  { id:'3', title:'Car Service', date:'2026-09-14', time:'8:00 AM', location:'Stamford, CT', sender:'service@example.com', type:'Service', confidence:89 }
];

// The v0 preview needs the Supabase redirect proxy because its URL is
// unstable, but that proxy points back at the preview VM's localhost. On a
// real deployed domain we must redirect to this site's own /auth/callback.
function getAuthRedirect() {
  const host = window.location.hostname;
  const isPreview =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.vusercontent.net') ||
    host.endsWith('.v0.dev') ||
    host.includes('vercel.run');
  if (isPreview && process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL) {
    return process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL;
  }
  return `${window.location.origin}/auth/callback`;
}

export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [signedIn, setSignedIn] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [error, setError] = useState('');
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [reminding, setReminding] = useState(null);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('reminder-recipients') || '[]');
      if (Array.isArray(saved)) setRecipients(saved.filter((r) => r?.name && r?.phone));
    } catch {}
  }, []);

  useEffect(() => {
    let active = true;
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (session) {
        setSignedIn(true);
        load();
      } else {
        setSignedIn(false);
        setShowDemo(true);
        setStatus('idle');
      }
    }
    init();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setSignedIn(true);
        // A fresh SIGNED_IN carries a Google refresh token — save it so the
        // server can silently mint new access tokens later without re-login.
        if (event === 'SIGNED_IN') {
          if (session.provider_refresh_token) {
            fetch('/api/appointments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: session.provider_refresh_token }),
            }).finally(scan);
          } else {
            scan();
          }
        } else {
          load();
        }
      }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connectGmail() {
    setError('');
    setSetupNeeded(false);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getAuthRedirect(),
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
        // Get the URL back instead of navigating, so we can validate it first
        // and surface a friendly message instead of a raw Supabase error page.
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      if (/provider is not enabled/i.test(error.message)) setSetupNeeded(true);
      else setError(error.message);
      return;
    }

    // Probe the generated Supabase authorize URL; a disabled provider returns
    // a 400 JSON error here before any browser redirect happens.
    try {
      const probe = await fetch(data.url, { redirect: 'manual' });
      if (probe.type !== 'opaqueredirect' && probe.status >= 400) {
        setSetupNeeded(true);
        return;
      }
    } catch {
      // Network/CORS quirks shouldn't block a valid redirect — fall through.
    }

    window.location.href = data.url;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSignedIn(false);
    setItems([]);
    setShowDemo(true);
    setStatus('idle');
  }

  // Read saved appointments from the database (no Gmail call).
  async function load() {
    setStatus('loading');
    setError('');
    try {
      const r = await fetch('/api/appointments');
      if (!r.ok) throw new Error('request_failed');
      const data = await r.json();
      setItems(data.items || []);
      setShowDemo(false);
      setStatus('ready');
    } catch {
      setStatus('idle');
      setError('Could not load your saved appointments.');
    }
  }

  // Scan Gmail for new appointments, save them, then show the stored set.
  async function scan() {
    setStatus('loading');
    setError('');
    try {
      const r = await fetch('/api/appointments?scan=1');
      if (r.status === 403) {
        // Access token missing/expired after reload — re-run OAuth to refresh it.
        setError('Your Gmail access expired. Reconnect to refresh it.');
        setStatus('idle');
        setShowDemo(false);
        return;
      }
      if (!r.ok) throw new Error('request_failed');
      const data = await r.json();
      setItems(data.items || []);
      if (data.scan) setScanNote(`Scanned ${data.scan.scanned} recent emails, found ${data.scan.found} appointment${data.scan.found === 1 ? '' : 's'}.`);
      setShowDemo(false);
      setStatus('ready');
    } catch {
      setStatus('idle');
      setError('Could not scan your inbox. Try refreshing.');
    }
  }

  function saveRecipient(e) {
    e.preventDefault();
    const phone = recipientPhone.replace(/[^+\d]/g, '');
    if (!recipientName.trim() || !phone) return;
    const next = [...recipients, { id: `${Date.now()}-${phone}`, name: recipientName.trim(), phone }];
    setRecipients(next);
    window.localStorage.setItem('reminder-recipients', JSON.stringify(next));
    setRecipientName('');
    setRecipientPhone('');
  }

  function openTextReminder(recipient) {
    if (!reminding) return;
    const details = [reminding.date, reminding.time, reminding.location].filter(Boolean).join(' at ');
    const message = `Reminder: ${reminding.title}${details ? ` — ${details}` : ''}.`;
    window.location.href = `sms:${recipient.phone}?&body=${encodeURIComponent(message)}`;
    setReminding(null);
  }

  async function deleteAppt(id) {
    if (!confirm('Delete this appointment?')) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/appointments?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('delete_failed');
      const data = await r.json();
      setItems(data.items || []);
    } catch {
      setError('Could not delete that appointment.');
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    const form = editing;
    setBusyId(form.id);
    try {
      const r = await fetch('/api/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error('update_failed');
      const data = await r.json();
      setItems(data.items || []);
      setEditing(null);
    } catch {
      setError('Could not save your changes.');
    } finally {
      setBusyId(null);
    }
  }

  const shown = showDemo ? demo : items;
  const today = useMemo(() => new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}),[]);

  return (
    <main>
      <header className="topbar">
        <div>
          <div className="eyebrow">INBOX APPOINTMENTS</div>
          <h1>Upcoming</h1>
          <div className="muted">{today}</div>
        </div>
        <button className="round" onClick={signedIn ? scan : connectGmail} aria-label="Scan inbox">↻</button>
      </header>

      <section className="summary">
        <div><span className="num">{shown.length}</span><span className="label">Upcoming</span></div>
        <div><span className="num">{shown.filter(x=>x.type==='Medical').length}</span><span className="label">Medical</span></div>
        <div><span className="num">{shown.filter(x=>x.type==='Dining').length}</span><span className="label">Dining</span></div>
      </section>

      {signedIn && scanNote && status==='ready' && <div className="scanNote">{scanNote}</div>}

      {!signedIn && <section className="connectCard">
        <div className="badge">Demo view</div>
        <h2>Connect Gmail to scan your inbox</h2>
        <p>The app looks for confirmations and reminders containing future dates, times and locations. It reads only the email data needed to identify likely appointments.</p>
        <button className="primary" onClick={connectGmail}>Connect Gmail</button>
        {error && <div className="errorMsg">{error}</div>}
        {setupNeeded && <div className="setupBox">
          <strong>Google sign-in isn&apos;t enabled yet</strong>
          <p>Supabase rejected the request because the Google provider is turned off. Finish this one-time setup, then tap Connect again:</p>
          <ol>
            <li>Google Cloud Console: create an OAuth client (Web application) and enable the Gmail API.</li>
            <li>Supabase dashboard: Authentication &rarr; Providers &rarr; Google &rarr; toggle on, paste the Client ID &amp; Secret, Save.</li>
            <li>Copy the callback URL Supabase shows, and add it to your Google OAuth client&apos;s Authorized redirect URIs.</li>
            <li>On the Google consent screen, add the <code>gmail.readonly</code> scope and add yourself as a Test user.</li>
          </ol>
        </div>}
        <div className="small">You can add this page to your iPhone Home Screen from Safari.</div>
        <div className="small">We request read-only Gmail access only to find appointments. <a href="/privacy">Privacy Policy</a></div>
      </section>}

      {signedIn && error && <section className="connectCard">
        <h2>Reconnect needed</h2>
        <p>{error}</p>
        <button className="primary" onClick={connectGmail}>Reconnect Gmail</button>
      </section>}

      <section className="list">
        {shown.map((a, i) => <article className="card" key={a.id || i}>
          <div className="dateBox"><strong>{new Date(a.date+'T12:00:00').toLocaleDateString(undefined,{month:'short'}).toUpperCase()}</strong><span>{new Date(a.date+'T12:00:00').getDate()}</span></div>
          <div className="details">
            <h3>{a.title}</h3>
            <div className="meta">{[a.time, a.location].filter(Boolean).join(' · ') || 'Details in email'}</div>
            <div className="row2"><span className={`pill pill-${(a.type || 'Appointment').toLowerCase()}`}>{a.type || 'Appointment'}</span><span className="source">{a.sender}</span></div>
          </div>
          {!showDemo && <div className="cardActions">
            <button aria-label="Text reminder" onClick={()=>setReminding(a)}>SMS</button>
            <button aria-label="Edit appointment" onClick={()=>setEditing({ id:a.id, title:a.title, date:a.date, time:a.time||'', location:a.location||'', type:a.type||'Appointment' })} disabled={busyId===a.id}>✎</button>
            <button aria-label="Delete appointment" className="danger" onClick={()=>deleteAppt(a.id)} disabled={busyId===a.id}>✕</button>
          </div>}
        </article>)}
        {!shown.length && status==='ready' && <div className="empty">No upcoming appointments found.</div>}
      </section>

      {reminding && <div className="modalOverlay" onClick={()=>setReminding(null)}>
        <div className="modal" onClick={(e)=>e.stopPropagation()}>
          <h2>Text reminder</h2>
          <p className="muted">Choose a recipient. Messages opens with a prefilled reminder; you review and send it.</p>
          {recipients.map((recipient) => <button className="primary compact" key={recipient.id} onClick={()=>openTextReminder(recipient)}>{recipient.name}</button>)}
          <form onSubmit={saveRecipient}>
            <label>Name<input value={recipientName} onChange={(e)=>setRecipientName(e.target.value)} placeholder="Recipient name" required /></label>
            <label>Mobile number<input type="tel" value={recipientPhone} onChange={(e)=>setRecipientPhone(e.target.value)} placeholder="+1 555 555 5555" required /></label>
            <button type="submit" className="primary">Add recipient</button>
          </form>
          <button className="ghost" onClick={()=>setReminding(null)}>Cancel</button>
        </div>
      </div>}

      {editing && <div className="modalOverlay" onClick={()=>setEditing(null)}>
        <form className="modal" onClick={(e)=>e.stopPropagation()} onSubmit={saveEdit}>
          <h2>Edit appointment</h2>
          <label>Title<input value={editing.title} onChange={(e)=>setEditing({...editing, title:e.target.value})} required /></label>
          <label>Date<input type="date" value={editing.date} onChange={(e)=>setEditing({...editing, date:e.target.value})} required /></label>
          <label>Time<input value={editing.time} onChange={(e)=>setEditing({...editing, time:e.target.value})} placeholder="e.g. 3:30 PM" /></label>
          <label>Location<input value={editing.location} onChange={(e)=>setEditing({...editing, location:e.target.value})} placeholder="e.g. Darien, CT" /></label>
          <label>Type
            <select value={editing.type} onChange={(e)=>setEditing({...editing, type:e.target.value})}>
              {['Medical','Dining','School','Sports','Service','Travel','Appointment'].map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="modalActions">
            <button type="button" className="ghost" onClick={()=>setEditing(null)}>Cancel</button>
            <button type="submit" className="primary compact" disabled={busyId===editing.id}>{busyId===editing.id ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>}

      <nav className="bottomNav">
        <button className="active">Upcoming</button>
        <button onClick={()=>alert('Search/filter screen can be added next.')}>Search</button>
        <button onClick={signedIn ? signOut : connectGmail}>{signedIn ? 'Sign out' : 'Connect'}</button>
      </nav>
    </main>
  );
}
