import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, BellRing, CheckCheck, Heart, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
import Avatar from '../../components/Avatar';
import { useChat } from '../chat/ChatContext';
import { api, errorMessage } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { useToast } from '../../components/Toast';

const ICONS = { mention: AtSign, member_added: UserPlus, group_invite: UserPlus, message_reaction: Heart, security: ShieldAlert, system: Bell, message: Bell };

export default function NotificationsPage() {
  const { state, loadNotifications, markNotificationsRead } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const { items, unread, loaded } = state.notifications;

  useEffect(() => { loadNotifications().catch(() => {}); }, [loadNotifications]);

  async function open(notification) {
    if (!notification.read_at) markNotificationsRead(notification.id).catch(() => {});
    if (notification.conversation_id && state.conversations[notification.conversation_id]) navigate(`/chats/${notification.conversation_id}`);
  }

  async function clearRead() {
    try {
      await api.delete('/notifications');
      await loadNotifications();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function enableDesktop() {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') toast.success('Desktop notifications are on.');
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>{unread ? `${unread} unread` : 'You are all caught up'}</p>
        </div>
        <div className="page-head-actions">
          {items.some((item) => item.read_at) && <button type="button" className="btn btn-ghost btn-sm" onClick={clearRead}><Trash2 size={16} />Clear read</button>}
          {unread > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => markNotificationsRead().catch(() => {})}><CheckCheck size={16} />Mark all read</button>}
        </div>
      </header>

      <div className="page-body">
        {permission === 'default' && (
          <div className="banner">
            <BellRing size={22} />
            <span>Get a desktop alert when a message arrives while ChatTime is in the background.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={enableDesktop}>Turn on</button>
          </div>
        )}

        <section className="panel panel-flush">
          {!loaded && <p className="empty-note">Loading…</p>}
          {loaded && !items.length && (
            <div className="empty-state">
              <Bell size={34} />
              <p>No notifications yet. Mentions, reactions and group invites will show up here.</p>
            </div>
          )}
          <ul className="notif-list">
            {items.map((notification) => {
              const Icon = ICONS[notification.type] || Bell;
              return (
                <li key={notification.id}>
                  <button type="button" className={`notif ${notification.read_at ? '' : 'unread'}`} onClick={() => open(notification)}>
                    <span className="notif-avatar">
                      {notification.actor
                        ? <Avatar name={notification.actor.display_name} src={notification.actor.avatar_url} id={notification.actor.id} size={46} />
                        : <span className="notif-system"><Icon size={20} /></span>}
                      {notification.actor && <span className="notif-type"><Icon size={12} /></span>}
                    </span>
                    <span className="notif-body">
                      <strong>{notification.title}</strong>
                      {notification.body && <span>{notification.body}</span>}
                      <time>{formatRelative(notification.created_at)}</time>
                    </span>
                    {!notification.read_at && <i className="notif-dot" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
