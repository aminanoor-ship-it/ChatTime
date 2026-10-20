import { useCallback, useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, BarChart3, ChevronLeft, ChevronRight, FileClock, Flag, HardDrive, LogOut, MessageSquare, Search,
  Settings, Shield, ShieldOff, Trash2, UserCheck, UserX, Users, Wifi,
} from 'lucide-react';
import Avatar from '../../components/Avatar';
import Menu from '../../components/Menu';
import { api, errorMessage } from '../../lib/api';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';

const TABS = [
  ['dashboard', 'Dashboard', BarChart3],
  ['users', 'Users', Users],
  ['reports', 'Reports', Flag],
  ['settings', 'Settings', Settings],
  ['audit', 'Audit log', FileClock],
];

const REASON_LABEL = {
  spam: 'Spam', harassment: 'Harassment', inappropriate_content: 'Inappropriate content', impersonation: 'Impersonation', other: 'Other',
};
const STATUS_LABEL = { open: 'Open', under_review: 'Under review', resolved: 'Resolved', dismissed: 'Dismissed' };

function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button>
      <span>Page {page} of {pages}</span>
      <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={18} /></button>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, note, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="stat-icon"><Icon size={20} /></span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

// Single-series bar chart: one brand hue, rounded data-ends on the baseline, hover tooltip per bar.
function DailyMessagesChart({ days }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...days.map((day) => day.total), 1);
  const peak = days.reduce((best, day, index) => (day.total > days[best].total ? index : best), 0);
  const label = (day) => new Date(`${day.day}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
  return (
    <figure className="bar-chart">
      <div className="bar-plot" onMouseLeave={() => setHover(null)}>
        <div className="bar-grid" aria-hidden="true"><i /><i /><i /></div>
        {days.map((day, index) => (
          <div
            key={day.day}
            className={`bar-col ${hover === index ? 'hover' : ''}`}
            onMouseEnter={() => setHover(index)}
            onFocus={() => setHover(index)}
            tabIndex={0}
            aria-label={`${label(day)}: ${day.total} messages`}
          >
            {index === peak && day.total > 0 && hover === null && <span className="bar-peak">{day.total}</span>}
            <span className="bar" style={{ height: `${(day.total / max) * 100}%` }} />
            {hover === index && (
              <span className={`bar-tip ${index > days.length - 4 ? 'left' : ''}`}>
                <strong>{day.total.toLocaleString()}</strong> messages<br /><small>{label(day)}</small>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="bar-axis" aria-hidden="true">
        <span>{label(days[0])}</span>
        <span>{label(days[Math.floor(days.length / 2)])}</span>
        <span>Today</span>
      </div>
      <table className="sr-only">
        <caption>Messages sent per day, last 14 days</caption>
        <tbody>{days.map((day) => <tr key={day.day}><th>{label(day)}</th><td>{day.total}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/admin/dashboard').then(({ data: result }) => setData(result)).catch((requestError) => setError(errorMessage(requestError)));
  }, []);
  if (error) return <p className="empty-note">{error}</p>;
  if (!data) return <p className="empty-note">Loading dashboard…</p>;
  const openReports = data.reports.open + data.reports.under_review;
  return (
    <>
      <div className="stats">
        <StatTile icon={Users} label="Users" value={data.users.total.toLocaleString()} note={`+${data.users.new_this_week} this week`} />
        <StatTile icon={Wifi} label="Online now" value={data.users.online_now} note={`${data.users.active} active accounts`} tone="stat-teal" />
        <StatTile icon={MessageSquare} label="Messages (24 h)" value={data.messages.last_24h.toLocaleString()} note={`${data.messages.total.toLocaleString()} all time`} />
        <StatTile icon={Flag} label="Open reports" value={openReports} note={openReports ? 'Needs review' : 'All clear'} tone={openReports ? 'stat-alert' : ''} />
      </div>
      <div className="admin-grid">
        <section className="panel">
          <h2 className="panel-title">Messages per day · last 14 days</h2>
          <DailyMessagesChart days={data.messages.daily} />
        </section>
        <section className="panel">
          <h2 className="panel-title">At a glance</h2>
          <ul className="glance">
            <li><Users size={17} /><span>Groups</span><strong>{data.conversations.groups}</strong></li>
            <li><MessageSquare size={17} /><span>Private chats</span><strong>{data.conversations.direct}</strong></li>
            <li><UserX size={17} /><span>Suspended users</span><strong>{data.users.suspended}</strong></li>
            <li><Shield size={17} /><span>Administrators</span><strong>{data.users.admins}</strong></li>
            <li><HardDrive size={17} /><span>Shared files</span><strong>{data.storage.files} · {formatBytes(data.storage.bytes)}</strong></li>
          </ul>
          <h3 className="panel-subtitle">Newest members</h3>
          <ul className="mini-list">
            {data.recent_users.map((user) => (
              <li key={user.id}>
                <Avatar name={user.display_name} src={user.avatar_url} id={user.id} size={34} />
                <span><strong>{user.display_name}</strong><small>@{user.username}</small></span>
                <time>{formatRelative(user.created_at)}</time>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function UsersTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [filters, setFilters] = useState({ q: '', status: '', role: '', page: 1 });
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/users', { params: filters }).then(({ data: result }) => setData(result)).catch((error) => toast.error(errorMessage(error)));
  }, [filters, toast]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const act = async (options, work) => {
    if (options && !(await confirm(options))) return;
    await toast.run(async () => {
      const { data: result } = await work();
      toast.success(result.message);
      load();
    });
  };

  return (
    <section className="panel panel-flush">
      <div className="filters">
        <div className="search-box">
          <Search size={18} />
          <input type="search" placeholder="Search name, username or email" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value, page: 1 })} aria-label="Search users" />
        </div>
        <select className="select" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value, page: 1 })} aria-label="Status">
          <option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </select>
        <select className="select" value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value, page: 1 })} aria-label="Role">
          <option value="">All roles</option><option value="user">Users</option><option value="admin">Admins</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>User</th><th>Status</th><th>Role</th><th>Joined</th><th>Last seen</th><th>Sessions</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {data?.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <span className="cell-user">
                    <Avatar name={user.display_name} src={user.avatar_url} id={user.id} size={36} online={user.online} />
                    <span><strong>{user.display_name}</strong><small>@{user.username} · {user.email}</small></span>
                  </span>
                </td>
                <td><span className={`tag tag-${user.account_status}`}>{user.account_status === 'active' ? 'Active' : 'Suspended'}</span>{user.reports_against > 0 && <span className="tag tag-alert" title="Reports about this user">{user.reports_against} report{user.reports_against === 1 ? '' : 's'}</span>}</td>
                <td>{user.role === 'admin' ? <span className="tag tag-primary">Admin</span> : 'User'}</td>
                <td>{formatDateTime(user.created_at)}</td>
                <td>{user.online ? <span className="status-live">Online</span> : formatRelative(user.last_seen_at) || '—'}</td>
                <td>{user.active_sessions}</td>
                <td>
                  <Menu
                    trigger={<Settings size={18} />}
                    label={`Manage ${user.display_name}`}
                    items={[
                      { label: 'Suspend account', icon: UserX, danger: true, hidden: user.account_status !== 'active' || user.role === 'admin',
                        onClick: () => act({ title: `Suspend ${user.display_name}?`, message: 'They will be signed out everywhere and cannot log in until reactivated.', confirmLabel: 'Suspend', danger: true }, () => api.patch(`/admin/users/${user.id}/status`, { status: 'suspended' })) },
                      { label: 'Reactivate account', icon: UserCheck, hidden: user.account_status === 'active',
                        onClick: () => act(null, () => api.patch(`/admin/users/${user.id}/status`, { status: 'active' })) },
                      { label: 'Sign out everywhere', icon: LogOut, hidden: !user.active_sessions,
                        onClick: () => act({ title: 'End all sessions?', message: `${user.display_name} will be signed out on every device.`, confirmLabel: 'Sign out' }, () => api.post(`/admin/users/${user.id}/revoke-sessions`)) },
                      { label: 'Make admin', icon: Shield, hidden: user.role === 'admin' || user.account_status !== 'active',
                        onClick: () => act({ title: `Make ${user.display_name} an admin?`, message: 'Admins can manage users, reports and settings.', confirmLabel: 'Make admin' }, () => api.patch(`/admin/users/${user.id}/role`, { role: 'admin' })) },
                      { label: 'Remove admin access', icon: ShieldOff, danger: true, hidden: user.role !== 'admin',
                        onClick: () => act({ title: 'Remove admin access?', message: `${user.display_name} will become a regular user.`, confirmLabel: 'Remove', danger: true }, () => api.patch(`/admin/users/${user.id}/role`, { role: 'user' })) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.users.length && <p className="empty-note">No users match these filters.</p>}
        {!data && <p className="empty-note">Loading…</p>}
      </div>
      {data && <Pager page={data.page} pages={data.pages} onPage={(page) => setFilters({ ...filters, page })} />}
    </section>
  );
}

function ReportsTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState({});

  const load = useCallback(() => {
    api.get('/admin/reports', { params: { status, page } }).then(({ data: result }) => setData(result)).catch((error) => toast.error(errorMessage(error)));
  }, [status, page, toast]);
  useEffect(load, [load]);

  const update = async (report, nextStatus) => {
    try {
      await api.patch(`/admin/reports/${report.id}`, { status: nextStatus, resolution_note: notes[report.id] ?? report.resolution_note ?? '' });
      toast.success(`Marked ${STATUS_LABEL[nextStatus].toLowerCase()}.`);
      load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeMessage = async (report) => {
    if (!(await confirm({ title: 'Remove this message?', message: 'It will be deleted for everyone in the conversation. This is recorded in the audit log.', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await api.post(`/admin/reports/${report.id}/remove-message`);
      await api.patch(`/admin/reports/${report.id}`, { status: 'resolved', resolution_note: notes[report.id] || 'Message removed by moderator.' });
      toast.success('Message removed and report resolved.');
      load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const suspend = async (report) => {
    const target = report.target;
    if (!(await confirm({ title: 'Suspend this account?', message: `${target.label} will be signed out and blocked from logging in.`, confirmLabel: 'Suspend', danger: true }))) return;
    try {
      await api.patch(`/admin/users/${target.user_id}/status`, { status: 'suspended', reason: `Report #${report.id}` });
      toast.success('Account suspended.');
      load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <div className="pills pills-inline" role="tablist">
        {['open', 'under_review', 'resolved', 'dismissed', ''].map((value) => (
          <button key={value || 'all'} type="button" role="tab" aria-selected={status === value} className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setPage(1); }}>
            {value ? STATUS_LABEL[value] : 'All'}
          </button>
        ))}
      </div>
      <p className="hint privacy-note"><Shield size={14} />Only the reported item is shown here — moderators can't browse private conversations.</p>
      {!data && <p className="empty-note">Loading…</p>}
      {data && !data.reports.length && (
        <div className="panel empty-state"><Flag size={32} /><p>No {status ? STATUS_LABEL[status].toLowerCase() : ''} reports.</p></div>
      )}
      <div className="report-list">
        {data?.reports.map((report) => (
          <article key={report.id} className="panel report">
            <header className="report-head">
              <span className={`tag tag-report-${report.status}`}>{STATUS_LABEL[report.status]}</span>
              <strong>{REASON_LABEL[report.reason]}</strong>
              <span className="report-meta">#{report.id} · reported by {report.reporter.display_name} (@{report.reporter.username}) · {formatRelative(report.created_at)}</span>
            </header>
            <div className="report-target">
              <span className="report-kind">{report.target_type}</span>
              <strong>{report.target?.label || 'Item no longer exists'}</strong>
              {report.target?.content && <blockquote>{report.target.content}</blockquote>}
              {report.target?.attachments?.length > 0 && <small>Attachments: {report.target.attachments.join(', ')}</small>}
              {report.target?.deleted && <small className="muted">This message has already been deleted.</small>}
              {report.target?.account_status === 'suspended' && <small className="muted">Account is suspended.</small>}
            </div>
            {report.details && <p className="report-details"><AlertTriangle size={15} />“{report.details}”</p>}
            <textarea
              className="textarea"
              rows={2}
              maxLength={1000}
              placeholder="Resolution note (visible to admins only)"
              value={notes[report.id] ?? report.resolution_note ?? ''}
              onChange={(event) => setNotes({ ...notes, [report.id]: event.target.value })}
            />
            <footer className="report-actions">
              {report.target?.kind === 'message' && !report.target.deleted && (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeMessage(report)}><Trash2 size={15} />Remove message</button>
              )}
              {report.target?.user_id && report.target.account_status === 'active' && report.target.role !== 'admin' && (
                <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => suspend(report)}><UserX size={15} />Suspend user</button>
              )}
              <span className="spacer" />
              {report.status === 'open' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(report, 'under_review')}>Start review</button>}
              {!['resolved', 'dismissed'].includes(report.status) && (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(report, 'dismissed')}>Dismiss</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => update(report, 'resolved')}>Resolve</button>
                </>
              )}
              {['resolved', 'dismissed'].includes(report.status) && (
                <span className="report-meta">Reviewed by {report.reviewer_name || '—'} · {formatDateTime(report.reviewed_at)}</span>
              )}
            </footer>
          </article>
        ))}
      </div>
      {data && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
    </>
  );
}

const CATEGORY_LABELS = { image: 'Images', document: 'Documents (PDF, Office, text, zip)', audio: 'Audio & voice messages', video: 'Video' };

function SettingsTab() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/admin/settings').then(({ data }) => setSettings(data.settings)).catch((error) => toast.error(errorMessage(error)));
  }, [toast]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch('/admin/settings', {
        ...settings,
        max_upload_mb: Number(settings.max_upload_mb),
        message_edit_window_minutes: Number(settings.message_edit_window_minutes),
        max_group_members: Number(settings.max_group_members),
      });
      setSettings(data.settings);
      toast.success(data.message);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p className="empty-note">Loading…</p>;
  const toggleCategory = (category) => setSettings({
    ...settings,
    allowed_file_categories: settings.allowed_file_categories.includes(category)
      ? settings.allowed_file_categories.filter((item) => item !== category)
      : [...settings.allowed_file_categories, category],
  });

  return (
    <form className="panel" onSubmit={save}>
      <h2 className="panel-title">Product settings</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="max-upload">Maximum upload size (MB)</label>
          <input id="max-upload" type="number" min={1} max={50} className="input" value={settings.max_upload_mb} onChange={(event) => setSettings({ ...settings, max_upload_mb: event.target.value })} />
          <span className="hint">1–50 MB per file.</span>
        </div>
        <div className="field">
          <label htmlFor="edit-window">Edit window (minutes)</label>
          <input id="edit-window" type="number" min={0} max={1440} className="input" value={settings.message_edit_window_minutes} onChange={(event) => setSettings({ ...settings, message_edit_window_minutes: event.target.value })} />
          <span className="hint">0 turns editing off.</span>
        </div>
        <div className="field">
          <label htmlFor="group-size">Maximum group size</label>
          <input id="group-size" type="number" min={3} max={1000} className="input" value={settings.max_group_members} onChange={(event) => setSettings({ ...settings, max_group_members: event.target.value })} />
        </div>
      </div>
      <fieldset className="check-group">
        <legend>Allowed file types</legend>
        {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
          <label key={category} className="checkbox">
            <input type="checkbox" checked={settings.allowed_file_categories.includes(category)} onChange={() => toggleCategory(category)} />
            <span className="checkbox-box" />{label}
          </label>
        ))}
      </fieldset>
      <label className="switch-row">
        <span><strong>Open registration</strong><small>When off, nobody new can create an account.</small></span>
        <input type="checkbox" className="switch" checked={settings.registration_open} onChange={(event) => setSettings({ ...settings, registration_open: event.target.checked })} />
      </label>
      <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  );
}

const ACTION_LABEL = {
  'user.suspend': 'Suspended account', 'user.reactivate': 'Reactivated account', 'user.role_change': 'Changed role',
  'user.revoke_sessions': 'Ended sessions', 'report.update': 'Updated report', 'message.moderator_delete': 'Removed message', 'settings.update': 'Changed settings',
};

function AuditTab() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/admin/audit-logs', { params: { page } }).then(({ data: result }) => setData(result)).catch((error) => toast.error(errorMessage(error)));
  }, [page, toast]);

  const describe = (log) => {
    const details = log.details || {};
    if (log.action === 'user.role_change') return `${details.from} → ${details.to}`;
    if (log.action === 'report.update') return `${STATUS_LABEL[details.from] || details.from} → ${STATUS_LABEL[details.to] || details.to}`;
    if (log.action === 'settings.update') return Object.keys(details).join(', ');
    if (log.action === 'user.revoke_sessions') return `${details.sessions} session(s)`;
    return details.reason || '';
  };

  return (
    <section className="panel panel-flush">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {data?.logs.map((log) => (
              <tr key={log.id}>
                <td>{formatDateTime(log.created_at)}</td>
                <td>{log.admin.display_name}</td>
                <td><Activity size={14} className="inline-icon" />{ACTION_LABEL[log.action] || log.action}</td>
                <td>{log.target_name || (log.target_type ? `${log.target_type} #${log.target_id ?? ''}` : '—')}</td>
                <td>{describe(log)}</td>
                <td className="muted">{log.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.logs.length && <p className="empty-note">No admin actions recorded yet.</p>}
      </div>
      {data && <Pager page={data.page} pages={data.pages} onPage={setPage} />}
    </section>
  );
}

export default function AdminPage() {
  const { tab = 'dashboard' } = useParams();
  const content = { dashboard: <Dashboard />, users: <UsersTab />, reports: <ReportsTab />, settings: <SettingsTab />, audit: <AuditTab /> }[tab] || <Dashboard />;
  return (
    <div className="page page-wide">
      <header className="page-head">
        <div><h1>Admin panel</h1><p>Manage accounts, moderation reports and product settings.</p></div>
      </header>
      <nav className="tabs" aria-label="Admin sections">
        {TABS.map(([key, label, Icon]) => (
          <NavLink key={key} to={`/admin/${key}`} className={() => `tab ${tab === key ? 'active' : ''}`}><Icon size={17} />{label}</NavLink>
        ))}
      </nav>
      <div className="page-body">{content}</div>
    </div>
  );
}
