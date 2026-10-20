import { useEffect, useRef, useState } from 'react';
import {
  Check, File as FileIcon, FileText, Image as ImageIcon, Mic, Paperclip, Pencil, Reply, Send, Smile, Trash2, X,
} from 'lucide-react';
import { uploadFile, errorMessage } from '../../lib/api';
import { formatBytes, formatDuration, previewFor } from '../../lib/format';
import { useToast } from '../../components/Toast';

const EMOJI = ['😀', '😂', '🥰', '😍', '😊', '😉', '😎', '🤔', '😅', '😭', '😮', '😴', '👍', '👎', '👏', '🙏', '💪', '🙌', '👋', '🤝',
  '❤️', '💙', '🔥', '✨', '🎉', '✅', '❌', '⭐', '📚', '💻', '☕', '🍕', '⚽', '🎵', '📌', '📎', '⏰', '💡', '🤩', '😇'];
const CATEGORY = (mime) => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document');
const drafts = new Map();

function pickRecorderType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

export default function Composer({
  conversation, settings, replyTo, editing, blockedNotice, onCancelReply, onCancelEdit, onSend, onSaveEdit, onTypingStart, onTypingStop,
}) {
  const toast = useToast();
  const [text, setText] = useState(() => drafts.get(conversation.id) || '');
  const [uploads, setUploads] = useState([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recording, setRecording] = useState(null);
  const textarea = useRef(null);
  const imageInput = useRef(null);
  const fileInput = useRef(null);
  const typingTimer = useRef(null);
  const isTyping = useRef(false);
  const recorderRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setText(editing.body || '');
      requestAnimationFrame(() => textarea.current?.focus());
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) textarea.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    if (!editing) drafts.set(conversation.id, text);
  }, [text, editing, conversation.id]);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => () => {
    clearTimeout(typingTimer.current);
    if (isTyping.current) onTypingStop();
    recorderRef.current?.cancel();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (isTyping.current) {
      isTyping.current = false;
      onTypingStop();
    }
  };

  const handleChange = (event) => {
    setText(event.target.value);
    if (editing) return;
    if (!isTyping.current && event.target.value.trim()) {
      isTyping.current = true;
      onTypingStart();
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2500);
  };

  function addFiles(fileList) {
    const files = [...fileList];
    if (uploads.length + files.length > 10) {
      toast.error('You can attach up to 10 files at once.');
      return;
    }
    for (const file of files) {
      const category = CATEGORY(file.type || '');
      if (!settings.allowed_file_categories.includes(category)) {
        toast.error(`${file.name}: ${category} files are not allowed.`);
        continue;
      }
      if (file.size > settings.max_upload_mb * 1024 * 1024) {
        toast.error(`${file.name} is larger than ${settings.max_upload_mb} MB.`);
        continue;
      }
      startUpload(file);
    }
  }

  function startUpload(file, extra = {}) {
    const key = Math.random().toString(36).slice(2);
    const preview = /^(image|video)\//.test(file.type) ? URL.createObjectURL(file) : null;
    setUploads((list) => [...list, { key, file, preview, progress: 0, attachment: null, error: null }]);
    uploadFile('/uploads', file, { conversation_id: conversation.id, ...extra }, (progress) => {
      setUploads((list) => list.map((item) => (item.key === key ? { ...item, progress } : item)));
    })
      .then(({ attachment }) => setUploads((list) => list.map((item) => (item.key === key ? { ...item, attachment: { ...attachment, preview } } : item))))
      .catch((error) => {
        toast.error(`${file.name}: ${errorMessage(error)}`);
        setUploads((list) => list.filter((item) => item.key !== key));
        if (preview) URL.revokeObjectURL(preview);
      });
    return key;
  }

  const removeUpload = (key) => setUploads((list) => list.filter((item) => item.key !== key));
  const uploading = uploads.some((item) => !item.attachment);
  const canSend = !uploading && (text.trim() || uploads.length);

  function submit(event) {
    event?.preventDefault();
    if (editing) {
      const value = text.trim();
      if (!value) return;
      onSaveEdit(value);
      setText(drafts.get(conversation.id) || '');
      return;
    }
    if (!canSend) return;
    onSend({ body: text.trim(), attachments: uploads.map((item) => item.attachment) });
    setText('');
    setUploads([]);
    drafts.delete(conversation.id);
    stopTyping();
    textarea.current?.focus();
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      if (editing) { onCancelEdit(); setText(drafts.get(conversation.id) || ''); }
      else if (replyTo) onCancelReply();
    }
  };

  const insertEmoji = (emoji) => {
    const element = textarea.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast.error('Voice messages are not supported in this browser.');
      return;
    }
    if (!settings.allowed_file_categories.includes('audio')) {
      toast.error('Voice messages are turned off by the administrator.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_error) {
      toast.error('Allow microphone access to record a voice message.');
      return;
    }
    const mimeType = pickRecorderType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const startedAt = Date.now();
    let cancelled = false;
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(timer);
      setRecording(null);
      recorderRef.current = null;
      if (cancelled) return;
      const seconds = (Date.now() - startedAt) / 1000;
      if (seconds < 1) { toast.info('Hold on a little longer to record a voice message.'); return; }
      const type = recorder.mimeType || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File(chunks, `voice-message.${ext}`, { type });
      sendVoice(file, seconds);
    };
    const timer = setInterval(() => setRecording((current) => current && { ...current, seconds: (Date.now() - startedAt) / 1000 }), 250);
    recorderRef.current = { stop: () => recorder.stop(), cancel: () => { cancelled = true; if (recorder.state !== 'inactive') recorder.stop(); } };
    recorder.start();
    setRecording({ seconds: 0 });
  }

  async function sendVoice(file, seconds) {
    try {
      const { attachment } = await uploadFile('/uploads', file, { conversation_id: conversation.id, duration_seconds: seconds.toFixed(1) });
      onSend({ body: '', attachments: [attachment] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  if (blockedNotice) {
    return <div className="composer-blocked">{blockedNotice}</div>;
  }

  return (
    <div
      className="composer-wrap"
      onDragOver={(event) => { if (!editing && event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
      onDrop={(event) => { if (!editing && event.dataTransfer.files.length) { event.preventDefault(); addFiles(event.dataTransfer.files); } }}
    >
      {(replyTo || editing) && (
        <div className="composer-context">
          {editing ? <Pencil size={18} /> : <Reply size={18} />}
          <div>
            <strong>{editing ? 'Editing message' : `Replying to ${replyTo.sender.display_name}`}</strong>
            <span>{previewFor(editing || replyTo)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => { if (editing) { onCancelEdit(); setText(drafts.get(conversation.id) || ''); } else onCancelReply(); }} aria-label="Cancel"><X size={18} /></button>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="upload-tray">
          {uploads.map((item) => (
            <div key={item.key} className={`upload-chip ${item.attachment ? 'done' : ''}`}>
              {item.preview && item.file.type.startsWith('image/') ? <img src={item.preview} alt="" /> : <span className="upload-icon"><FileText size={18} /></span>}
              <span className="upload-meta">
                <strong>{item.file.name}</strong>
                <small>{item.attachment ? formatBytes(item.file.size) : `Uploading ${item.progress}%`}</small>
              </span>
              {!item.attachment && <i className="upload-progress" style={{ width: `${item.progress}%` }} />}
              <button type="button" className="icon-btn" onClick={() => removeUpload(item.key)} aria-label={`Remove ${item.file.name}`}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {/* One bordered field like the design: text, then emoji / mic / attach / send inside it. */}
      <form className="composer" onSubmit={submit}>
        {recording ? (
          <div className="recording">
            <button type="button" className="icon-btn recording-cancel" onClick={() => recorderRef.current?.cancel()} aria-label="Cancel recording"><Trash2 size={16} /></button>
            <span className="recording-dot" />
            <span className="recording-time">{formatDuration(recording.seconds)}</span>
            <span className="recording-label">Recording voice message…</span>
            <button type="button" className="send-btn" onClick={() => recorderRef.current?.stop()} aria-label="Stop and send"><Send size={15} /></button>
          </div>
        ) : (
          <>
            <textarea
              ref={textarea}
              rows={1}
              value={text}
              onChange={handleChange}
              onKeyDown={onKeyDown}
              onBlur={stopTyping}
              onPaste={(event) => { if (event.clipboardData.files.length && !editing) { event.preventDefault(); addFiles(event.clipboardData.files); } }}
              placeholder={editing ? 'Edit your message…' : 'Your messages…'}
              aria-label="Message"
              maxLength={4000}
            />
            <div className="emoji-wrap">
              <button type="button" className="icon-btn" onClick={() => setEmojiOpen((open) => !open)} aria-label="Emoji"><Smile size={16} /></button>
              {emojiOpen && (
                <div className="emoji-picker" onMouseLeave={() => setEmojiOpen(false)}>
                  {EMOJI.map((emoji) => <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>{emoji}</button>)}
                </div>
              )}
            </div>
            {!editing && (
              <>
                <button type="button" className="icon-btn" onClick={startRecording} aria-label="Record voice message"><Mic size={16} /></button>
                <div className="attach-wrap">
                  <button type="button" className={`icon-btn ${attachOpen ? 'active' : ''}`} onClick={() => setAttachOpen((open) => !open)} aria-label="Attach">
                    <Paperclip size={16} />
                  </button>
                  {attachOpen && (
                    <div className="attach-menu" onMouseLeave={() => setAttachOpen(false)}>
                      <button type="button" onClick={() => { setAttachOpen(false); imageInput.current?.click(); }}><ImageIcon size={16} />Photo or video</button>
                      <button type="button" onClick={() => { setAttachOpen(false); fileInput.current?.click(); }}><FileIcon size={16} />Document</button>
                    </div>
                  )}
                  <input ref={imageInput} type="file" accept="image/*,video/*" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
                  <input ref={fileInput} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
                </div>
              </>
            )}
            <button type="submit" className="send-btn" disabled={editing ? !text.trim() : !canSend} aria-label={editing ? 'Save edit' : 'Send'}>
              {editing ? <Check size={15} /> : <Send size={15} />}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
