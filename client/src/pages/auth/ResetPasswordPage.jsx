import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, Lock, ShieldCheck, AlertCircle } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { LoginShowcase, LoginFeatures } from './Showcases';
import PasswordStrength, { passwordIsValid } from '../../components/PasswordStrength';
import { api, errorMessage } from '../../lib/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(token ? '' : 'This reset link is missing its code. Request a new one.');

  async function submit(event) {
    event.preventDefault();
    if (!passwordIsValid(password)) return setError('Meet all four password requirements.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
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
      headline="A fresh"
      accent={<>new <span className="accent">page.</span></>}
      subtitle="Choose a strong password you don't use anywhere else. You'll be signed out of other devices."
      showcase={<LoginShowcase />}
      features={<LoginFeatures />}
      topLink={<>Remembered it? <Link to="/login">Log in</Link></>}
      footer={<>© 2025 ChatTime · <Link to="/help">Help</Link></>}
    >
      {done ? (
        <div className="auth-done">
          <div className="auth-card-icon auth-card-icon-success"><CheckCircle2 size={30} /></div>
          <h2 className="auth-title">Password updated</h2>
          <p className="auth-subtitle">You can now log in with your new password.</p>
          <Link to="/login" className="btn btn-primary btn-lg btn-block">Go to log in</Link>
        </div>
      ) : (
        <>
          <div className="auth-card-icon"><KeyRound size={30} /></div>
          <h2 className="auth-title">Choose a new password</h2>
          <p className="auth-subtitle">Reset links work once and expire after 30 minutes.</p>
          {error && <div className="form-alert form-alert-error" role="alert"><AlertCircle size={18} />{error}</div>}
          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="password">New password</label>
              <div className="input-wrap">
                <Lock size={20} className="input-icon" />
                <input id="password" type="password" autoComplete="new-password" placeholder="8+ characters" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <div className="input-wrap">
                <ShieldCheck size={20} className="input-icon" />
                <input id="confirm" type="password" autoComplete="new-password" placeholder="Repeat password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </div>
            </div>
            <PasswordStrength value={password} />
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !token}>{busy ? 'Saving…' : 'Update password'}</button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
