import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Logo } from '../components/Logo';

// Placeholder copy for the site owner to replace with their real policies before launch.
const PAGES = {
  terms: {
    title: 'Terms of Use',
    sections: [
      ['Using ChatTime', 'ChatTime is a messaging service for private and group conversations. You are responsible for what you send and share, and you must not use the service to harass others, send spam, impersonate anyone or share content you do not have the right to share.'],
      ['Your account', 'Keep your password private. You can end active sessions at any time from Settings → Security. Administrators may suspend accounts that break these terms.'],
      ['Content and reports', 'You keep ownership of what you post. If someone reports a message, moderators may review that specific message to decide whether it breaks these terms.'],
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    sections: [
      ['What we store', 'Your profile (name, username, email, optional phone, photo and bio), the conversations you take part in, the files you share, and basic session information such as device type and IP address.'],
      ['Who can see your messages', 'Only members of a conversation can read it. Administrators do not browse private conversations; they only see content that has been reported to them for review.'],
      ['Your choices', 'You can edit your profile, remove your photo, block people, mute conversations and sign out of other devices from Settings.'],
    ],
  },
  help: {
    title: 'Help & support',
    sections: [
      ['I forgot my password', 'Use “Forgot password?” on the log in page. We will send a reset link to your registered email address; it works once and expires after 30 minutes.'],
      ['My account was suspended', 'Contact the administrator of this ChatTime site. Suspended accounts cannot log in or send messages until they are reactivated.'],
      ['Someone is bothering me', 'Open their profile in the chat panel and choose Block or Report. Blocking stops new messages immediately; reports go to the moderation team.'],
      ['Messages are not arriving', 'Check your internet connection and refresh the page. ChatTime reconnects automatically and loads anything you missed.'],
    ],
  },
};

export default function InfoPage({ page }) {
  const content = PAGES[page];
  const navigate = useNavigate();
  return (
    <div className="info-page">
      <header className="info-header">
        <Link to="/login" aria-label="ChatTime"><Logo size={34} /></Link>
      </header>
      <main className="info-body">
        <button type="button" onClick={() => navigate(-1)} className="back-link-inline"><ArrowLeft size={18} />Back</button>
        <h1>{content.title}</h1>
        {content.sections.map(([heading, text]) => (
          <section key={heading}>
            <h2>{heading}</h2>
            <p>{text}</p>
          </section>
        ))}
        <nav className="info-links">
          <Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/help">Help</Link>
        </nav>
      </main>
    </div>
  );
}
