import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, ArrowDown, ArrowLeft, Ban, BellOff, Bell, Flag, LogOut, MoreVertical, PanelRight, Pin, PinOff, Search, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import Avatar from '../../components/Avatar';
import Menu from '../../components/Menu';
import MessageBubble from './MessageBubble';
import Composer from './Composer';
import Lightbox from './Lightbox';
import ReportModal from './ReportModal';
import { useChat } from './ChatContext';
import useConversationActions from './useConversationActions';
import { api, errorMessage } from '../../lib/api';
import { formatDayLabel, formatLastSeen, previewFor, sameDay, formatListTime } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';

const GROUP_GAP_MS = 5 * 60 * 1000;

export function headerStatus(conversation, state) {
  const typingNames = Object.values(state.typing[conversation.id] || {});
  if (typingNames.length) {
    if (conversation.type === 'direct') return { text: 'typing…', typing: true };
    return { text: typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.length} people are typing…`, typing: true };
  }
  if (conversation.type === 'group') return { text: `${conversation.member_count} member${conversation.member_count === 1 ? '' : 's'}` };
  const other = conversation.other_user;
  if (!other || other.blocked_me || other.blocked_by_me) return { text: '' };
  if (other.account_status && other.account_status !== 'active') return { text: 'Account unavailable' };
  if (state.online[other.id]) return { text: 'Online', online: true };
  return { text: formatLastSeen(other.last_seen_at) };
}

export default function ChatPanel({ conversation, infoOpen, onToggleInfo, onBack }) {
  const {
    state, getState, me, loadMessages, refreshConversation, send, retry, discard, editMessage, deleteMessage, toggleReaction, setPinned, typingStart, typingStop,
  } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const { setPrefs, toggleMute, toggleBlock, leaveGroup } = useConversationActions(conversation);
  const thread = state.messages[conversation.id];
  const pinned = state.pinned[conversation.id];
  const scroller = useRef(null);
  const content = useRef(null);
  const atBottom = useRef(true);
  const loadingOlder = useRef(false);
  const prevScrollHeight = useRef(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [report, setReport] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [unseen, setUnseen] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const [loadError, setLoadError] = useState('');

  const items = thread?.items || [];
  const lastItem = items[items.length - 1];
  const isGroup = conversation.type === 'group';
  const canManage = isGroup && ['owner', 'admin'].includes(conversation.member_role);
  const canPin = !isGroup || canManage;
  const status = headerStatus(conversation, state);
  const other = conversation.other_user;

  useEffect(() => {
    setLoadError('');
    loadMessages(conversation.id).catch((error) => setLoadError(errorMessage(error)));
    if (state.pinned[conversation.id] === undefined) refreshConversation(conversation.id);
  }, [conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const open = () => { setSearchOpen(true); };
    window.addEventListener('chattime:search-conversation', open);
    return () => window.removeEventListener('chattime:search-conversation', open);
  }, []);

  // Preserve position when older messages are prepended; otherwise follow new messages when at the bottom.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (prevScrollHeight.current !== null) {
      element.scrollTop += element.scrollHeight - prevScrollHeight.current;
      prevScrollHeight.current = null;
      loadingOlder.current = false;
      return;
    }
    if (atBottom.current || lastItem?.sender?.id === me.id) {
      element.scrollTop = element.scrollHeight;
      setUnseen(0);
    } else if (lastItem) {
      setUnseen((count) => count + 1);
    }
  }, [items.length, lastItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Images loading, the details panel opening or the window resizing all change the content height;
  // if the reader was at the newest message, keep them there.
  useEffect(() => {
    if (!content.current || !window.ResizeObserver) return undefined;
    const observer = new ResizeObserver(() => {
      if (atBottom.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    observer.observe(content.current);
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);

  const onScroll = async () => {
    const element = scroller.current;
    if (!element) return;
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    if (atBottom.current && unseen) setUnseen(0);
    if (element.scrollTop < 120 && thread?.hasMore && !loadingOlder.current) {
      loadingOlder.current = true;
      prevScrollHeight.current = element.scrollHeight;
      try {
        await loadMessages(conversation.id, { older: true });
      } catch (_error) {
        prevScrollHeight.current = null;
        loadingOlder.current = false;
      }
    }
  };

  const scrollToBottom = () => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
    setUnseen(0);
  };

  // Scrolls to a message, loading older pages until it is found.
  const jumpTo = useCallback(async (messageId) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const element = document.getElementById(`m-${messageId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightId(messageId);
        setTimeout(() => setHighlightId(null), 2000);
        return;
      }
      const current = getState().messages[conversation.id];
      if (!current?.hasMore) break;
      prevScrollHeight.current = scroller.current?.scrollHeight ?? null;
      loadingOlder.current = true;
      await loadMessages(conversation.id, { older: true });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    toast.info('That message is no longer available.');
  }, [getState, conversation.id, loadMessages, toast]);

  useEffect(() => {
    if (!searchOpen) { setSearchQuery(''); setSearchResults(null); return undefined; }
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults(null); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get(`/conversations/${conversation.id}/messages/search`, { params: { q } });
        setSearchResults(data.messages);
        setSearchIndex(0);
        if (data.messages[0]) jumpTo(data.messages[0].id);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen, conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepSearch = (direction) => {
    if (!searchResults?.length) return;
    const next = (searchIndex + direction + searchResults.length) % searchResults.length;
    setSearchIndex(next);
    jumpTo(searchResults[next].id);
  };

  const handlers = useMemo(() => ({
    onReply: (message) => { setEditing(null); setReplyTo(message); },
    onEdit: (message) => { setReplyTo(null); setEditing(message); },
    onDelete: async (message) => {
      if (await confirm({ title: 'Delete message?', message: 'This message will be deleted for everyone in the conversation.', confirmLabel: 'Delete', danger: true })) {
        await toast.run(() => deleteMessage(message));
      }
    },
    onPin: (message) => toast.run(() => setPinned(conversation.id, message.id), 'Message pinned.'),
    onReport: (message) => setReport({ type: 'message', id: message.id, label: `Message from ${message.sender.display_name}` }),
    onReact: (message, emoji) => toast.run(() => toggleReaction(message, emoji)),
    onRetry: retry,
    onDiscard: discard,
    onOpenImages: (images, index) => setLightbox({ images, index }),
    onJumpTo: jumpTo,
    onCopy: (message) => navigator.clipboard.writeText(message.body).then(() => toast.success('Copied.')).catch(() => {}),
  }), [conversation.id, jumpTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const editWindowMs = state.settings.message_edit_window_minutes * 60000;
  const canEdit = (message) => message.sender.id === me.id && typeof message.id === 'number' && !message.deleted_at
    && message.message_type !== 'audio' && message.message_type !== 'system'
    && editWindowMs > 0 && Date.now() - new Date(message.created_at).getTime() < editWindowMs;

  const blockedNotice = (() => {
    if (!other) return null;
    if (other.blocked_by_me) {
      return (
        <>
          You blocked {other.display_name}.
          <button type="button" className="link" onClick={toggleBlock}>Unblock</button>
        </>
      );
    }
    if (other.blocked_me) return <>You can't reply to this conversation.</>;
    if (other.account_status && other.account_status !== 'active') return <>This account is no longer available.</>;
    return null;
  })();

  const menuItems = [
    { label: 'Search in chat', icon: Search, onClick: () => setSearchOpen(true) },
    { label: conversation.is_muted ? 'Unmute notifications' : 'Mute notifications', icon: conversation.is_muted ? Bell : BellOff, onClick: toggleMute },
    conversation.is_pinned
      ? { label: 'Unpin chat', icon: PinOff, onClick: () => setPrefs({ is_pinned: false }) }
      : { label: 'Pin chat to top', icon: Pin, onClick: () => setPrefs({ is_pinned: true }, 'Pinned to the top of your list.') },
    conversation.is_archived
      ? { label: 'Unarchive', icon: ArchiveRestore, onClick: () => setPrefs({ is_archived: false }, 'Moved back to Chats.') }
      : { label: 'Archive chat', icon: Archive, onClick: () => { setPrefs({ is_archived: true }, 'Chat archived.'); onBack(); } },
    { label: other?.blocked_by_me ? 'Unblock' : 'Block', icon: Ban, onClick: toggleBlock, hidden: !other, danger: !other?.blocked_by_me },
    { label: 'Report', icon: Flag, danger: true, onClick: () => setReport(isGroup ? { type: 'conversation', id: conversation.id, label: conversation.title } : { type: 'user', id: other.id, label: other.display_name }), hidden: !isGroup && !other },
    { label: 'Leave group', icon: LogOut, danger: true, onClick: leaveGroup, hidden: !isGroup },
  ];

  return (
    <section className="card chat" aria-label={`Conversation with ${conversation.title}`}>
      <header className="chat-head">
        <button type="button" className="icon-btn chat-back" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
        <button type="button" className="chat-head-who" onClick={onToggleInfo}>
          <Avatar name={conversation.title} src={conversation.avatar_url} id={other?.id || conversation.id} size={36} square={isGroup} online={status.online} />
          <span className="chat-head-text">
            <strong>{conversation.title}</strong>
            <small className={status.typing ? 'status-live' : ''}>{status.text}</small>
          </span>
        </button>
        <div className="chat-head-actions">
          <button type="button" className={`icon-btn ${searchOpen ? 'active' : ''}`} onClick={() => setSearchOpen((open) => !open)} aria-label="Search in conversation" title="Search"><Search size={16} /></button>
          <button type="button" className={`icon-btn panel-toggle ${infoOpen ? 'active' : ''}`} onClick={onToggleInfo} aria-label="Toggle details panel" aria-pressed={infoOpen} title="Details"><PanelRight size={16} /></button>
          <Menu trigger={<MoreVertical size={16} />} items={menuItems} />
        </div>
      </header>

      {searchOpen && (
        <div className="chat-search">
          <Search size={18} />
          <input autoFocus placeholder="Search this conversation" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') stepSearch(event.shiftKey ? -1 : 1); if (event.key === 'Escape') setSearchOpen(false); }} />
          <span className="chat-search-count">
            {searchResults ? (searchResults.length ? `${searchIndex + 1} of ${searchResults.length}` : 'No results') : ''}
          </span>
          {/* Results come newest first, so "up" moves to older matches. */}
          <button type="button" className="icon-btn" onClick={() => stepSearch(1)} disabled={!searchResults?.length} aria-label="Older match"><ChevronUp size={18} /></button>
          <button type="button" className="icon-btn" onClick={() => stepSearch(-1)} disabled={!searchResults?.length} aria-label="Newer match"><ChevronDown size={18} /></button>
          <button type="button" className="icon-btn" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={18} /></button>
        </div>
      )}

      {pinned && (
        <div className="pinned-bar">
          <button type="button" className="pinned-main" onClick={() => jumpTo(pinned.id)}>
            <span className="pinned-icon"><Pin size={14} /></span>
            <span>
              <strong>Pinned message</strong>
              <span>{previewFor(pinned)}</span>
            </span>
          </button>
          {canPin && (
            <button type="button" className="icon-btn" onClick={() => toast.run(() => setPinned(conversation.id, null))} aria-label="Unpin message"><X size={20} /></button>
          )}
        </div>
      )}

      <div className="messages" ref={scroller} onScroll={onScroll}>
        <div ref={content}>
          {!thread?.loaded && !loadError && (
            <div className="messages-loading" aria-label="Loading messages">
              <div className="skeleton-bubble" /><div className="skeleton-bubble out" /><div className="skeleton-bubble" />
            </div>
          )}
          {loadError && (
            <div className="messages-error">
              {loadError}
              <button type="button" className="btn btn-outline btn-sm" onClick={() => { setLoadError(''); loadMessages(conversation.id).catch((error) => setLoadError(errorMessage(error))); }}>Try again</button>
            </div>
          )}
          {thread?.loaded && thread.hasMore && <div className="load-older">Loading earlier messages…</div>}
          {thread?.loaded && !thread.hasMore && (
            <div className="chat-start">
              <Avatar name={conversation.title} src={conversation.avatar_url} id={other?.id || conversation.id} size={56} square={isGroup} />
              <strong>{conversation.title}</strong>
              <p>{isGroup ? `Group created ${formatListTime(conversation.created_at)}` : `This is the beginning of your chat with ${conversation.title}.`}</p>
            </div>
          )}

          {items.map((message, index) => {
            const previous = items[index - 1];
            const next = items[index + 1];
            const newDay = !previous || !sameDay(previous.created_at, message.created_at);
            const joinsPrevious = previous && !newDay && previous.message_type !== 'system' && message.message_type !== 'system'
              && previous.sender.id === message.sender.id && new Date(message.created_at) - new Date(previous.created_at) < GROUP_GAP_MS;
            const joinsNext = next && sameDay(next.created_at, message.created_at) && next.message_type !== 'system' && message.message_type !== 'system'
              && next.sender.id === message.sender.id && new Date(next.created_at) - new Date(message.created_at) < GROUP_GAP_MS;
            const mine = message.sender.id === me.id;
            return (
              <Fragment key={message.client_message_id || message.id}>
                {newDay && <div className="day-sep"><span>{formatDayLabel(message.created_at)}</span></div>}
                <MessageBubble
                  message={message}
                  mine={mine}
                  me={me}
                  firstInRun={!joinsPrevious}
                  lastInRun={!joinsNext}
                  highlight={highlightId === message.id}
                  canPin={canPin}
                  canEdit={canEdit(message)}
                  {...handlers}
                />
              </Fragment>
            );
          })}
        </div>
      </div>

      {unseen > 0 && (
        <button type="button" className="jump-bottom" onClick={scrollToBottom}><ArrowDown size={16} />{unseen} new message{unseen === 1 ? '' : 's'}</button>
      )}

      <Composer
        key={conversation.id}
        conversation={conversation}
        settings={state.settings}
        replyTo={replyTo}
        editing={editing}
        blockedNotice={blockedNotice}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onSend={(payload) => {
          send(conversation.id, { ...payload, replyTo });
          setReplyTo(null);
          atBottom.current = true;
        }}
        onSaveEdit={(body) => {
          const target = editing;
          setEditing(null);
          if (body !== target.body) toast.run(() => editMessage(target, body));
        }}
        onTypingStart={() => typingStart(conversation.id)}
        onTypingStop={() => typingStop(conversation.id)}
      />

      {lightbox && <Lightbox items={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
      {report && <ReportModal target={report} onClose={() => setReport(null)} />}
    </section>
  );
}
