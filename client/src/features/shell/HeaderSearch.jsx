import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import Avatar from '../../components/Avatar';
import { useChat } from '../chat/ChatContext';
import { useToast } from '../../components/Toast';
import useUserSearch from '../../hooks/useUserSearch';

// Top-bar quick finder: jumps to an existing chat or starts one with a person.
export default function HeaderSearch() {
  const { state, openDirect } = useChat();
  const toast = useToast();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const { results } = useUserSearch(query);

  const q = query.trim().toLowerCase();
  const chats = useMemo(() => (q ? Object.values(state.conversations)
    .filter((c) => c.title?.toLowerCase().includes(q) || c.other_user?.username?.toLowerCase().includes(q))
    .slice(0, 5) : []), [state.conversations, q]);
  const chatPartnerIds = new Set(Object.values(state.conversations).map((c) => c.other_user?.id).filter(Boolean));
  const people = results.filter((person) => !chatPartnerIds.has(person.id)).slice(0, 5);

  useEffect(() => {
    const close = (event) => { if (!box.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const finish = (path) => {
    setQuery('');
    setOpen(false);
    navigate(path);
  };

  const startChat = (person) => toast.run(async () => {
    const conversation = await openDirect(person.id);
    finish(`/chats/${conversation.id}`);
  });

  const showResults = open && q.length > 0;

  return (
    <div className="top-search" ref={box}>
      <Search size={16} />
      <input
        type="search"
        placeholder="Search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
        aria-label="Search chats and people"
      />
      {showResults && (
        <div className="top-search-results" role="listbox">
          {chats.length > 0 && <p className="list-heading">Chats</p>}
          {chats.map((c) => (
            <button key={c.id} type="button" className="top-search-row" onClick={() => finish(`/${c.type === 'group' ? 'groups' : 'chats'}/${c.id}`)}>
              <Avatar name={c.title} src={c.avatar_url} id={c.other_user?.id || c.id} size={28} square={c.type === 'group'} />
              <span>{c.title}</span>
            </button>
          ))}
          {people.length > 0 && <p className="list-heading">People</p>}
          {people.map((person) => (
            <button key={person.id} type="button" className="top-search-row" onClick={() => startChat(person)}>
              <Avatar name={person.display_name} src={person.avatar_url} id={person.id} size={28} />
              <span>{person.display_name} <small>@{person.username}</small></span>
            </button>
          ))}
          {!chats.length && !people.length && <p className="empty-note">{q.length < 2 ? 'Keep typing…' : 'No matches.'}</p>}
        </div>
      )}
    </div>
  );
}
