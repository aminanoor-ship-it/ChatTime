import { useState } from 'react';
import { ArrowLeft, MessageSquare, Users } from 'lucide-react';
import Modal from '../../components/Modal';
import { PeoplePicker } from './GroupModals';
import { useChat } from './ChatContext';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../components/Toast';

export default function NewConversationModal({ initialMode = 'direct', onClose, onCreated }) {
  const { openDirect, addConversation } = useChat();
  const toast = useToast();
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function startDirect(person) {
    if (busy) return;
    setBusy(true);
    try {
      onCreated(await openDirect(person.id));
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  }

  async function createGroup(event) {
    event?.preventDefault();
    if (name.trim().length < 2) return toast.error('Give your group a name (at least 2 characters).');
    setBusy(true);
    try {
      const { data } = await api.post('/conversations/groups', {
        name: name.trim(), description: description.trim(), member_ids: selected.map((person) => person.id),
      });
      addConversation(data.conversation);
      toast.success(`“${data.conversation.title}” is ready.`);
      onCreated(data.conversation);
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
    return undefined;
  }

  const footer = mode === 'group' && (
    step === 1 ? (
      <>
        <span className="modal-hint">{selected.length ? `${selected.length} selected` : 'You can add people later too'}</span>
        <button type="button" className="btn btn-primary" onClick={() => setStep(2)}>Next</button>
      </>
    ) : (
      <>
        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}><ArrowLeft size={16} />Back</button>
        <button type="submit" form="new-group" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create group'}</button>
      </>
    )
  );

  return (
    <Modal title={mode === 'group' ? (step === 1 ? 'New group' : 'Name your group') : 'New chat'} onClose={onClose} footer={footer}>
      {step === 1 && (
        <div className="pills modal-pills" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'direct'} className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}>
            <MessageSquare size={16} />Private chat
          </button>
          <button type="button" role="tab" aria-selected={mode === 'group'} className={mode === 'group' ? 'active' : ''} onClick={() => setMode('group')}>
            <Users size={16} />Group
          </button>
        </div>
      )}

      {mode === 'direct' && <PeoplePicker single selected={[]} onPick={startDirect} />}
      {mode === 'group' && step === 1 && <PeoplePicker selected={selected} onChange={setSelected} />}
      {mode === 'group' && step === 2 && (
        <form id="new-group" onSubmit={createGroup} className="stack">
          <div className="field">
            <label htmlFor="new-group-name">Group name</label>
            <input id="new-group-name" className="input" autoFocus maxLength={100} placeholder="e.g. CS301 Study Group" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="new-group-desc">Description <span className="optional">(optional)</span></label>
            <textarea id="new-group-desc" className="textarea" rows={3} maxLength={500} placeholder="What is this group about?" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <p className="modal-hint">{selected.length ? `${selected.map((person) => person.display_name.split(' ')[0]).join(', ')} will be added.` : 'Only you will be in the group to start with.'}</p>
        </form>
      )}
    </Modal>
  );
}
