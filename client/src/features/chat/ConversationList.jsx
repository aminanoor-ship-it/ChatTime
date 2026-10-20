import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive, Check, CheckCheck, Mail, MessagesSquare, Mic, Pin, Search, SquarePen, UserPlus, Users, VolumeX, X,
} from 'lucide-react';
import Avatar from '../../components/Avatar';
import { useChat, sortConversations } from './ChatContext';
import { formatListTime, formatRelative } from '../../lib/format';
import { useToast } from '../../components/Toast';
import useUserSearch from '../../hooks/useUserSearch';

const TABS = [['all', 'Chats', MessagesSquare], ['unread', 'Unread', Mail], ['groups', 'Groups', Users]];
const SECTION_TITLES = { groups: ['Groups', Users], archived: ['Archived', Archive] };

function StatusTicks({ status }) {
  if (status === 'sent') return <Check size={13} className="ticks" />;
  return <CheckCheck size={13} className={`ticks ${status === 'read' ? 'ticks-read' : ''}`} />;
}

function ConversationRow({ conversation, active, to, me, online, typingNames }) {
  const last = conversation.last_message;
  const mine = last && last.sender_id === me.id && last.message_type !== 'system';
  const showSender = conversation.type === 'group' && last && !mine && last.message_type !== 'system';
  const unread = conversation.unread_count > 0;
  return (
    <Link to={to} className={`convo ${active ? 'active' : ''} ${unread ? 'unread' : ''}`} aria-current={active ? 'page' : undefined}>
      <Avatar name={conversation.title} src={conversation.avatar_url} id={conversation.other_user?.id || conversation.id} size={36} square={conversation.type === 'group'} online={online} />
      <div className="convo-body">
        <strong className="convo-title">{conversation.title}</strong>
        <span className="convo-preview">
          {typingNames.length > 0 ? (
            <em className="typing-text">{conversation.type === 'group' ? `${typingNames[0]} is typing…` : 'Typing…'}</em>
          ) : (
            <>
              {mine && <StatusTicks status={last.status} />}
              {last?.message_type === 'audio' && <Mic size={12} className="convo-preview-icon" />}
              {showSender && <b>{last.sender_name.split(' ')[0]}: </b>}
              {conversation.last_message_preview || (conversation.type === 'group' ? 'Group created' : 'Say hello 👋')}
            </>
          )}
        </span>
      </div>
      <div className="convo-side">
        <time>{formatListTime(conversation.last_message_at || conversation.created_at)}</time>
        {unread
          ? <span className={`convo-badge ${conversation.is_muted ? 'muted' : ''}`}>{conversation.unread_count}</span>
          : conversation.is_muted && <VolumeX size={13} className="convo-muted" aria-label="Muted" />}
      </div>
    </Link>
  );
}

export default function ConversationList({ section, activeId, basePath, onCompose }) {
  const { state, me, openDirect } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');

  const all = useMemo(() => Object.values(state.conversations), [state.conversations]);

  const list = useMemo(() => {
    let items = all.filter((c) => (section === 'archived' ? c.is_archived : !c.is_archived));
    if (section === 'groups' || (section === 'chats' && tab === 'groups')) items = items.filter((c) => c.type === 'group');
    if (section === 'chats' && tab === 'unread') items = items.filter((c) => c.unread_count > 0);
    const q = query.trim().toLowerCase();
    if (q) {
      items = items.filter((c) => c.title?.toLowerCase().includes(q)
        || c.other_user?.username?.toLowerCase().includes(q)
        || c.last_message_preview?.toLowerCase().includes(q));
    }
    return sortConversations(items);
  }, [all, section, tab, query]);

  // The most recent conversation still waiting for a reply, highlighted above the list.
  const waiting = useMemo(() => (section === 'chats' && !query
    ? sortConversations(all.filter((c) => !c.is_archived && c.unread_count > 0 && c.id !== activeId && c.last_message))[0]
    : null), [all, section, query, activeId]);

  const { results } = useUserSearch(query, { enabled: section !== 'archived' });
  const people = useMemo(() => {
    const existing = new Set(all.filter((c) => c.other_user).map((c) => c.other_user.id));
    return results.filter((person) => !existing.has(person.id)).slice(0, 5);
  }, [results, all]);

  const startChat = (person) => toast.run(async () => {
    const conversation = await openDirect(person.id);
    setQuery('');
    navigate(`/chats/${conversation.id}`);
  });

  const pinned = list.filter((c) => c.is_pinned);
  const rest = list.filter((c) => !c.is_pinned);
  const [sectionTitle, SectionIcon] = SECTION_TITLES[section] || [];

  const renderRow = (conversation) => (
    <ConversationRow
      key={conversation.id}
      conversation={conversation}
      active={conversation.id === activeId}
      to={`${basePath}/${conversation.id}`}
      me={me}
      online={Boolean(conversation.other_user && state.online[conversation.other_user.id])}
      typingNames={Object.values(state.typing[conversation.id] || {})}
    />
  );

  return (
    <section className="card convo-list" aria-label={sectionTitle || 'Chats'}>
      {section === 'chats' ? (
        <div className="pills" role="tablist">
          {TABS.map(([value, label, Icon]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>
      ) : (
        <div className="pills"><button type="button" className="active"><SectionIcon size={15} />{sectionTitle}</button></div>
      )}

      <div className="convo-tools">
        <div className="search-box">
          <input type="search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search chats" />
          {query
            ? <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>
            : <Search size={16} />}
        </div>
        {section !== 'archived' && (
          <button type="button" className="compose-btn" onClick={() => onCompose(section === 'groups' ? 'group' : 'direct')} aria-label={section === 'groups' ? 'New group' : 'New chat'} title={section === 'groups' ? 'New group' : 'New chat'}>
            <SquarePen size={16} />
          </button>
        )}
      </div>

      {waiting && (
        <div className="waiting-card">
          <div className="waiting-head">
            <Avatar name={waiting.title} src={waiting.avatar_url} id={waiting.other_user?.id || waiting.id} size={36} square={waiting.type === 'group'} />
            <div>
              <strong>{waiting.title}</strong>
              <p>{waiting.type === 'group' ? `${waiting.last_message.sender_name.split(' ')[0]} wrote` : 'Sent you a message'} {formatRelative(waiting.last_message_at)} and is waiting for your reply.</p>
            </div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`${basePath}/${waiting.id}`)}>Reply Now</button>
        </div>
      )}

      <div className="convo-scroll">
        {!state.conversationsLoaded && (
          <div aria-label="Loading conversations">
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton-row"><span /><div><i /><i /></div></div>)}
          </div>
        )}

        {pinned.length > 0 && <p className="list-heading"><Pin size={11} /> Pinned</p>}
        {pinned.map(renderRow)}
        {pinned.length > 0 && rest.length > 0 && <p className="list-heading">All messages</p>}
        {rest.map(renderRow)}

        {people.length > 0 && (
          <>
            <p className="list-heading">People</p>
            {people.map((person) => (
              <button key={person.id} type="button" className="convo" onClick={() => startChat(person)}>
                <Avatar name={person.display_name} src={person.avatar_url} id={person.id} size={36} online={Boolean(state.online[person.id])} />
                <div className="convo-body">
                  <strong className="convo-title">{person.display_name}</strong>
                  <span className="convo-preview">@{person.username}</span>
                </div>
                <UserPlus size={16} className="convo-muted" />
              </button>
            ))}
          </>
        )}

        {state.conversationsLoaded && !list.length && !people.length && (
          <div className="list-empty">
            {query ? <p>No chats match “{query}”.</p>
              : section === 'archived' ? <p>No archived chats.</p>
                : tab === 'unread' ? <p>You're all caught up 🎉</p>
                  : (
                    <>
                      <p>{section === 'groups' || tab === 'groups' ? 'You are not in any groups yet.' : 'No conversations yet.'}</p>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => onCompose(section === 'groups' || tab === 'groups' ? 'group' : 'direct')}>
                        {section === 'groups' || tab === 'groups' ? 'Create a group' : 'Start a chat'}
                      </button>
                    </>
                  )}
          </div>
        )}
      </div>
    </section>
  );
}
