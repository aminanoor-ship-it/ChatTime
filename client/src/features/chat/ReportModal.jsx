import { useState } from 'react';
import Modal from '../../components/Modal';
import { api, errorMessage } from '../../lib/api';
import { useToast } from '../../components/Toast';

const REASONS = [
  ['spam', 'Spam or scam'],
  ['harassment', 'Harassment or bullying'],
  ['inappropriate_content', 'Inappropriate content'],
  ['impersonation', 'Pretending to be someone else'],
  ['other', 'Something else'],
];

// target: { type: 'user' | 'message' | 'conversation', id, label }
export default function ReportModal({ target, onClose }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!reason) return toast.error('Choose a reason.');
    setBusy(true);
    try {
      const { data } = await api.post('/reports', { target_type: target.type, target_id: target.id, reason, details });
      toast.success(data.message);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Report ${target.type === 'message' ? 'message' : target.type === 'user' ? 'user' : 'group'}`}
      subtitle={`${target.label} — only the moderators will see this report.`}
      onClose={onClose}
      width={480}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="report-form" className="btn btn-danger" disabled={busy}>{busy ? 'Sending…' : 'Send report'}</button>
        </>
      )}
    >
      <form id="report-form" onSubmit={submit} className="stack">
        <fieldset className="radio-list">
          <legend className="sr-only">Reason</legend>
          {REASONS.map(([value, label]) => (
            <label key={value} className={`radio-card ${reason === value ? 'checked' : ''}`}>
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="report-details">Anything else? <span className="optional">(optional)</span></label>
          <textarea id="report-details" className="textarea" rows={3} maxLength={2000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Add details that help moderators understand what happened." />
        </div>
      </form>
    </Modal>
  );
}
