export type PackSound =
  | "opening"
  | "hover"
  | "common"
  | "rare"
  | "sr"
  | "ssr-reveal"
  | "lr-reveal"
  | "slide";
// Adapted from the supplied prototype; one deterministic noise buffer per context.
const noiseBuffers = new WeakMap<AudioContext, AudioBuffer>();
export function playPackSound(audio: AudioContext, name: PackSound) {
  const voices = new Map<AudioScheduledSourceNode, () => void>();
  const audioBus = audio.createGain();
  audioBus.gain.value = 0.66;
  const limiter = audio.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.knee.value = 12;
  limiter.ratio.value = 5;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.12;
  audioBus.connect(limiter).connect(audio.destination);
  let noiseBuffer = noiseBuffers.get(audio);
  if (!noiseBuffer) {
    noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let seed = 73421,
      low = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const white = (seed >>> 0) / 2147483648 - 1;
      low = 0.97 * low + 0.03 * white;
      data[i] = white * 0.7 + low * 2;
    }
    noiseBuffers.set(audio, noiseBuffer);
  }
  const noise = noiseBuffer;
  let soundClock = audio.currentTime + 0.025;
  function trackVoice(source: AudioScheduledSourceNode, nodes: AudioNode[]) {
    const release = () => {
      if (!voices.delete(source)) return;
      source.onended = null;
      [source, ...nodes].forEach(node => node.disconnect());
      if (!voices.size) {
        audioBus.disconnect();
        limiter.disconnect();
      }
    };
    voices.set(source, release);
    source.onended = release;
  }
  function envelope(
    gain: GainNode,
    start: number,
    duration: number,
    volume: number,
    attack = 0.006
  ) {
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(
      volume,
      start + Math.min(attack, duration * 0.3)
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  }
  function foley(
    t: number,
    duration: number,
    volume: number,
    frequency: number,
    endFrequency: number,
    pan = 0,
    q = 0.7,
    attack = 0.008
  ) {
    const source = audio.createBufferSource(),
      filter = audio.createBiquadFilter(),
      gain = audio.createGain();
    source.buffer = noise;
    source.loop = true;
    filter.type = "bandpass";
    filter.Q.value = q;
    const start = soundClock + t;
    filter.frequency.setValueAtTime(frequency, start);
    filter.frequency.exponentialRampToValueAtTime(
      endFrequency,
      start + duration
    );
    envelope(gain, start, duration, volume, attack);
    source.connect(filter).connect(gain);
    const nodes: AudioNode[] = [filter, gain];
    if (audio.createStereoPanner) {
      const stereo = audio.createStereoPanner();
      stereo.pan.value = pan;
      gain.connect(stereo).connect(audioBus);
      nodes.push(stereo);
    } else gain.connect(audioBus);
    trackVoice(source, nodes);
    source.start(start, (t * 0.73) % 1);
    source.stop(start + duration + 0.015);
  }
  function spaceTone(
    t: number,
    f: number,
    end: number,
    duration: number,
    volume: number,
    pan = 0,
    attack = 0.018
  ) {
    const source = audio.createOscillator(),
      gain = audio.createGain(),
      start = soundClock + t;
    source.type = "sine";
    source.frequency.setValueAtTime(f, start);
    source.frequency.exponentialRampToValueAtTime(end, start + duration);
    envelope(gain, start, duration, volume, attack);
    source.connect(gain);
    const nodes: AudioNode[] = [gain];
    if (audio.createStereoPanner) {
      const stereo = audio.createStereoPanner();
      stereo.pan.setValueAtTime(pan, start);
      stereo.pan.linearRampToValueAtTime(-pan * 0.5, start + duration);
      gain.connect(stereo).connect(audioBus);
      nodes.push(stereo);
    } else gain.connect(audioBus);
    trackVoice(source, nodes);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
  function score(soft: boolean) {
    soundClock = audio.currentTime + 0.025;
    const v = soft ? 0.62 : 1;
    // Orbital charge: a low harmonic field, then an accelerating spectral sweep.
    spaceTone(0, 82, 146, 0.75, 0.065 * v, -0.3, 0.18);
    spaceTone(0.03, 123, 219, 0.73, 0.03 * v, 0.3, 0.18);
    foley(0.12, 0.56, 0.1 * v, 240, 3900, -0.4, 0.9, 0.25);
    spaceTone(0.43, 440, 1100, 0.26, 0.016 * v, 0.2, 0.05);
    // The seal breaks with a laser-like sweep and a compact pressure pulse.
    foley(0.68, 0.1, 0.17 * v, 5200, 1100, -0.25, 1.8, 0.003);
    spaceTone(0.69, 1800, 260, 0.16, 0.055 * v, -0.4, 0.003);
    spaceTone(0.86, 104, 42, 0.35, 0.22 * v, 0, 0.004);
    foley(0.87, 0.45, 0.1 * v, 650, 2900, 0.3, 0.5, 0.015);
    // Five spectral trails follow the cards. Long, quiet tails imply space.
    for (let i = 0; i < 5; i++) {
      foley(
        1.04 + i * 0.065,
        0.22,
        0.036 * v,
        1300 + i * 260,
        520,
        (i - 2) * 0.25,
        0.8,
        0.022
      );
      const f = [440, 554.37, 659.25, 830.61, 1108.73][i];
      spaceTone(
        1.12 + i * 0.065,
        f,
        f * 0.997,
        0.66,
        0.014 * v,
        (i - 2) * 0.3,
        0.025
      );
      spaceTone(
        1.29 + i * 0.065,
        f * 2,
        f * 1.995,
        0.65,
        0.004 * v,
        -(i - 2) * 0.3,
        0.04
      );
    }
  }
  function playRevealSound(kind: string, index = 0) {
    soundClock = audio.currentTime + 0.012;
    if (kind === "hover") {
      foley(0, 0.15, 0.018, 1500, 800, (index - 2) * 0.22, 0.45, 0.025);
      return;
    }
    if (kind === "next") {
      foley(0, 0.18, 0.075, 2100, 650, -0.25, 0.6, 0.008);
      spaceTone(0.02, 320, 190, 0.1, 0.018, 0.25);
      return;
    }
    const base = [261.63, 329.63, 392, 493.88, 659.25][index],
      strength = (0.65 + index * 0.12) * 1.8;
    // A short intake precedes the flip; the harmonic bloom lands on its midpoint.
    foley(0, 0.26, 0.065, 620, 3400, -0.5, 0.8, 0.06);
    spaceTone(0.24, base * 0.5, base * 0.498, 0.36, 0.07 * strength, 0, 0.007);
    spaceTone(0.26, base, base * 0.999, 0.85, 0.052 * strength, -0.25, 0.012);
    spaceTone(
      0.29,
      base * 1.5,
      base * 1.498,
      0.7,
      0.024 * strength,
      0.35,
      0.015
    );
    spaceTone(0.38, base * 2, base * 1.998, 0.75, 0.014 * strength, 0.5, 0.04);
    spaceTone(0.52, base, base, 0.65, 0.009 * strength, -0.5, 0.035);
    if (index === 2) {
      spaceTone(0.42, base * 2.5, base * 2.498, 0.85, 0.012, 0.15, 0.025);
      foley(0.26, 0.55, 0.035, 3000, 1000, 0.4, 1, 0.07);
    }
  }

  if (name === "opening") score(false);
  else
    playRevealSound(
      name === "slide" ? "next" : name === "hover" ? "hover" : "flip",
      name === "rare"
        ? 1
        : name === "sr"
          ? 2
          : name === "ssr-reveal"
            ? 3
            : name === "lr-reveal"
              ? 4
              : 0
    );
  return {
    get active() {
      return voices.size > 0;
    },
    stop() {
      voices.forEach((release, source) => {
        source.stop();
        release();
      });
    }
  };
}
