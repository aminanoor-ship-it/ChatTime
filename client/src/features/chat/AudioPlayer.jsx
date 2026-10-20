import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { formatDuration } from '../../lib/format';

const BARS = [6, 12, 18, 10, 22, 14, 8, 20, 16, 11, 24, 13, 7, 19, 15, 9, 21, 12, 17, 8, 14, 20, 10, 16];

export default function AudioPlayer({ src }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const element = audio.current;
    if (!element) return undefined;
    const onTime = () => {
      setCurrent(element.currentTime);
      if (Number.isFinite(element.duration) && element.duration > 0) setProgress(element.currentTime / element.duration);
    };
    const onMeta = () => {
      // Recorded WebM files often report Infinity until the browser seeks to the end once.
      if (element.duration === Infinity) {
        element.currentTime = 1e9;
        element.addEventListener('timeupdate', function fix() {
          element.removeEventListener('timeupdate', fix);
          setDuration(element.duration);
          element.currentTime = 0;
        });
      } else {
        setDuration(element.duration);
      }
    };
    const onEnd = () => { setPlaying(false); setProgress(0); setCurrent(0); };
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('loadedmetadata', onMeta);
    element.addEventListener('ended', onEnd);
    return () => {
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('loadedmetadata', onMeta);
      element.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    if (!audio.current) return;
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const seek = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    if (audio.current && Number.isFinite(audio.current.duration)) audio.current.currentTime = ratio * audio.current.duration;
  };

  return (
    <div className="audio">
      <audio ref={audio} src={src} preload="metadata" />
      <button type="button" className="audio-btn" onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className="audio-wave" onClick={seek} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} tabIndex={0}>
        {BARS.map((height, index) => (
          <i key={index} style={{ height }} className={index / BARS.length < progress ? 'played' : ''} />
        ))}
      </div>
      <span className="audio-time">{formatDuration(playing || current ? current : duration)}</span>
    </div>
  );
}
