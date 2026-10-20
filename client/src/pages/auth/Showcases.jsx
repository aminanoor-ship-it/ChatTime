import { CheckCheck, FileText, MessageSquare, Users, Paperclip, Mic } from 'lucide-react';

// Decorative previews on the auth hero panel (static illustrations, not live data).
function Typing() {
  return <span className="sc-typing"><i /><i /><i /></span>;
}

export function LoginShowcase() {
  return (
    <div className="sc sc-login">
      <div className="sc-card sc-chat">
        <div className="sc-chat-head">
          <span className="sc-av sc-av-sky">HA<i className="sc-dot" /></span>
          <div><strong>Hodan Ali</strong><small className="sc-online">Online</small></div>
          <span className="sc-more">•••</span>
        </div>
        <div className="sc-bubble">Did you finish the login page?</div>
        <div className="sc-bubble sc-out">Yes! Sending it now.</div>
        <div className="sc-meta">10:24 <CheckCheck size={14} /></div>
        <Typing />
      </div>
      <div className="sc-card sc-notify">
        <span className="sc-av sc-av-navy sc-square">CS</span>
        <div><strong>CS301 Study Group</strong><small>Yusuf: Meeting moved to 4 PM</small></div>
        <span className="sc-now">now</span>
      </div>
      <div className="sc-online-pill">
        <span className="sc-stack"><b className="sc-av-navy">YO</b><b className="sc-av-pale">SA</b><b className="sc-av-pale">MN</b></span>
        Your friends are online
      </div>
    </div>
  );
}

export function LoginFeatures() {
  return (
    <>
      <span className="hero-chip"><MessageSquare size={18} />Private chats</span>
      <span className="hero-chip"><Users size={18} />Groups</span>
      <span className="hero-chip"><Paperclip size={18} />File sharing</span>
      <span className="hero-copyright">© 2025 ChatTime</span>
    </>
  );
}

export function RegisterShowcase() {
  return (
    <div className="sc">
      <div className="sc-card sc-group">
        <div className="sc-chat-head">
          <span className="sc-av sc-av-navy sc-square">CS</span>
          <div><strong>CS301 Study Group</strong><small>5 members · 3 online</small></div>
          <span className="sc-stack"><b className="sc-av-sky">HA</b><b className="sc-av-pale">YO</b><b className="sc-av-navy">+3</b></span>
        </div>
        <div className="sc-system">Hodan added you to the group</div>
        <div className="sc-sender">Yusuf</div>
        <div className="sc-bubble">Welcome! Notes are in Files</div>
        <Typing />
      </div>
      <div className="sc-file">
        <span className="sc-file-icon"><FileText size={20} /></span>
        <div><strong>Week6-notes.docx</strong><small>Shared in CS301 · 180 KB</small></div>
      </div>
    </div>
  );
}

export function RegisterFeatures() {
  return (
    <div className="hero-tiles">
      <div className="hero-tile"><CheckCheck size={22} /><span>Read receipts</span></div>
      <div className="hero-tile"><Users size={22} /><span>Group roles</span></div>
      <div className="hero-tile"><Mic size={22} /><span>Voice notes</span></div>
    </div>
  );
}
