// ChatTime brand mark and wordmark, drawn from the official SVG paths so they stay crisp at any size.
const MARK_LEFT = 'M8 7 L52 30 L52 90 L32 79 L19 93 L19 76 L8 70 Z';
const MARK_RIGHT = 'M112 7 L68 30 L68 90 L88 79 L101 93 L101 76 L112 70 Z';
const MARK_RIGHT_FILL = `${MARK_RIGHT} M75.8 48 a4.2 4.2 0 1 0 8.4 0 a4.2 4.2 0 1 0 -8.4 0 Z M83.8 43 a4.2 4.2 0 1 0 8.4 0 a4.2 4.2 0 1 0 -8.4 0 Z M91.8 38 a4.2 4.2 0 1 0 8.4 0 a4.2 4.2 0 1 0 -8.4 0 Z`;
const DOTS = [[24, 38], [32, 43], [40, 48], [80, 48], [88, 43], [96, 38]];

const WORDMARK = 'M31.844 1.064Q25.536 1.064 20.178-.95Q14.82-2.964 10.906-6.688Q6.992-10.412 4.788-15.466Q2.584-20.52 2.584-26.6Q2.584-32.68 4.788-37.734Q6.992-42.788 10.906-46.512Q14.82-50.236 20.178-52.25Q25.536-54.264 31.844-54.264Q39.216-54.264 45.03-51.68Q50.844-49.096 54.72-44.232L45.144-35.568Q42.56-38.608 39.482-40.204Q36.404-41.8 32.604-41.8Q29.336-41.8 26.6-40.736Q23.864-39.672 21.926-37.658Q19.988-35.644 18.886-32.832Q17.784-30.02 17.784-26.6Q17.784-23.18 18.886-20.368Q19.988-17.556 21.926-15.542Q23.864-13.528 26.6-12.464Q29.336-11.4 32.604-11.4Q36.404-11.4 39.482-12.996Q42.56-14.592 45.144-17.632L54.72-8.968Q50.844-4.18 45.03-1.558Q39.216 1.064 31.844 1.064ZM98.496-53.2H113.544V0H98.496V-20.748H77.976V0H62.928V-53.2H77.976V-33.212H98.496ZM119.32 0 142.804-53.2H157.624L181.184 0H165.528L161.348-10.336H138.852L134.672 0ZM156.94-21.432 150.1-38.456 143.26-21.432ZM198.284 0V-41.268H181.944V-53.2H229.596V-41.268H213.332V0ZM248.064 0V-41.268H231.724V-53.2H279.376V-41.268H263.112V0ZM286.52 0V-53.2H301.568V0ZM313.804 0V-53.2H326.192L344.888-22.496L363.128-53.2H375.516L375.668 0H361.836L361.684-28.196L348.004-5.244H341.316L327.712-27.436V0ZM402.724-11.628H430.54V0H387.828V-53.2H429.552V-41.572H402.724V-32.604H426.36V-21.356H402.724Z';

export function LogoMark({ color = 'var(--primary)', accent = 'var(--accent)', size = 40, className = '' }) {
  return (
    <svg className={className} width={size} height={size * 0.84} viewBox="4 3 112 94" aria-hidden="true" focusable="false">
      <path d={MARK_LEFT} fill="none" stroke={color} strokeWidth="7" strokeLinejoin="round" />
      <path d={MARK_RIGHT} fill="none" stroke={color} strokeWidth="7" strokeLinejoin="round" />
      <path d={MARK_RIGHT_FILL} fill={color} fillRule="evenodd" />
      {DOTS.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="4.2" fill={accent} />)}
    </svg>
  );
}

function Wordmark({ color, height }) {
  return (
    <svg height={height} width={height * (434 / 56)} viewBox="0 -55 434 57" role="img" aria-label="ChatTime">
      <path d={WORDMARK} fill={color} />
    </svg>
  );
}

// Brand lockup: the mark on a rounded tile followed by the wordmark.
// tone="light" is for dark/blue backgrounds.
export function Logo({ tone = 'dark', size = 30 }) {
  const light = tone === 'light';
  return (
    <span className="logo">
      <span className={`logo-tile ${light ? 'logo-tile-light' : ''}`} style={{ width: size, height: size }}>
        <LogoMark size={size * 0.7} color={light ? 'var(--primary)' : '#FFFFFF'} accent={light ? 'var(--accent)' : '#9CD3FF'} />
      </span>
      <Wordmark color={light ? '#FFFFFF' : 'var(--primary)'} height={size * 0.56} />
    </span>
  );
}
