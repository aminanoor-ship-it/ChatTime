import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Archive, Bell, ChevronDown, Link2, LogOut, Menu as MenuIcon, MessageSquareText, MessagesSquare, Settings, Shield, User, UserRound, Users, WifiOff, X,
} from 'lucide-react';
import { Logo } from '../../components/Logo';
import Avatar from '../../components/Avatar';
import Menu from '../../components/Menu';
import HeaderSearch from './HeaderSearch';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../chat/ChatContext';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';

function NavItem({ to, icon: Icon, label, badge, dot, active }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${(active ?? isActive) ? 'active' : ''}`}>
      <Icon size={18} />
      <span className="nav-label">{label}</span>
      {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
      {!badge && dot && <span className="nav-dot" aria-label="New activity" />}
    </NavLink>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { state } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const conversations = Object.values(state.conversations);
  const unreadChats = conversations.filter((c) => !c.is_archived && c.unread_count > 0).length;
  const groupActivity = conversations.some((c) => c.type === 'group' && !c.is_archived && c.unread_count > 0);
  const archivedActivity = conversations.some((c) => c.is_archived && c.unread_count > 0);
  const onProfile = pathname === '/settings' || pathname === '/settings/profile';

  useEffect(() => setDrawerOpen(false), [pathname]);

  // Desktop notification clicks ask the app to open a conversation.
  useEffect(() => {
    const open = (event) => navigate(`/chats/${event.detail}`);
    window.addEventListener('chattime:open-conversation', open);
    return () => window.removeEventListener('chattime:open-conversation', open);
  }, [navigate]);

  useEffect(() => {
    const total = conversations.reduce((sum, c) => sum + (c.is_muted ? 0 : c.unread_count), 0);
    document.title = total ? `(${total}) ChatTime` : 'ChatTime';
  }, [conversations]);

  async function copyInvite() {
    const link = `${window.location.origin}/register`;
    try {
      await navigator.clipboard.writeText(`Join me on ChatTime! Sign up here and find me as @${user.username}: ${link}`);
      toast.success('Invite link copied — share it with your friends.');
    } catch (_error) {
      toast.info(`Share this link: ${link}`);
    }
  }

  async function signOut() {
    if (await confirm({ title: 'Log out?', message: 'You will need to log in again to see your conversations on this device.', confirmLabel: 'Log out' })) {
      await logout();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-btn topbar-menu" onClick={() => setDrawerOpen(true)} aria-label="Open menu"><MenuIcon size={20} /></button>
        <Link to="/chats" className="topbar-brand" aria-label="ChatTime home"><Logo size={30} /></Link>
        <HeaderSearch />
        <div className="topbar-actions">
          <Link to="/chats" className="round-btn" aria-label="Chats" title="Chats">
            <MessageSquareText size={16} />
            {unreadChats > 0 && <i className="red-dot" />}
          </Link>
          <Link to="/notifications" className="round-btn" aria-label="Notifications" title="Notifications">
            <Bell size={16} />
            {state.notifications.unread > 0 && <i className="red-dot" />}
          </Link>
          <Menu
            buttonClassName="user-chip"
            label="Account menu"
            trigger={(
              <>
                <Avatar name={user.display_name} src={user.avatar_url} id={user.id} size={32} online={state.connected} />
                <span className="user-chip-text">
                  <strong>{user.display_name}</strong>
                  <small>{user.role === 'admin' ? 'Administrator' : `@${user.username}`}</small>
                </span>
                <ChevronDown size={16} className="user-chip-caret" />
              </>
            )}
            items={[
              { label: 'My profile', icon: UserRound, onClick: () => navigate('/settings/profile') },
              { label: 'Copy invite link', icon: Link2, onClick: copyInvite },
              { label: 'Log out', icon: LogOut, onClick: signOut, danger: true },
            ]}
          />
        </div>
      </header>

      <div className="app-body">
        {drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
        <aside className={`sidebar ${drawerOpen ? 'open' : ''}`} aria-label="Main navigation">
          <button type="button" className="icon-btn sidebar-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu"><X size={18} /></button>
          <p className="sidebar-heading">Menu</p>
          <NavItem to="/chats" icon={MessagesSquare} label="Chats" badge={unreadChats} />
          <NavItem to="/groups" icon={Users} label="Groups" dot={groupActivity} />
          <NavItem to="/contacts" icon={User} label="Contacts" />
          <NavItem to="/archived" icon={Archive} label="Archived" dot={archivedActivity} />

          <p className="sidebar-heading">Account</p>
          <NavItem to="/settings/profile" icon={UserRound} label="Profile" active={onProfile} />
          <NavItem to="/notifications" icon={Bell} label="Notification" badge={state.notifications.unread} />
          <NavItem to="/settings/security" icon={Settings} label="Settings" active={pathname.startsWith('/settings') && !onProfile} />
          {user.role === 'admin' && <NavItem to="/admin" icon={Shield} label="Admin panel" />}
        </aside>

        <main className="app-main">
          {!state.connected && (
            <div className="offline-banner" role="status"><WifiOff size={14} />Reconnecting… messages will send when you're back online.</div>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
