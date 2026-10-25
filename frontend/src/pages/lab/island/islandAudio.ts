/**
 * 喝采島的聲音：全部用 WebAudio 即時合成，不載任何音檔。
 * 瀏覽器規定要使用者點過一次才能出聲，所以由開場的「點一下」啟動。
 * 開場遵守「聲音先於畫面」：start() 之後畫面才淡入（見 ReadingIslandLab）。
 */
const MUTE_KEY = 'reading-island-muted';

export type IslandCue = 'whoosh' | 'chime' | 'door' | 'sparkle';

export function readMuted(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function writeMuted(storage: Pick<Storage, 'setItem'> | null, muted: boolean): void {
  try { storage?.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* 私密模式：只在這次有效 */ }
}

export interface IslandAudio {
  start(): void;
  cue(name: IslandCue): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

export function createIslandAudio(initiallyMuted: boolean): IslandAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = initiallyMuted;
  const level = () => (muted ? 0 : 0.6);

  const noiseBuffer = (c: AudioContext, seconds: number) => {
    const buffer = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  };

  const ambient = (c: AudioContext, out: GainNode) => {
    // 海浪：低通濾過的白噪音，音量用很慢的 LFO 一起一伏
    const sea = c.createBufferSource();
    sea.buffer = noiseBuffer(c, 4);
    sea.loop = true;
    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 520;
    const swell = c.createGain();
    swell.gain.value = 0.16;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.09;
    lfo.connect(lfoDepth).connect(swell.gain);
    sea.connect(lowpass).connect(swell).connect(out);
    sea.start();
    lfo.start();
    // 底墊和弦：D 大調三個音，輕輕漂著
    [146.83, 220, 293.66, 369.99].forEach((freq, i) => {
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = (i % 2 ? 1 : -1) * 6;
      const g = c.createGain();
      g.gain.value = 0.035;
      osc.connect(g).connect(out);
      osc.start();
    });
  };

  const envelope = (c: AudioContext, gain: GainNode, peak: number, attack: number, release: number) => {
    const t = c.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  };

  return {
    start() {
      if (ctx) { void ctx.resume(); return; }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      ambient(ctx, master);
      master.gain.linearRampToValueAtTime(level(), ctx.currentTime + 1.6);
    },
    cue(name) {
      if (!ctx || !master || muted) return;
      const c = ctx;
      const out = master;
      if (name === 'whoosh' || name === 'door') {
        const src = c.createBufferSource();
        src.buffer = noiseBuffer(c, 1.2);
        const band = c.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = name === 'door' ? 1.2 : 0.8;
        const t = c.currentTime;
        band.frequency.setValueAtTime(name === 'door' ? 160 : 300, t);
        band.frequency.exponentialRampToValueAtTime(name === 'door' ? 90 : 2400, t + 0.7);
        const g = c.createGain();
        envelope(c, g, name === 'door' ? 0.5 : 0.25, 0.08, 0.9);
        src.connect(band).connect(g).connect(out);
        src.start();
        return;
      }
      // chime（標題）與 sparkle（亮燈）：鐘聲＝基頻加幾個非整數倍泛音，長尾巴
      const base = name === 'chime' ? 587.33 : 1174.66;
      [1, 2.76, 5.4].forEach((ratio, i) => {
        const osc = c.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = base * ratio;
        const g = c.createGain();
        envelope(c, g, (name === 'chime' ? 0.22 : 0.12) / (i + 1), 0.01, name === 'chime' ? 2.6 : 1.1);
        osc.connect(g).connect(out);
        osc.start();
        osc.stop(c.currentTime + 3);
      });
    },
    setMuted(next) {
      muted = next;
      if (ctx && master) master.gain.setTargetAtTime(level(), ctx.currentTime, 0.15);
    },
    dispose() {
      void ctx?.close();
      ctx = null;
      master = null;
    },
  };
}
