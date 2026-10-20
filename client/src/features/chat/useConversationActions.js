import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { useChat } from './ChatContext';

// Conversation-level actions shared by the chat header menu and the details panel.
export default function useConversationActions(conversation) {
  const { setPreferences, refreshConversation, removeConversation } = useChat();
  const toast = useToast();
  const confirm = useConfirm();
  const other = conversation.other_user;

  const setPrefs = (patch, successMessage) => toast.run(() => setPreferences(conversation.id, patch), successMessage);

  const toggleMute = () => setPrefs({ is_muted: !conversation.is_muted }, conversation.is_muted ? 'Notifications on.' : 'Muted.');

  async function toggleBlock() {
    const blocking = !other.blocked_by_me;
    if (blocking && !(await confirm({
      title: `Block ${other.display_name}?`,
      message: 'They will not be able to message you or add you to groups. You can unblock them later in Settings.',
      confirmLabel: 'Block',
      danger: true,
    }))) return;
    await toast.run(async () => {
      await (blocking ? api.post(`/blocks/${other.id}`) : api.delete(`/blocks/${other.id}`));
      await refreshConversation(conversation.id);
    }, blocking ? `${other.display_name} is blocked.` : `${other.display_name} is unblocked.`);
  }

  // Leaving removes the conversation locally; the chat view then returns to the list on its own.
  async function leaveGroup() {
    if (!(await confirm({
      title: `Leave ${conversation.title}?`,
      message: 'You will stop receiving messages from this group. Someone will need to add you again to rejoin.',
      confirmLabel: 'Leave group',
      danger: true,
    }))) return;
    await toast.run(async () => {
      await api.post(`/conversations/${conversation.id}/leave`);
      removeConversation(conversation.id);
    }, 'You left the group.');
  }

  return { setPrefs, toggleMute, toggleBlock, leaveGroup };
}
