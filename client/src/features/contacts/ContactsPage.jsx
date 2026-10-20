import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Search, Star, UserMinus, UserPlus, X } from 'lucide-react';
import Avatar from '../../components/Avatar';
import { useChat } from '../chat/ChatContext';
import { api, errorMessage } from '../../lib/api';
import { formatLastSeen } from '../../lib/format';
import { useToast } from '../../components/Toast';
import useUserSearch from '../../hooks/useUserSearch';

export default function ContactsPage() {
  const { state, openDirect } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState(null);
  const [query, setQuery] = useState('');
  const { results, searching } = useUserSearch(query);

  const load = useCallback(() => {
    api.get('/contacts').then(({ data }) => setContacts(data.contacts)).catch((error) => { setContacts([]); toast.error(errorMessage(error)); });
  }, [toast]);
  useEffect(load, [load]);

  const contactIds = new Set((contacts || []).map((contact) => contact.id));

  // Each action returns a click handler.
  const run = (work, success) => () => toast.run(work, success);

  const message = (person) => run(async () => {
    const conversation = await openDirect(person.id);
    navigate(`/chats/${conversation.id}`);
  });

  const add = (person) => run(async () => {
    await api.post(`/contacts/${person.id}`);
    load();
  }, `${person.display_name} added to contacts.`);

  const remove = (person) => run(async () => {
    await api.delete(`/contacts/${person.id}`);
    load();
  }, `${person.display_name} removed.`);

  const favorite = (person) => run(async () => {
    await api.patch(`/contacts/${person.id}`, { is_favorite: !person.is_favorite });
    load();
  });

  const status = (person) => (state.online[person.id] ? 'Online' : formatLastSeen(person.last_seen_at));
  const favorites = (contacts || []).filter((contact) => contact.is_favorite);
  const others = (contacts || []).filter((contact) => !contact.is_favorite);

  const renderContact = (person) => (
    <li key={person.id} className="person-card">
      <Avatar name={person.display_name} src={person.avatar_url} id={person.id} size={52} online={Boolean(state.online[person.id])} />
      <div className="person-card-body">
        <strong>{person.nickname || person.display_name}</strong>
        <small>@{person.username} · <span className={state.online[person.id] ? 'status-live' : ''}>{status(person)}</span></small>
        {person.bio && <p>{person.bio}</p>}
      </div>
      <div className="person-card-actions">
        <button type="button" className={`icon-btn ${person.is_favorite ? 'star-on' : ''}`} onClick={favorite(person)} aria-label={person.is_favorite ? 'Remove from favourites' : 'Add to favourites'} title="Favourite">
          <Star size={19} fill={person.is_favorite ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="icon-btn" onClick={remove(person)} aria-label={`Remove ${person.display_name}`} title="Remove contact"><UserMinus size={19} /></button>
        <button type="button" className="btn btn-primary btn-sm" onClick={message(person)}><MessageSquare size={16} />Message</button>
      </div>
    </li>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Contacts</h1>
          <p>{contacts ? `${contacts.length} saved contact${contacts.length === 1 ? '' : 's'}` : 'Loading…'}</p>
        </div>
      </header>

      <div className="page-body">
        <section className="panel">
          <h2 className="panel-title">Find people</h2>
          <div className="search-box">
            <Search size={20} />
            <input type="search" placeholder="Search by name, @username or exact email" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find people" />
            {query && <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear"><X size={16} /></button>}
          </div>
          {query.trim().length >= 2 && (
            <ul className="person-list">
              {results.map((person) => (
                <li key={person.id} className="person-card">
                  <Avatar name={person.display_name} src={person.avatar_url} id={person.id} size={48} online={Boolean(state.online[person.id])} />
                  <div className="person-card-body">
                    <strong>{person.display_name}</strong>
                    <small>@{person.username}</small>
                  </div>
                  <div className="person-card-actions">
                    {contactIds.has(person.id)
                      ? <span className="tag">In contacts</span>
                      : <button type="button" className="btn btn-outline btn-sm" onClick={add(person)} disabled={person.blocked_by_me}><UserPlus size={16} />Add</button>}
                    <button type="button" className="btn btn-primary btn-sm" onClick={message(person)} disabled={person.blocked_by_me}><MessageSquare size={16} />Message</button>
                  </div>
                </li>
              ))}
              {!results.length && <li className="empty-note">{searching ? 'Searching…' : 'Nobody found.'}</li>}
            </ul>
          )}
        </section>

        {favorites.length > 0 && (
          <section className="panel">
            <h2 className="panel-title">Favourites</h2>
            <ul className="person-list">{favorites.map(renderContact)}</ul>
          </section>
        )}

        <section className="panel">
          <h2 className="panel-title">{favorites.length ? 'All contacts' : 'Your contacts'}</h2>
          {contacts && !contacts.length ? (
            <div className="empty-state">
              <UserPlus size={34} />
              <p>No contacts yet. Search for friends above and add them so they're easy to find.</p>
            </div>
          ) : (
            <ul className="person-list">{others.map(renderContact)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
