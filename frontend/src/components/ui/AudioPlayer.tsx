/**
 * AudioPlayer — seekable audio player with a working progress bar (Issue #2499).
 *
 * The native <audio controls> is broken for MediaRecorder WebM blobs: those blobs
 * carry no duration metadata, so `audio.duration` is Infinity → the browser's
 * progress bar can't be dragged and no total length is shown.
 *
 * This component:
 *   - forces the browser to compute the real duration (the Infinity → seek-to-end
 *     → reset trick), so the total length and a draggable seek bar both work;
 *   - shows 目前時間 / 總時長;
 *   - lets the student drag the bar to scrub anywhere in the recording.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface AudioPlayerProps {
  src: string;
  className?: string;
  'aria-label'?: string;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, className = '', 'aria-label': ariaLabel }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  // Guards the one-shot WebM duration-fix so it doesn't loop.
  const durationFixDoneRef = useRef(false);

  // Reset when the source changes.
  useEffect(() => {
    durationFixDoneRef.current = false;
    setIsPlaying(false);
    setDuration(0);
    setCurrentTime(0);
  }, [src]);

  const handleLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.duration === Infinity || Number.isNaN(el.duration)) {
      // WebM-from-MediaRecorder: force the browser to compute the real duration by
      // seeking past the end once; the resulting 'timeupdate' reports a finite value.
      if (durationFixDoneRef.current) return;
      durationFixDoneRef.current = true;
      const onFixTimeUpdate = () => {
        el.removeEventListener('timeupdate', onFixTimeUpdate);
        el.currentTime = 0;
        setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      };
      el.addEventListener('timeupdate', onFixTimeUpdate);
      el.currentTime = 1e101;
    } else {
      setDuration(el.duration);
    }
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const next = Number(e.target.value);
    el.currentTime = next;
    setCurrentTime(next);
  }, []);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-label={ariaLabel}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={() => {
          const el = audioRef.current;
          // Ignore the transient huge currentTime from the duration-fix seek.
          if (el && Number.isFinite(el.currentTime) && el.currentTime < 1e100) {
            setCurrentTime(el.currentTime);
          }
        }}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />
      <button
        type="button"
        onClick={togglePlay}
        className="shrink-0 w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center active:scale-[0.98] transition-all"
        aria-label={isPlaying ? '暫停' : '播放'}
      >
        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
          {isPlaying ? 'pause' : 'play_arrow'}
        </span>
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={handleSeek}
        className="flex-1 accent-primary cursor-pointer"
        aria-label="播放進度，可拖拉快轉"
        disabled={!duration}
      />
      <span className="shrink-0 text-xs font-mono text-on-surface-variant tabular-nums">
        {formatClock(currentTime)} / {duration ? formatClock(duration) : '--:--'}
      </span>
    </div>
  );
};

export default AudioPlayer;
