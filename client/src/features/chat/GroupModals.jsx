import { useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import Modal from '../../components/Modal';
import Avatar from '../../components/Avatar';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { useChat } from './ChatContext';
import useUserSearch from '../../hooks/useUserSearch';

// Search people and pick several; shows contacts first when the search box is empty.
export function PeoplePicker({ selected, onChange, excludeIds = [], single = false, onPick }) {
  const { state } = useChat();
  const [query, setQuery] = useState('');
  const { results, searching } = useUserSearch(query);
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    api.get('/contacts').then(({ data }) => setContacts(data.contacts)).catch(() => {});
  }, []);

  const exclude = new Set(excludeIds);
  const list = (query.trim().length >= 2 ? results.filter((user) => !user.blocked_by_me) : contacts)
    .filter((person) => !exclude.has(person.id));
  const isSelected = (person) => selected.some((item) => item.id === person.id);

  const toggle = (person) => {
    if (single) return onPick(person);
    onChange(isSelected(person) ? selected.filter((item) => item.id !== person.id) : [...selected, person]);
    return undefined;
  };

  return (
    <div className="picker">
      {!single && selected.length > 0 && (
        <div className="picker-chips">
          {selected.map((person) => (
            <button key={person.id} type="button" className="picker-chip" onClick={() => toggle(person)}>
              <Avatar name={person.display_name} src={person.avatar_url} id={person.id} size={24} />
              {person.display_name.split(' ')[0]}
              <X size={14} />
            </button>
          ))}
        </div>
      )}
      <div className="search-box">
        <Search size={20} />
        <input type="search" placeholder="Search by name or @username" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search people" />
      </div>
      <p className="list-heading">{query.trim().length >= 2 ? 'RESULTS' : 'YOUR CONTACTS'}</p>
      <ul className="picker-list">
        {list.map((person) => (
          <li key={person.id}>
            <button type="button" className={`picker-row ${isSelected(person) ? 'selected' : ''}`} onClick={() => toggle(person)}>
              <Avatar name={person.display_name} src={person.avatar_url} id={person.id} size={42} online={Boolean(state.online[person.id])} />
              <span className="picker-name">
                <strong>{person.nickname || person.display_name}</strong>
                <small>@{person.username}</small>
              </span>
              {!single && <span className="picker-check">{isSelected(person) && <Check size={14} strokeWidth={3} />}</span>}
            </button>
          </li>
        ))}
      </ul>
      {!list.length && (
        <p className="picker-empty">
          {searching ? 'Searching…' : query.trim().length >= 2 ? 'Nobody found. Try their exact @username or email.' : 'Type at least 2 letters to find people.'}
        </p>
      )}
    </div>
  );
}

export function AddMembersModal({ conversation, existingIds, onClose, onAdded }) {
  const toast = useToast();
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const { data } = await api.post(`/conversations/${conversation.id}/members`, { user_ids: selected.map((person) => person.id) });
      toast.success(data.message);
      onAdded();
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add members"
      subtitle={conversation.title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!selected.length || busy} onClick={submit}>
            {busy ? 'Adding…' : `Add${selected.length ? ` ${selected.length}` : ''}`}
          </button>
        </>
      )}
    >
      <PeoplePicker selected={selected} onChange={setSelected} excludeIds={existingIds} />
    </Modal>
  );
}

export function EditGroupModal({ conversation, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: conversation.title,
    description: conversation.description || '',
    allow_member_invites: conversation.allow_member_invites,
  });
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const patch = {};
    if (form.name.trim() !== conversation.title) patch.name = form.name.trim();
    if (form.description.trim() !== (conversation.description || '')) patch.description = form.description.trim();
    if (form.allow_member_invites !== conversation.allow_member_invites) patch.allow_member_invites = form.allow_member_invites;
    if (!Object.keys(patch).length) return onClose();
    setBusy(true);
    try {
      await api.patch(`/conversations/${conversation.id}`, patch);
      toast.success('Group updated.');
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
    return undefined;
  }

  return (
    <Modal
      title="Edit group"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="edit-group" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <form id="edit-group" onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="group-name">Group name</label>
          <input id="group-name" className="input" maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="group-desc">Description</label>
          <textarea id="group-desc" className="textarea" rows={3} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </div>
        {conversation.member_role === 'owner' || conversation.member_role === 'admin' ? (
          <label className="switch-row">
            <span>
              <strong>Members can add people</strong>
              <small>Let everyone add members and share invite links.</small>
            </span>
            <input type="checkbox" className="switch" checked={form.allow_member_invites} onChange={(event) => setForm({ ...form, allow_member_invites: event.target.checked })} />
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
