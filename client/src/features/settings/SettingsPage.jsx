import { useEffect, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { Bell, Camera, Lock, Monitor, Shield, Trash2, User } from 'lucide-react';
import Avatar from '../../components/Avatar';
import PasswordStrength, { passwordIsValid } from '../../components/PasswordStrength';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../chat/ChatContext';
import { api, errorMessage, uploadFile } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';

const TABS = [
  ['profile', 'Profile', User],
  ['security', 'Security', Lock],
  ['notifications', 'Notifications', Bell],
  ['privacy', 'Privacy', Shield],
];

function ProfileTab() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef(null);
  const [form, setForm] = useState({ display_name: user.display_name, username: user.username, bio: user.bio, phone: user.phone });
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    const patch = Object.fromEntries(Object.entries(form).filter(([key, value]) => value.trim() !== (user[key] || '')).map(([key, value]) => [key, value.trim()]));
    if (!Object.keys(patch).length) return toast.info('No changes to save.');
    setBusy(true);
    try {
      const { data } = await api.patch('/users/me', patch);
      setUser(data.user);
      toast.success('Profile saved.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  async function changePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = await uploadFile('/users/me/avatar', file);
      setUser(data.user);
      toast.success('Photo updated.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function removePhoto() {
    if (!(await confirm({ title: 'Remove profile photo?', message: 'Your initials will be shown instead.', confirmLabel: 'Remove' }))) return;
    try {
      const { data } = await api.delete('/users/me/avatar');
      setUser(data.user);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const field = (key, label, props = {}) => (
    <div className="field">
      <label htmlFor={`profile-${key}`}>{label}</label>
      <input id={`profile-${key}`} className="input" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} {...props} />
    </div>
  );

  return (
    <section className="panel">
      <h2 className="panel-title">Profile</h2>
      <div className="profile-photo">
        <Avatar name={user.display_name} src={user.avatar_url} id={user.id} size={72} />
        <div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => input.current?.click()}><Camera size={16} />Change photo</button>
          {user.avatar_url && <button type="button" className="btn btn-ghost btn-sm" onClick={removePhoto}><Trash2 size={16} />Remove</button>}
          <p className="hint">JPG, PNG, GIF or WebP, up to 5 MB.</p>
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={changePhoto} />
      </div>
      <form onSubmit={save} className="form-grid">
        {field('display_name', 'Full name', { maxLength: 80 })}
        {field('username', 'Username', { maxLength: 30 })}
        <div className="field">
          <label htmlFor="profile-email">Email</label>
          <input id="profile-email" className="input" value={user.email} disabled />
        </div>
        {field('phone', 'Phone (optional)', { type: 'tel', maxLength: 25 })}
        <div className="field field-full">
          <label htmlFor="profile-bio">About</label>
          <textarea id="profile-bio" className="textarea" rows={3} maxLength={300} placeholder="A line or two about you" value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} />
          <span className="hint">{form.bio.length}/300</span>
        </div>
        <div className="field-full form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </section>
  );
}

function SecurityTab() {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState([]);

  const loadSessions = () => api.get('/users/me/sessions').then(({ data }) => setSessions(data.sessions)).catch(() => {});
  useEffect(() => { loadSessions(); }, []);

  async function changePassword(event) {
    event.preventDefault();
    if (!passwordIsValid(form.new_password)) return toast.error('Meet all four password requirements.');
    if (form.new_password !== form.confirm) return toast.error('New passwords do not match.');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/change-password', { current_password: form.current_password, new_password: form.new_password });
      toast.success(data.message);
      setForm({ current_password: '', new_password: '', confirm: '' });
      loadSessions();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  async function endSession(session) {
    if (!(await confirm({ title: 'Sign out this device?', message: `${session.device_name || 'This device'} will need to log in again.`, confirmLabel: 'Sign out', danger: true }))) return;
    try {
      await api.delete(`/users/me/sessions/${session.id}`);
      loadSessions();
      toast.success('Device signed out.');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">Change password</h2>
        <form onSubmit={changePassword} className="stack narrow">
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <input id="current-password" type="password" className="input" autoComplete="current-password" value={form.current_password} onChange={(event) => setForm({ ...form, current_password: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" className="input" autoComplete="new-password" value={form.new_password} onChange={(event) => setForm({ ...form, new_password: event.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" type="password" className="input" autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} />
          </div>
          <PasswordStrength value={form.new_password} />
          <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={busy || !form.current_password}>{busy ? 'Saving…' : 'Update password'}</button></div>
        </form>
      </section>

      <section className="panel">
        <h2 className="panel-title">Where you're signed in</h2>
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id} className="session">
              <span className="session-icon"><Monitor size={20} /></span>
              <span className="session-body">
                <strong>{session.device_name || 'Unknown device'} {session.current && <span className="tag tag-blue">This device</span>}</strong>
                <small>Active {formatRelative(session.last_active_at || session.created_at)} · Signed in {formatDateTime(session.created_at)}{session.ip_address ? ` · ${session.ip_address}` : ''}</small>
              </span>
              {!session.current && <button type="button" className="btn btn-ghost btn-sm" onClick={() => endSession(session)}>Sign out</button>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function NotificationsTab() {
  const toast = useToast();
  const { setNotificationPrefs } = useChat();
  const [prefs, setPrefs] = useState(null);
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));

  useEffect(() => {
    api.get('/users/me/notification-preferences').then(({ data }) => setPrefs(data.preferences)).catch(() => {});
  }, []);

  async function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      const { data } = await api.patch('/users/me/notification-preferences', { [key]: next[key] });
      setPrefs(data.preferences);
      setNotificationPrefs(data.preferences);
      if (key === 'desktop_enabled' && next[key] && permission === 'default') setPermission(await Notification.requestPermission());
    } catch (error) {
      setPrefs(prefs);
      toast.error(errorMessage(error));
    }
  }

  if (!prefs) return <section className="panel"><p className="empty-note">Loading…</p></section>;

  return (
    <section className="panel">
      <h2 className="panel-title">Notifications</h2>
      <label className="switch-row">
        <span>
          <strong>Desktop notifications</strong>
          <small>
            {permission === 'denied' ? 'Blocked in your browser settings — allow notifications for this site to use this.'
              : permission === 'unsupported' ? 'Not supported in this browser.'
                : 'Show an alert when a message arrives while ChatTime is in the background.'}
          </small>
        </span>
        <input type="checkbox" className="switch" checked={prefs.desktop_enabled} onChange={() => toggle('desktop_enabled')} />
      </label>
      <label className="switch-row">
        <span><strong>Message sound</strong><small>Play a soft sound for new messages in other chats.</small></span>
        <input type="checkbox" className="switch" checked={prefs.sound_enabled} onChange={() => toggle('sound_enabled')} />
      </label>
      <label className="switch-row">
        <span><strong>Email summaries</strong><small>Saved for when an email service is connected.</small></span>
        <input type="checkbox" className="switch" checked={prefs.email_enabled} onChange={() => toggle('email_enabled')} />
      </label>
      <p className="hint">Muted chats never play sounds or show desktop alerts.</p>
    </section>
  );
}

function PrivacyTab() {
  const toast = useToast();
  const { loadConversations } = useChat();
  const [blocked, setBlocked] = useState(null);
  const load = () => api.get('/blocks').then(({ data }) => setBlocked(data.blocked)).catch(() => setBlocked([]));
  useEffect(() => { load(); }, []);

  async function unblock(person) {
    try {
      await api.delete(`/blocks/${person.id}`);
      toast.success(`${person.display_name} is unblocked.`);
      load();
      loadConversations();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Blocked people</h2>
      <p className="hint">Blocked people can't message you, start a chat with you or add you to groups. Your past messages stay visible.</p>
      {blocked && !blocked.length && <p className="empty-note">You haven't blocked anyone.</p>}
      <ul className="person-list">
        {(blocked || []).map((person) => (
          <li key={person.id} className="person-card">
            <Avatar name={person.display_name} src={person.avatar_url} id={person.id} size={44} />
            <div className="person-card-body"><strong>{person.display_name}</strong><small>@{person.username}</small></div>
            <div className="person-card-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => unblock(person)}>Unblock</button></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SettingsPage() {
  const { tab = 'profile' } = useParams();
  const content = { profile: <ProfileTab />, security: <SecurityTab />, notifications: <NotificationsTab />, privacy: <PrivacyTab /> }[tab] || <ProfileTab />;
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Settings</h1><p>Manage your profile, security and preferences.</p></div>
      </header>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map(([key, label, Icon]) => (
          <NavLink key={key} to={`/settings/${key}`} className={() => `tab ${tab === key ? 'active' : ''}`}><Icon size={17} />{label}</NavLink>
        ))}
      </nav>
      <div className="page-body">{content}</div>
    </div>
  );
}
