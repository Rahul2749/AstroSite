'use client';

import { useEffect, useState, useRef, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/booking-api';
import './admin.css';

type Appointment = {
  id: string; name: string; email: string; service_name: string; starts_at: string;
  status: string; payment_status: string; payment_mode: string; amount: number; version: number;
};
type Detail = Appointment & {
  duration: number; language: string; details: { dob?: string; tob?: string; place?: string; unknown?: boolean; notes?: string };
  order_id: string; payment_id: string; refund_id: string; join_url: string; admin_note: string; created_at: string;
  jobs: { id: string; kind: string; status: string; delivery_status: string; attempts: number; error: string; recipient: string }[];
  audit: { action: string; created_at: string; data: { reason?: string } }[];
};
type Listing = { appointments: Appointment[]; total: number; page: number; stats: { upcoming: number; refunds: number; failed_jobs: number } };
const when = (date: string) => new Date(date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const amount = (paise: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
const label = (value: string) => value.replaceAll('_', ' ');

export default function AdminPage() {
  const [session, setSession] = useState<{ email: string; csrf: string } | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [action, setAction] = useState('');
  const [success, setSuccess] = useState('');
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  function fail(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) { setSession(null); setListing(null); setDetail(null); }
    setError(reason instanceof Error ? reason.message : 'Unable to complete the request.');
  }
  useEffect(() => {
    document.title = 'Appointments · Vedā admin';
    document.documentElement.lang = 'en';
    api<{ email: string; csrf: string }>('/admin/me').then(setSession).catch(e => {
      if (!(e instanceof ApiError && e.status === 401)) fail(e);
    }).finally(() => setLoadingSession(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setBusy(true); setError('');
    api<Listing>(`/admin/appointments?q=${encodeURIComponent(search)}&status=${status}&page=${page}`, { signal: controller.signal })
      .then(setListing).catch(e => { if (!controller.signal.aborted) fail(e); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [session, search, status, page, revision]);
  useEffect(() => {
    if (!rescheduleDate || action !== 'reschedule') return;
    const controller = new AbortController();
    setLoadingSlots(true); setSlots([]);
    api<{ slots: { time: string; available: boolean }[] }>('/availability?date=' + rescheduleDate, { signal: controller.signal })
      .then(r => setSlots(r.slots)).catch(e => { if (!controller.signal.aborted) fail(e); })
      .finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => controller.abort();
  }, [rescheduleDate, action]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { setSession(await api('/admin/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function open(id: string) {
    setBusy(true); setError(''); setAction(''); setSuccess('');
    try { setDetail(await api<Detail>('/admin/appointments/' + id)); requestAnimationFrame(() => detailHeading.current?.focus()); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !session || busy) return;
    const form = new FormData(event.currentTarget);
    const payload = { action, version: detail.version,
      ...(action === 'reschedule' ? { date: form.get('date'), time: form.get('time') } : {}),
      ...(action === 'cancel' ? { reason: form.get('reason') } : {}),
      ...(action === 'details' ? { joinUrl: form.get('joinUrl'), note: form.get('note') } : {}),
    };
    setBusy(true); setError(''); setSuccess('');
    try {
      setDetail(await api<Detail>(`/admin/appointments/${detail.id}/actions`, { method: 'POST', headers: { 'X-CSRF-Token': session.csrf }, body: JSON.stringify(payload) }));
      setAction(''); setRevision(r => r + 1); setSuccess(action === 'cancel' ? 'Appointment cancelled. A full refund is queued for processing.' : 'Appointment updated. Any required notifications are queued.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return <div className="admin-shell">
    <header className="admin-header"><a className="admin-brand" href="/">vedā<span>APPOINTMENT DESK</span></a>
      {session && <div><span>{session.email}</span><button disabled={busy} onClick={async () => {
        setBusy(true);
        try { await api('/admin/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrf } }); setSession(null); setListing(null); setDetail(null); }
        catch (e) { fail(e); } finally { setBusy(false); }
      }}>Sign out ↗</button></div>}
    </header>
    <main className="admin-main">
      {error && <div role="alert" className="admin-error">{error}</div>}
      {loadingSession ? <p role="status">Checking your session…</p> : !session ? <section className="admin-login">
        <span className="eyebrow">A LITTLE ORDER, BEHIND THE SCENES.</span><h1>Your consultation<br /><em>workspace.</em></h1>
        <p>Sign in to manage appointments and payment updates.</p>
        <form onSubmit={login}><label>Email<input name="email" type="email" required autoComplete="username" /></label>
          <label>Password<input name="password" type="password" required autoComplete="current-password" maxLength={128} /></label>
          <button className="admin-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in →'}</button></form>
        <p className="admin-muted">Access is limited to your administrator account.</p>
      </section> : detail ? <>
        <button className="admin-back" onClick={() => { setDetail(null); setAction(''); setSuccess(''); }}>← All appointments</button>
        <div className="admin-title"><div><span className="eyebrow">CONSULTATION DETAILS</span><h1 ref={detailHeading} tabIndex={-1}>{detail.name}</h1><p>{detail.service_name} · {when(detail.starts_at)} IST</p></div><button disabled={busy} onClick={() => open(detail.id)}>Refresh</button></div>
        {success && <p className="admin-success" role="status">{success}</p>}
        <div className="admin-detail-grid">
          <section className="admin-card"><h2>Appointment</h2><dl>
            <div><dt>Reference</dt><dd>{detail.id}</dd></div><div><dt>Email</dt><dd><a href={'mailto:' + detail.email}>{detail.email}</a></dd></div>
            <div><dt>Status</dt><dd><span className={'admin-badge ' + detail.status}>{label(detail.status)}</span></dd></div>
            <div><dt>Payment</dt><dd>{amount(detail.amount)} · {label(detail.payment_status)} · {detail.payment_mode.toUpperCase()}</dd></div><div><dt>Duration / language</dt><dd>{detail.duration} minutes · {detail.language === 'hi' ? 'Hindi' : 'English'}</dd></div>
            <div><dt>Payment ID</dt><dd>{detail.payment_id || 'Awaiting payment'}</dd></div><div><dt>Order ID</dt><dd>{detail.order_id || 'Not created'}</dd></div>
            {detail.refund_id && <div><dt>Refund ID</dt><dd>{detail.refund_id}</dd></div>}
          </dl></section>
          <section className="admin-card"><h2>Client details</h2><dl>
            {detail.details.dob && <><div><dt>Date of birth</dt><dd>{detail.details.dob}</dd></div><div><dt>Birth time</dt><dd>{detail.details.unknown ? 'Unknown' : detail.details.tob}</dd></div><div><dt>Birth place</dt><dd>{detail.details.place}</dd></div></>}
            <div><dt>Client question</dt><dd className="admin-preserve">{detail.details.notes || 'No question added.'}</dd></div>
            <div><dt>Private admin note</dt><dd className="admin-preserve">{detail.admin_note || 'No note added.'}</dd></div>
            <div><dt>Meeting link</dt><dd>{detail.join_url ? <a href={detail.join_url} target="_blank" rel="noreferrer">Open meeting ↗</a> : 'Not yet added'}</dd></div>
          </dl></section>
        </div>
        {detail.status === 'confirmed' && <section className="admin-card admin-actions"><h2>Manage this consultation</h2>
          <div className="admin-action-buttons">{[['details','Meeting link & notes'],['reschedule','Reschedule'],['completed','Mark completed'],['no_show','Mark no-show'],['cancel','Cancel & refund']].map(([value, text]) => <button aria-pressed={action === value} disabled={busy} key={value} onClick={() => { setAction(value); setError(''); setSuccess(''); }}>{text}</button>)}</div>
          {action && <form onSubmit={update} className="admin-action-form" key={action}>
            {action === 'details' && <><label>HTTPS meeting link<input name="joinUrl" type="url" pattern="https://.*" defaultValue={detail.join_url || ''} placeholder="https://meet.google.com/…" /></label><p className="admin-muted">A new meeting link sends an email to the client and your notification address.</p><label>Private note<textarea name="note" maxLength={2000} defaultValue={detail.admin_note} rows={3} /></label></>}
            {action === 'reschedule' && <><div className="admin-form-row"><label>New date (IST)<input name="date" type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} onInput={e => setRescheduleDate(e.currentTarget.value)} required /></label><label>Available time<select name="time" key={rescheduleDate} required disabled={loadingSlots || !slots.some(s => s.available)} defaultValue=""><option value="">{loadingSlots ? 'Loading…' : 'Choose time'}</option>{slots.filter(s => s.available).map(s => <option key={s.time}>{s.time}</option>)}</select></label></div><p>The client will receive the new date and time by email.</p></>}
            {action === 'cancel' && <><p className="admin-refund-warning">Cancel this appointment and request a full {amount(detail.amount)} refund to the original payment method. The slot becomes available immediately. Bank processing can take time.</p><label>Reason (stored in the audit log)<textarea name="reason" minLength={3} maxLength={500} required rows={3} /></label></>}
            {['completed','no_show'].includes(action) && <p>Mark this appointment as {label(action)}. This is available after the consultation has ended.</p>}
            <div className="admin-action-buttons"><button className="admin-primary" disabled={busy || (action === 'reschedule' && !slots.some(s => s.available))}>{busy ? 'Saving…' : action === 'cancel' ? 'Confirm cancellation & full refund' : 'Save change'}</button><button type="button" onClick={() => setAction('')}>Keep unchanged</button></div>
          </form>}
        </section>}
        <div className="admin-detail-grid"><section className="admin-card"><h2>Emails & refunds</h2><p className="admin-muted">Accepted means the email provider received the message. Delivery status updates in the background.</p>
          {detail.jobs.length ? detail.jobs.map(job => <div className="admin-log" key={job.id}><strong>{job.kind === 'email' ? 'Email to ' + job.recipient : 'Full refund'}</strong><span>{label(job.delivery_status || job.status)} · {job.attempts} attempt(s)</span>{job.error && <p className="admin-error">{job.error}</p>}</div>) : <p>No notifications yet.</p>}
        </section><section className="admin-card"><h2>Activity</h2>{detail.audit.length ? detail.audit.map((event, index) => <div className="admin-log" key={index}><strong>{label(event.action)}</strong><span>{when(event.created_at)} IST</span>{event.data.reason && <p>{event.data.reason}</p>}</div>) : <p>No activity yet.</p>}</section></div>
      </> : <>
        <div className="admin-title"><div><span className="eyebrow">YOUR DAY, AT A GLANCE</span><h1>Appointments.</h1><p>Every consultation, from first payment to final conversation.</p></div><button onClick={() => setRevision(r => r + 1)} disabled={busy}>Refresh ↻</button></div>
        <div className="admin-stats"><div><span>Upcoming confirmed</span><strong>{listing?.stats.upcoming ?? '—'}</strong></div><div><span>Refunds to monitor</span><strong>{listing?.stats.refunds ?? '—'}</strong></div><div><span>Jobs needing attention</span><strong>{listing?.stats.failed_jobs ?? '—'}</strong></div></div>
        <section className="admin-card"><form className="admin-filters" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); setPage(1); }}><label>Find a client<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, email or booking reference" maxLength={100} /></label><label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All appointments</option>{['confirmed','pending','cancelled','completed','no_show','expired'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></label><button type="submit">Search →</button></form>
          {busy && <p role="status">Loading appointments…</p>}
          {!busy && listing?.total === 0 && <div className="admin-empty"><h2>A little space in the calendar.</h2><p>No appointments match this view. Bookings will appear here when checkout begins.</p></div>}
          <div className="admin-table" role="table" aria-label="Appointments"><div className="admin-table-head" role="row"><span role="columnheader">Client</span><span role="columnheader">Consultation / IST</span><span role="columnheader">Status</span><span role="columnheader">Amount</span><span role="columnheader">Details</span></div>
            {listing?.appointments.map(a => <div className="admin-table-row" role="row" key={a.id}><div role="cell"><strong>{a.name}</strong><small>{a.email}</small></div><div role="cell"><strong>{a.service_name}</strong><small>{when(a.starts_at)} IST</small></div><div role="cell"><span className={'admin-badge ' + a.status}>{label(a.status)}</span><small>{label(a.payment_status)}</small></div><div role="cell">{amount(a.amount)}</div><div role="cell"><button disabled={busy} aria-label={'View appointment for ' + a.name} onClick={() => open(a.id)}>View ↗</button></div></div>)}
          </div>
          <div className="admin-pagination"><span>{listing?.total ?? 0} appointments · Page {page}</span><div><button disabled={busy || page === 1} onClick={() => setPage(p => p - 1)}>← Previous</button><button disabled={busy || page * 25 >= (listing?.total ?? 0)} onClick={() => setPage(p => p + 1)}>Next →</button></div></div>
        </section>
      </>}
    </main>
  </div>;
}
