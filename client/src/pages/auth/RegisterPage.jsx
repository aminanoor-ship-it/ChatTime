import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, AtSign, Camera, Lock, Mail, Plus, ShieldCheck, Smartphone, User, AlertCircle, X } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { RegisterShowcase, RegisterFeatures } from './Showcases';
import PasswordStrength, { passwordIsValid } from '../../components/PasswordStrength';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { errorMessage, uploadFile } from '../../lib/api';

const EMPTY = { display_name: '', username: '', email: '', phone: '', password: '', confirm: '' };

function validate(form, acceptTerms) {
  const errors = {};
  if (form.display_name.trim().length < 2) errors.display_name = 'Enter your full name.';
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(form.username.trim())) errors.username = '3–30 letters, numbers, . _ or -';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.phone.trim() && !/^\+?[0-9 ()-]{6,25}$/.test(form.phone.trim())) errors.phone = 'Enter a valid phone number.';
  if (!passwordIsValid(form.password)) errors.password = 'Meet all four password requirements.';
  if (form.confirm !== form.password || !form.confirm) errors.confirm = 'Passwords do not match.';
  if (!acceptTerms) errors.terms = 'Please accept the Terms and Privacy Policy.';
  return errors;
}

export default function RegisterPage() {
  const { register, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const fileInput = useRef(null);
  const [form, setForm] = useState(EMPTY);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState('');

  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => photoUrl && URL.revokeObjectURL(photoUrl), [photoUrl]);

  const update = (field) => (event) => {
    const next = { ...form, [field]: event.target.value };
    setForm(next);
    if (submitted) setErrors(validate(next, acceptTerms));
  };

  function pickPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return toast.error('Choose a JPG, PNG, GIF or WebP image.');
    if (file.size > 5 * 1024 * 1024) return toast.error('Profile photos can be up to 5 MB.');
    setPhoto(file);
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitted(true);
    const found = validate(form, acceptTerms);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setServerError('');
    try {
      await register({
        display_name: form.display_name.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        accept_terms: true,
      });
      if (photo) {
        await uploadFile('/users/me/avatar', photo).then(refresh).catch(() => toast.error('Your account is ready, but the photo could not be uploaded. Try again in Settings.'));
      }
      toast.success('Welcome to ChatTime!');
      navigate(location.state?.from || '/chats', { replace: true });
    } catch (requestError) {
      setServerError(errorMessage(requestError));
      setBusy(false);
    }
  }

  const fieldError = (name) => errors[name] && <span className="field-error">{errors[name]}</span>;

  return (
    <AuthLayout
      wide
      badge="Free · takes under a minute"
      headline="Start your"
      accent={<>first <span className="accent">chapter.</span></>}
      subtitle="Create your account, find your friends and start your first group in seconds."
      showcase={<RegisterShowcase />}
      features={<RegisterFeatures />}
      topLink={<>Already a member? <Link to="/login" state={location.state}>Log in</Link></>}
      footer={<>© 2025 ChatTime · <Link to="/help">Help</Link></>}
    >
      <div className="register-head">
        <div className="photo-picker">
          <button type="button" className="photo-circle" onClick={() => fileInput.current?.click()} aria-label="Add a profile photo">
            {photoUrl ? <img src={photoUrl} alt="" /> : <Camera size={30} />}
            <span className="photo-plus"><Plus size={16} strokeWidth={3} /></span>
          </button>
          {photo && (
            <button type="button" className="photo-remove" onClick={() => setPhoto(null)} aria-label="Remove photo"><X size={14} /></button>
          )}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={pickPhoto} />
        </div>
        <div>
          <h2 className="auth-title">Create your account</h2>
          <p className="auth-subtitle">Add a profile photo (optional) so friends recognise you.</p>
        </div>
      </div>

      {serverError && <div className="form-alert form-alert-error" role="alert"><AlertCircle size={18} />{serverError}</div>}

      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="display_name">Full name</label>
            <div className={`input-wrap ${errors.display_name ? 'invalid' : ''}`}>
              <User size={20} className="input-icon" />
              <input id="display_name" autoComplete="name" placeholder="Your name" value={form.display_name} onChange={update('display_name')} />
            </div>
            {fieldError('display_name')}
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <div className={`input-wrap ${errors.username ? 'invalid' : ''}`}>
              <AtSign size={20} className="input-icon" />
              <input id="username" autoComplete="username" placeholder="username" value={form.username} onChange={update('username')} />
            </div>
            {fieldError('username')}
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <div className={`input-wrap ${errors.email ? 'invalid' : ''}`}>
              <Mail size={20} className="input-icon" />
              <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={update('email')} />
            </div>
            {fieldError('email')}
          </div>
          <div className="field">
            <label htmlFor="phone">Phone <span className="optional">(optional)</span></label>
            <div className={`input-wrap ${errors.phone ? 'invalid' : ''}`}>
              <Smartphone size={20} className="input-icon" />
              <input id="phone" type="tel" autoComplete="tel" placeholder="+252 ..." value={form.phone} onChange={update('phone')} />
            </div>
            {fieldError('phone')}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className={`input-wrap ${errors.password ? 'invalid' : ''}`}>
              <Lock size={20} className="input-icon" />
              <input id="password" type="password" autoComplete="new-password" placeholder="8+ characters" value={form.password} onChange={update('password')} />
            </div>
            {fieldError('password')}
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <div className={`input-wrap ${errors.confirm ? 'invalid' : ''}`}>
              <ShieldCheck size={20} className="input-icon" />
              <input id="confirm" type="password" autoComplete="new-password" placeholder="Repeat password" value={form.confirm} onChange={update('confirm')} />
            </div>
            {fieldError('confirm')}
          </div>
        </div>

        <PasswordStrength value={form.password} />

        <label className={`checkbox ${errors.terms ? 'checkbox-invalid' : ''}`}>
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(event) => {
              setAcceptTerms(event.target.checked);
              if (submitted) setErrors(validate(form, event.target.checked));
            }}
          />
          <span className="checkbox-box" />
          <span>I agree to the <Link to="/terms" target="_blank">Terms</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.</span>
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? 'Creating your account…' : <>Create account <ArrowRight size={20} /></>}
        </button>
      </form>
    </AuthLayout>
  );
}
