import { Check } from 'lucide-react';

const PASSWORD_RULES = [
  { label: '8+ characters', test: (value) => value.length >= 8 },
  { label: 'Upper & lower case', test: (value) => /[a-z]/.test(value) && /[A-Z]/.test(value) },
  { label: 'A number', test: (value) => /[0-9]/.test(value) },
  { label: 'A symbol', test: (value) => /[^A-Za-z0-9]/.test(value) },
];

export const passwordIsValid = (value) => PASSWORD_RULES.every((rule) => rule.test(value));

const LEVELS = ['Weak', 'Fair', 'Good', 'Strong'];

export default function PasswordStrength({ value }) {
  const passed = PASSWORD_RULES.filter((rule) => rule.test(value)).length;
  const level = value ? LEVELS[Math.max(passed - 1, 0)] : 'Not set';
  return (
    <div className={`strength strength-${value ? passed : 'empty'}`} aria-live="polite">
      <div className="strength-head">
        <span>Password strength</span>
        <strong>{level}</strong>
      </div>
      <div className="strength-bars" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => <i key={index} className={value && index < passed ? 'on' : ''} />)}
      </div>
      <ul className="strength-rules">
        {PASSWORD_RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li key={rule.label} className={ok ? 'ok' : ''}>
              <span className="rule-dot">{ok && <Check size={10} strokeWidth={3.5} />}</span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
