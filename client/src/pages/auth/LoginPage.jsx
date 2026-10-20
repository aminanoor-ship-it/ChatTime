import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, Lock, Mail, AlertCircle } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { LoginShowcase, LoginFeatures } from './Showcases';
import { LogoMark } from '../../components/Logo';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api';

export default function LoginPage() {
  const { login, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ login: '', password: '', remember: false });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!form.login.trim() || !form.password) {
      setError('Enter your email or username and your password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login({ login: form.login.trim(), password: form.password, remember: form.remember });
      navigate(location.state?.from || '/chats', { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      sinceBadge
      badge="Live, real-time messaging"
      headline="Every chat"
      accent={<>is a <span className="accent">story.</span></>}
      subtitle="Private chats, group conversations and file sharing — all in one place. Pick up right where you left off."
      showcase={<LoginShowcase />}
      features={<LoginFeatures />}
      topLink={<>Need help? <Link to="/help">Contact support</Link></>}
      footer={<>By continuing you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</>}
    >
      <div className="auth-card-icon"><LogoMark size={40} /></div>
      <h2 className="auth-title">Welcome back</h2>
      <p className="auth-subtitle">Log in to continue your conversations.</p>

      {(error || notice) && (
        <div className={`form-alert ${error ? 'form-alert-error' : ''}`} role="alert">
          <AlertCircle size={18} />{error || notice}
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="login">Email or username</label>
          <div className="input-wrap">
            <Mail size={20} className="input-icon" />
            <input
              id="login"
              autoComplete="username"
              placeholder="you@example.com"
              value={form.login}
              onChange={(event) => setForm({ ...form, login: event.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <div className="field-label-row">
            <label htmlFor="password">Password</label>
            <Link to="/forgot-password" className="link">Forgot password?</Link>
          </div>
          <div className="input-wrap">
            <Lock size={20} className="input-icon" />
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
            <button type="button" className="input-action" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={form.remember} onChange={(event) => setForm({ ...form, remember: event.target.checked })} />
          <span className="checkbox-box" />
          Keep me signed in for 30 days
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? 'Logging in…' : <>Log in <ArrowRight size={20} /></>}
        </button>
      </form>

      <div className="divider-text"><span>New to ChatTime?</span></div>
      <Link to="/register" state={location.state} className="btn btn-outline btn-lg btn-block">Create a free account</Link>
    </AuthLayout>
  );
}
