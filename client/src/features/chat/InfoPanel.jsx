import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ban, Bell, BellOff, Calendar, Camera, Crown, ExternalLink, FileText, Flag, Image as ImageIcon, Link2, LogOut, MoreVertical, Pencil, Pin, Play, Search,
  Shield, ShieldOff, UserMinus, UserPlus, X,
} from 'lucide-react';
import Avatar from '../../components/Avatar';
import Menu from '../../components/Menu';
import ReportModal from './ReportModal';
import Lightbox from './Lightbox';
import { AddMembersModal, EditGroupModal } from './GroupModals';
import { useChat } from './ChatContext';
import { headerStatus } from './ChatPanel';
import useConversationActions from './useConversationActions';
import { api, uploadFile } from '../../lib/api';
import { formatBytes, formatDate } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const SHARED_TITLES = { media: 'Shared media', files: 'Shared files', links: 'Shared links' };
const BIO_PREVIEW = 110;

// Second card, styled like the design's "Chat Schedule" list.
const SHARED_ORDER = ['files', 'media', 'links'];

function SharedCard({ conversationId, refreshKey }) {
  const [kind, setKind] = useState(SHARED_ORDER[0]);
  const [items, setItems] = useState(null);
  const [viewer, setViewer] = useState(null);
  // Until the reader picks a type, show the first one that has anything in it.
  const userPicked = useRef(false);

  useEffect(() => { userPicked.current = false; setKind(SHARED_ORDER[0]); }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    api.get(`/conversations/${conversationId}/shared`, { params: { kind } })
      .then(({ data }) => {
        if (cancelled) return;
        const next = SHARED_ORDER[SHARED_ORDER.indexOf(kind) + 1];
        if (!data.items.length && !userPicked.current && next) setKind(next);
        else setItems(data.items);
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [conversationId, kind, refreshKey]);

  const pick = (value) => () => { userPicked.current = true; setKind(value); };

  return (
    <section className="card info-card">
      <div className="info-card-head">
        <h3>{SHARED_TITLES[kind]}</h3>
        <Menu
          trigger={<MoreVertical size={16} />}
          label="Choose what to show"
          items={[
            { label: 'Files', icon: FileText, onClick: pick('files') },
            { label: 'Media', icon: ImageIcon, onClick: pick('media') },
            { label: 'Links', icon: Link2, onClick: pick('links') },
          ]}
        />
      </div>
      {items === null && <div className="shared-grid">{[0, 1, 2].map((i) => <span key={i} className="shared-tile skeleton" />)}</div>}
      {items?.length === 0 && <p className="shared-empty">Nothing shared yet.</p>}
      {items?.length > 0 && kind === 'media' && (
        <div className="shared-grid">
          {items.slice(0, 6).map((item, index) => (
            <button key={item.id} type="button" className="shared-tile" onClick={() => setViewer(index)} aria-label={`Open ${item.original_filename}`}>
              {item.kind === 'video' ? <><video src={item.url} preload="metadata" muted /><Play size={16} className="shared-play" /></> : <img src={item.url} alt="" loading="lazy" />}
              {index === 5 && items.length > 6 && <span className="shared-more">+{items.length - 6}</span>}
            </button>
          ))}
        </div>
      )}
      {items?.length > 0 && kind !== 'media' && (
        <ul className="shared-list">
          {items.slice(0, 8).map((item) => (
            <li key={item.id || `${item.message_id}-${item.url}`}>
              <a
                className="shared-item"
                href={kind === 'files' ? `${item.url}?download=1` : item.url}
                {...(kind === 'links' ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
              >
                <span className={`shared-icon shared-icon-${kind}`}>{kind === 'files' ? <FileText size={16} /> : <ExternalLink size={16} />}</span>
                <span className="shared-text">
                  <strong>{kind === 'files' ? item.original_filename : item.url.replace(/^https?:\/\//, '')}</strong>
                  <small><Calendar size={11} />{formatDate(item.created_at)}{kind === 'files' ? ` · ${formatBytes(item.size_bytes)}` : ''}</small>
                  <small>{item.sender_name}</small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {viewer !== null && <Lightbox items={items} index={viewer} onClose={() => setViewer(null)} />}
    </section>
  );
}

export default function InfoPanel({ conversation, onClose }) {
  const { state, me, refreshConversation } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const { toggleMute, toggleBlock, leaveGroup } = useConversationActions(conversation);
  const photoInput = useRef(null);
  const [members, setMembers] = useState([]);
  const [report, setReport] = useState(null);
  const [modal, setModal] = useState(null);
  const [profile, setProfile] = useState(null);
  const [bioOpen, setBioOpen] = useState(false);
  const isGroup = conversation.type === 'group';
  const other = conversation.other_user;
  const canManage = isGroup && ['owner', 'admin'].includes(conversation.member_role);
  const canInvite = canManage || (isGroup && conversation.allow_member_invites);
  const status = headerStatus(conversation, state);
  const pinned = state.pinned[conversation.id];
  const sharedKey = state.messages[conversation.id]?.items.length || 0;
  const about = (isGroup ? conversation.description : other?.bio) || '';

  const loadMembers = useCallback(() => {
    if (!isGroup) return;
    api.get(`/conversations/${conversation.id}/members`).then(({ data }) => setMembers(data.members)).catch(() => {});
  }, [conversation.id, isGroup]);

  useEffect(() => { loadMembers(); }, [loadMembers, conversation.member_count]);

  useEffect(() => {
    if (!other) return;
    api.get(`/users/${other.id}`).then(({ data }) => setProfile(data.user)).catch(() => {});
  }, [other?.id, other?.blocked_by_me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleContact() {
    await toast.run(async () => {
      await (profile.is_contact ? api.delete(`/contacts/${other.id}`) : api.post(`/contacts/${other.id}`));
      setProfile({ ...profile, is_contact: !profile.is_contact });
    }, profile.is_contact ? 'Removed from contacts.' : 'Added to contacts.');
  }

  async function changePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await toast.run(async () => {
      await uploadFile(`/conversations/${conversation.id}/avatar`, file);
      await refreshConversation(conversation.id);
    }, 'Group photo updated.');
  }

  async function copyInviteLink() {
    let link = '';
    const created = await toast.run(async () => {
      const { data } = await api.post(`/conversations/${conversation.id}/invites`, { expires_in_days: 7 });
      link = `${window.location.origin}/invite/${data.token}`;
    });
    if (!created) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invite link copied. It works for 7 days.');
    } catch (_error) {
      toast.info(`Share this link: ${link}`, { duration: 12000 });
    }
  }

  async function removeMember(member) {
    if (!(await confirm({ title: `Remove ${member.display_name}?`, message: 'They will stop receiving messages from this group.', confirmLabel: 'Remove', danger: true }))) return;
    await toast.run(async () => {
      await api.delete(`/conversations/${conversation.id}/members/${member.id}`);
      loadMembers();
    }, `${member.display_name} was removed.`);
  }

  const setRole = (member, role) => () => toast.run(async () => {
    await api.patch(`/conversations/${conversation.id}/members/${member.id}`, { role });
    loadMembers();
  }, role === 'admin' ? `${member.display_name} is now an admin.` : `${member.display_name} is no longer an admin.`);

  const openSearch = () => window.dispatchEvent(new CustomEvent('chattime:search-conversation'));
  const jumpPinned = () => {
    if (!pinned) return toast.info('No pinned message in this chat yet.');
    document.getElementById(`m-${pinned.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return undefined;
  };
  const openReport = () => setReport(isGroup
    ? { type: 'conversation', id: conversation.id, label: conversation.title }
    : { type: 'user', id: other.id, label: other.display_name });

  // The round icon buttons under the name, like the design's action row.
  const actions = [
    { label: conversation.is_muted ? 'Unmute' : 'Mute', icon: conversation.is_muted ? BellOff : Bell, onClick: toggleMute },
    { label: 'Search in chat', icon: Search, onClick: openSearch },
    { label: 'Pinned message', icon: Pin, onClick: jumpPinned },
    isGroup
      ? { label: 'Add members', icon: UserPlus, onClick: () => setModal('add'), hidden: !canInvite }
      : { label: profile?.is_contact ? 'Remove from contacts' : 'Add to contacts', icon: profile?.is_contact ? UserMinus : UserPlus, onClick: toggleContact, hidden: !profile || other?.blocked_by_me },
    isGroup
      ? { label: 'Leave group', icon: LogOut, onClick: leaveGroup }
      : { label: other?.blocked_by_me ? 'Unblock' : 'Block', icon: Ban, onClick: toggleBlock, hidden: !other },
    { label: 'Report', icon: Flag, onClick: openReport, danger: true, hidden: !isGroup && !other },
  ].filter((action) => !action.hidden);

  const details = isGroup
    ? [
      ['Members', conversation.member_count],
      ['Your role', ROLE_LABEL[conversation.member_role]],
      ['Who can add', conversation.allow_member_invites ? 'Everyone' : 'Admins only'],
      ['Created', formatDate(conversation.created_at)],
    ]
    : [
      ['Username', `@${other?.username}`],
      ['Status', status.online ? 'Online' : (status.text || '—')],
      ['In contacts', profile ? (profile.is_contact ? 'Yes' : 'No') : '—'],
      ['Groups in common', profile ? profile.shared_groups : '—'],
      ['Joined', profile ? formatDate(profile.created_at) : '—'],
    ];

  return (
    <aside className="info" aria-label="Conversation details">
      <section className="card info-profile">
        <button type="button" className="icon-btn info-close" onClick={onClose} aria-label="Close details"><X size={16} /></button>
        <div className="info-avatar">
          <Avatar name={conversation.title} src={conversation.avatar_url} id={other?.id || conversation.id} size={76} square={isGroup} ring />
          {canManage && (
            <>
              <button type="button" className="info-avatar-edit" onClick={() => photoInput.current?.click()} aria-label="Change group photo"><Camera size={12} /></button>
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={changePhoto} />
            </>
          )}
        </div>
        <h2>{conversation.title}</h2>
        <p className="info-sub">{isGroup ? `Group · ${conversation.member_count} members` : `@${other?.username}`}</p>

        <div className="info-actions">
          {actions.map(({ label, icon: Icon, onClick, danger }) => (
            <button key={label} type="button" className={`info-action ${danger ? 'danger' : ''}`} onClick={onClick} aria-label={label} title={label}>
              <Icon size={15} />
            </button>
          ))}
        </div>

        <p className="info-about">
          {about ? (bioOpen || about.length <= BIO_PREVIEW ? about : `${about.slice(0, BIO_PREVIEW).trim()}…`) : (isGroup ? 'No description yet.' : 'No bio yet.')}
          {about.length > BIO_PREVIEW && (
            <button type="button" className="link-btn" onClick={() => setBioOpen((open) => !open)}>{bioOpen ? 'Show less' : 'Read more'}</button>
          )}
          {canManage && <button type="button" className="link-btn" onClick={() => setModal('edit')}><Pencil size={11} />Edit</button>}
        </p>

        <dl className="info-details">
          {details.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </section>

      {isGroup && (
        <section className="card info-card">
          <div className="info-card-head">
            <h3>Members</h3>
            {canInvite && <button type="button" className="link-btn" onClick={copyInviteLink}><Link2 size={12} />Invite link</button>}
          </div>
          <ul className="member-list">
            {members.map((member) => {
              const isMe = member.id === me.id;
              const menu = [
                { label: 'Make admin', icon: Shield, onClick: setRole(member, 'admin'), hidden: conversation.member_role !== 'owner' || member.member_role !== 'member' },
                { label: 'Remove admin', icon: ShieldOff, onClick: setRole(member, 'member'), hidden: conversation.member_role !== 'owner' || member.member_role !== 'admin' },
                { label: 'Remove from group', icon: UserMinus, danger: true, onClick: () => removeMember(member), hidden: !canManage || member.member_role === 'owner' || (member.member_role === 'admin' && conversation.member_role !== 'owner') },
              ];
              return (
                <li key={member.id} className="member">
                  <Avatar name={member.display_name} src={member.avatar_url} id={member.id} size={32} online={Boolean(state.online[member.id]) || isMe} />
                  <span className="member-name">
                    <strong>{isMe ? 'You' : member.display_name}</strong>
                    <small>@{member.username}</small>
                  </span>
                  {member.member_role !== 'member' && (
                    <span className={`role-badge role-${member.member_role}`}>{member.member_role === 'owner' && <Crown size={10} />}{ROLE_LABEL[member.member_role]}</span>
                  )}
                  {!isMe && <Menu trigger={<MoreVertical size={14} />} items={menu} label={`Manage ${member.display_name}`} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <SharedCard conversationId={conversation.id} refreshKey={sharedKey} />

      {report && <ReportModal target={report} onClose={() => setReport(null)} />}
      {modal === 'add' && <AddMembersModal conversation={conversation} existingIds={members.map((m) => m.id)} onClose={() => setModal(null)} onAdded={() => { setModal(null); loadMembers(); }} />}
      {modal === 'edit' && <EditGroupModal conversation={conversation} onClose={() => setModal(null)} onSaved={() => { setModal(null); refreshConversation(conversation.id); }} />}
    </aside>
  );
}
