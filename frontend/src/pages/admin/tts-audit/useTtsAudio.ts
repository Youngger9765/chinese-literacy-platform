// useTtsAudio.ts — per-row audio playback hook (Issue #1120)
import { useRef, useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export type AudioState = 'idle' | 'loading' | 'playing' | 'error';

export interface UseTtsAudio {
  state: AudioState;
  toggle: (text: string, token: string) => void;
  stop: () => void;
}

export function useTtsAudio(): UseTtsAudio {
  const [state, setState] = useState<AudioState>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setState('idle');
  }, []);

  const toggle = useCallback(
    (text: string, token: string) => {
      if (state === 'playing') {
        stop();
        return;
      }
      if (state === 'loading') return;

      setState('loading');

      fetch(`${API_BASE}/api/tts/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`TTS ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          // #3023: deliberately NOT rate-adjusted. This is the admin TTS
          // audit tool -- its whole job is to hear what the synthesizer
          // actually produced. Applying a listener's speed preference here
          // would hide the very thing the auditor is checking.
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            blobUrlRef.current = null;
            audioRef.current = null;
            setState('idle');
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            blobUrlRef.current = null;
            audioRef.current = null;
            setState('error');
          };
          return audio.play();
        })
        .then(() => setState('playing'))
        .catch(() => setState('error'));
    },
    [state, stop],
  );

  return { state, toggle, stop };
}
