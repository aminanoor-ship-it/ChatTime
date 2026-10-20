import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ConversationList from './ConversationList';
import ChatPanel from './ChatPanel';
import InfoPanel from './InfoPanel';
import NewConversationModal from './NewConversationModal';
import { useChat } from './ChatContext';
import { MessageSquare, Plus, Users } from 'lucide-react';
import { LogoMark } from '../../components/Logo';

const INFO_KEY = 'chattime.infoPanel';

function readInfoPreference() {
  try {
    return localStorage.getItem(INFO_KEY) !== 'closed';
  } catch (_error) {
    return true;
  }
}

export default function ChatsView({ section }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { state, setActive } = useChat();
  const activeId = conversationId ? Number(conversationId) : null;
  const conversation = activeId ? state.conversations[activeId] : null;
  // At 1360px and below the details panel overlays the chat (see chat.css), so it starts closed there.
  const [infoOpen, setInfoOpen] = useState(() => readInfoPreference() && window.innerWidth > 1360);
  const [composer, setComposer] = useState(null);

  useEffect(() => {
    setActive(conversation ? activeId : null);
    return () => setActive(null);
  }, [activeId, conversation?.id, setActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // The URL points at a conversation we are no longer part of.
  useEffect(() => {
    if (activeId && state.conversationsLoaded && !state.conversations[activeId]) navigate(`/${section}`, { replace: true });
  }, [activeId, state.conversationsLoaded, state.conversations, navigate, section]);

  const toggleInfo = () => {
    setInfoOpen((open) => {
      try { localStorage.setItem(INFO_KEY, open ? 'closed' : 'open'); } catch (_error) { /* optional */ }
      return !open;
    });
  };

  const basePath = section === 'archived' ? '/archived' : section === 'groups' ? '/groups' : '/chats';

  return (
    <div className={`chats ${activeId ? 'has-active' : ''} ${infoOpen && conversation ? 'info-open' : ''}`}>
      <ConversationList section={section} activeId={activeId} basePath={basePath} onCompose={(mode) => setComposer(mode)} />

      {conversation ? (
        <ChatPanel
          key={conversation.id}
          conversation={conversation}
          infoOpen={infoOpen}
          onToggleInfo={toggleInfo}
          onBack={() => navigate(basePath)}
        />
      ) : (
        <section className="card chat-empty">
          <div className="chat-empty-art"><LogoMark size={52} /></div>
          <h2>{section === 'groups' ? 'Your groups live here' : section === 'archived' ? 'Archived chats' : 'Pick up a conversation'}</h2>
          <p>
            {section === 'archived'
              ? 'Chats you archive are kept here. New messages from unmuted chats bring them back to your inbox.'
              : 'Choose a chat from the list, or start something new with a friend or a study group.'}
          </p>
          {section !== 'archived' && (
            <div className="chat-empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => setComposer('direct')}><MessageSquare size={16} />New chat</button>
              <button type="button" className="btn btn-outline" onClick={() => setComposer('group')}><Users size={16} />New group</button>
            </div>
          )}
        </section>
      )}

      {conversation && infoOpen && <InfoPanel conversation={conversation} onClose={toggleInfo} />}

      {composer && (
        <NewConversationModal
          initialMode={composer}
          onClose={() => setComposer(null)}
          onCreated={(created) => {
            setComposer(null);
            navigate(`${created.type === 'group' && section === 'groups' ? '/groups' : '/chats'}/${created.id}`);
          }}
        />
      )}
      <button type="button" className="fab" onClick={() => setComposer(section === 'groups' ? 'group' : 'direct')} aria-label="Start a new conversation"><Plus size={22} /></button>
    </div>
  );
}
