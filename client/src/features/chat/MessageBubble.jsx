import { memo, useState } from 'react';
import {
  AlertCircle, Check, CheckCheck, Clock, Copy, Download, FileText, Flag, MoreHorizontal, Pencil, Pin, Play, Reply, RotateCcw, SmilePlus, Trash2,
} from 'lucide-react';
import Avatar from '../../components/Avatar';
import Menu from '../../components/Menu';
import AudioPlayer from './AudioPlayer';
import { formatBytes, formatClock } from '../../lib/format';

const QUICK_REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];
const TOKEN_PATTERN = /(https?:\/\/[^\s<>"']+|@[A-Za-z0-9_.-]{3,30})/g;

// Turns URLs into links and highlights @mentions; React escapes everything else.
function RichText({ text }) {
  const parts = text.split(TOKEN_PATTERN);
  return parts.map((part, index) => {
    if (index % 2 === 0) return part;
    if (part.startsWith('@')) return <span key={index} className="mention">{part}</span>;
    return <a key={index} href={part} target="_blank" rel="noopener noreferrer nofollow">{part}</a>;
  });
}

function Ticks({ status }) {
  if (status === 'sending') return <Clock size={12} className="ticks" aria-label="Sending" />;
  if (status === 'sent') return <Check size={13} className="ticks" aria-label="Sent" />;
  return <CheckCheck size={13} className={`ticks ${status === 'read' ? 'ticks-read' : ''}`} aria-label={status === 'read' ? 'Read' : 'Delivered'} />;
}

function ImageGrid({ images, onOpen }) {
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;
  return (
    <div className={`img-grid img-grid-${shown.length}`}>
      {shown.map((image, index) => (
        <button key={image.id} type="button" className="img-tile" onClick={() => onOpen(images, index)} aria-label={`Open ${image.original_filename}`}>
          {image.kind === 'video' ? (
            <>
              <video src={image.url || image.preview} preload="metadata" muted playsInline />
              <span className="img-play"><Play size={22} fill="currentColor" /></span>
            </>
          ) : (
            <img src={image.url || image.preview} alt={image.original_filename} loading="lazy" />
          )}
          {index === shown.length - 1 && extra > 0 && <span className="img-more">+{extra}</span>}
        </button>
      ))}
    </div>
  );
}

function FileCard({ file }) {
  return (
    <a className="file-card" href={file.url ? `${file.url}?download=1` : undefined} download={file.original_filename}>
      <span className="file-icon"><FileText size={18} /></span>
      <span className="file-meta">
        <strong>{file.original_filename}</strong>
        <small>{formatBytes(file.size_bytes)}{file.mime_type ? ` · ${file.mime_type.split('/')[1].split('.').pop().toUpperCase().slice(0, 5)}` : ''}</small>
      </span>
      <Download size={16} className="file-dl" />
    </a>
  );
}

function MessageBubble({
  message, mine, firstInRun, lastInRun, highlight, me, canPin, canEdit,
  onReply, onEdit, onDelete, onPin, onReport, onReact, onRetry, onDiscard, onOpenImages, onJumpTo, onCopy,
}) {
  const [picker, setPicker] = useState(false);

  if (message.message_type === 'system') {
    return <div className="system-pill" id={`m-${message.id}`}><span>{message.body}</span></div>;
  }

  const deleted = Boolean(message.deleted_at);
  const images = message.attachments.filter((a) => a.kind === 'image' || a.kind === 'video');
  const audios = message.attachments.filter((a) => a.kind === 'audio');
  const files = message.attachments.filter((a) => a.kind === 'file');
  const mediaOnly = images.length > 0 && !files.length && !audios.length;
  const sent = typeof message.id === 'number';

  const menuItems = [
    { label: 'Reply', icon: Reply, onClick: () => onReply(message), hidden: !sent || deleted },
    { label: 'Copy text', icon: Copy, onClick: () => onCopy(message), hidden: !message.body || deleted },
    { label: 'Edit', icon: Pencil, onClick: () => onEdit(message), hidden: !canEdit },
    { label: 'Pin message', icon: Pin, onClick: () => onPin(message), hidden: !sent || deleted || !canPin },
    { label: 'Report', icon: Flag, onClick: () => onReport(message), hidden: !sent || mine || deleted, danger: true },
    { label: 'Delete', icon: Trash2, onClick: () => onDelete(message), hidden: !sent || !mine || deleted, danger: true },
  ];

  // Like the design: avatar beside the first message of a run, with "Name · time" above it.
  return (
    <div
      id={sent ? `m-${message.id}` : undefined}
      className={`msg ${mine ? 'out' : 'in'} ${firstInRun ? 'first' : ''} ${highlight ? 'highlight' : ''}`}
    >
      <div className="msg-avatar">
        {firstInRun && <Avatar name={message.sender.display_name} src={message.sender.avatar_url} id={message.sender.id} size={32} />}
      </div>

      <div className="msg-col">
        {firstInRun && (
          <div className="msg-head">
            <strong>{mine ? 'You' : message.sender.display_name}</strong>
            <time dateTime={message.created_at}>{formatClock(message.created_at)}</time>
          </div>
        )}
        <div className="msg-line">
          <div className={`bubble ${deleted ? 'bubble-deleted' : ''} ${mediaOnly && !message.body ? 'bubble-media-only' : ''} ${message.failed ? 'bubble-failed' : ''}`}>
            {deleted ? (
              <em>This message was deleted</em>
            ) : (
              <>
                {message.reply_to && (
                  <button type="button" className="reply-quote" onClick={() => onJumpTo(message.reply_to.id)}>
                    <strong>{message.reply_to.sender_id === me.id ? 'You' : message.reply_to.sender_name}</strong>
                    <span>{message.reply_to.deleted ? 'Message deleted' : message.reply_to.preview}</span>
                  </button>
                )}
                {images.length > 0 && <ImageGrid images={images} onOpen={onOpenImages} />}
                {audios.map((audio) => <AudioPlayer key={audio.id} src={audio.url || audio.preview} />)}
                {files.map((file) => <FileCard key={file.id} file={file} />)}
                {message.body && <p className="bubble-text"><RichText text={message.body} /></p>}
              </>
            )}
          </div>

          {sent && !deleted && (
            <div className="msg-actions">
              <div className="react-wrap">
                <button type="button" className="icon-btn" onClick={() => setPicker((open) => !open)} aria-label="React" title="React"><SmilePlus size={16} /></button>
                {picker && (
                  <div className="react-picker" onMouseLeave={() => setPicker(false)}>
                    {QUICK_REACTIONS.map((emoji) => (
                      <button key={emoji} type="button" onClick={() => { setPicker(false); onReact(message, emoji); }} aria-label={`React ${emoji}`}>{emoji}</button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="icon-btn" onClick={() => onReply(message)} aria-label="Reply" title="Reply"><Reply size={16} /></button>
              <Menu trigger={<MoreHorizontal size={16} />} items={menuItems} align={mine ? 'right' : 'left'} />
            </div>
          )}
        </div>

        {message.reactions?.length > 0 && (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                type="button"
                className={`reaction ${reaction.user_ids.includes(me.id) ? 'mine' : ''}`}
                onClick={() => onReact(message, reaction.emoji)}
                title={reaction.names.join(', ')}
              >
                {reaction.emoji} <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        )}

        {message.failed ? (
          <div className="msg-failed">
            <AlertCircle size={13} />{message.error || 'Not sent'}
            <button type="button" onClick={() => onRetry(message)}><RotateCcw size={12} />Retry</button>
            <button type="button" onClick={() => onDiscard(message)}>Delete</button>
          </div>
        ) : (lastInRun || message.edited_at) && !deleted && (mine || message.edited_at) && (
          <div className="msg-meta">
            {message.edited_at && <span>edited</span>}
            {mine && lastInRun && <Ticks status={message.status} />}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MessageBubble);
