import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, MailCheck, AlertCircle } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { LoginShowcase, LoginFeatures } from './Showcases';
import { api, errorMessage } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter the email address you registered with.');
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      sinceBadge
      badge="Account recovery"
      headline="Lost the"
      accent={<>thread? <span className="accent">No worries.</span></>}
      subtitle="We'll send you a secure link so you can choose a new password and get back to your conversations."
      showcase={<LoginShowcase />}
      features={<LoginFeatures />}
      topLink={<>Remembered it? <Link to="/login">Log in</Link></>}
      footer={<>© 2025 ChatTime · <Link to="/help">Help</Link></>}
    >
      {sent ? (
        <div className="auth-done">
          <div className="auth-card-icon auth-card-icon-success"><MailCheck size={30} /></div>
          <h2 className="auth-title">Check your email</h2>
          <p className="auth-subtitle">If <strong>{email.trim()}</strong> is registered, a reset link is on its way. It expires in 30 minutes.</p>
          <Link to="/login" className="btn btn-primary btn-lg btn-block"><ArrowLeft size={20} />Back to log in</Link>
        </div>
      ) : (
        <>
          <div className="auth-card-icon"><Mail size={30} /></div>
          <h2 className="auth-title">Reset your password</h2>
          <p className="auth-subtitle">Enter the email address you use for ChatTime.</p>
          {error && <div className="form-alert form-alert-error" role="alert"><AlertCircle size={18} />{error}</div>}
          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <div className="input-wrap">
                <Mail size={20} className="input-icon" />
                <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </form>
          <Link to="/login" className="btn btn-ghost btn-block back-link"><ArrowLeft size={18} />Back to log in</Link>
        </>
      )}
    </AuthLayout>
  );
}
