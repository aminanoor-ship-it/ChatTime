import { Link, useLocation } from 'react-router-dom';
import { Logo } from '../../components/Logo';

// Two-panel layout: blue story panel on the left, form card on the right.
export default function AuthLayout({ badge, headline, accent, subtitle, showcase, features, topLink, footer, sinceBadge = false, children, wide = false }) {
  const { pathname } = useLocation();
  const redesigned = pathname === '/login' || pathname === '/register';
  return (
    <div className={redesigned ? `auth-stage ${wide ? 'auth-stage-register' : 'auth-stage-login'}` : undefined}>
    <div className={`auth ${redesigned ? 'auth-refreshed' : ''}`}>
      <aside className="auth-hero" aria-label="About ChatTime">
        <div className="auth-hero-lines" aria-hidden="true" />
        {redesigned && <div className="auth-geometry" aria-hidden="true"><i /><i /><i /><i /></div>}
        <div className="auth-hero-top">
          <Link to="/login" className="auth-logo-link" aria-label="ChatTime home"><Logo tone="light" size={36} /></Link>
          {sinceBadge && <span className="since-pill">SINCE 2025</span>}
        </div>
        <div className="auth-hero-copy">
          <span className="hero-badge"><i />{badge}</span>
          <h1>{headline}<br />{accent}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="auth-showcase" aria-hidden="true">{showcase}</div>
        <div className="auth-hero-footer">{features}</div>
      </aside>

      <main className="auth-main">
        <div className="auth-toplink">{topLink}</div>
        <div key={pathname} className={`auth-card ${wide ? 'auth-card-wide' : ''}`}>{children}</div>
        <footer className="auth-footer">{footer}</footer>
      </main>
    </div>
    </div>
  );
}
