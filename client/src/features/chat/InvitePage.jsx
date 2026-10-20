import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import Avatar from '../../components/Avatar';
import { api, errorMessage } from '../../lib/api';
import { useChat } from './ChatContext';
import { useToast } from '../../components/Toast';

export default function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { addConversation } = useChat();
  const toast = useToast();
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/invites/${token}`).then(({ data }) => setInvite(data.invite)).catch((requestError) => setError(errorMessage(requestError)));
  }, [token]);

  async function join() {
    setBusy(true);
    try {
      const { data } = await api.post(`/invites/${token}/accept`);
      addConversation(data.conversation);
      toast.success(data.already_member ? 'You are already in this group.' : `Welcome to ${data.conversation.title}!`);
      navigate(`/groups/${data.conversation.id}`, { replace: true });
    } catch (requestError) {
      toast.error(errorMessage(requestError));
      setBusy(false);
    }
  }

  return (
    <div className="page page-center">
      <div className="invite-box">
        {error ? (
          <>
            <span className="invite-icon"><Users size={34} /></span>
            <h1>Invite unavailable</h1>
            <p>{error}</p>
            <Link to="/chats" className="btn btn-primary">Go to chats</Link>
          </>
        ) : !invite ? (
          <p>Loading invite…</p>
        ) : (
          <>
            <Avatar name={invite.name} src={invite.avatar_url} id={invite.conversation_id} size={96} square />
            <h1>{invite.name}</h1>
            <p>{invite.inviter_name} invited you to join · {invite.member_count} member{invite.member_count === 1 ? '' : 's'}</p>
            {invite.description && <p className="invite-desc">{invite.description}</p>}
            {invite.already_member ? (
              <Link to={`/groups/${invite.conversation_id}`} className="btn btn-primary btn-lg">Open group</Link>
            ) : (
              <div className="invite-actions">
                <Link to="/chats" className="btn btn-ghost btn-lg">Not now</Link>
                <button type="button" className="btn btn-primary btn-lg" onClick={join} disabled={busy}>{busy ? 'Joining…' : 'Join group'}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
