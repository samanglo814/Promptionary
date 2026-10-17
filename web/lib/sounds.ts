// Game sound effects, generated in code with the Web Audio API.
// No audio files: each sound is built from simple waves and noise, like a tiny synth.
// That means nothing to download, no licensing, and no loading delay.
//
// Quick Web Audio vocabulary:
//   AudioContext   = the "sound card". Everything is created from it.
//   OscillatorNode = makes a steady tone (sine = soft, square = buzzy, sawtooth = brassy).
//   GainNode       = a volume knob. We move it over time to shape each note
//                    (quick fade in, then fade out) so notes don't click.
//   BiquadFilter   = an EQ that cuts high or low frequencies.
//   Times are in seconds on the context's own clock (ctx.currentTime).

// ---------- Setup ----------

let ctx: AudioContext | null = null;
let muted = false;

// Browsers block sound until the user has clicked or tapped the page once
// ("autoplay policy"). So the context is created on first use, and we try to
// un-pause it on every click. Before the first click, sounds are just silent.
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null; // on the server: no audio
  if (!ctx) {
    ctx = new AudioContext();
    // On any tap/click, wake the context up if the browser paused it.
    window.addEventListener("pointerdown", () => ctx?.resume(), { passive: true });
  }
  return ctx;
}

// Called by the host's mute button.
export function setMuted(value: boolean) {
  muted = value;
}

// Returns the context if we're allowed to make sound right now, otherwise null.
function ready(): AudioContext | null {
  if (muted) return null;
  const c = getCtx();
  if (!c) return null;
  if (c.state === "suspended") c.resume(); // works if we're inside a click
  return c;
}

// Plays one note.
//   freq     = pitch in Hz (440 = the A above middle C)
//   start    = when, in seconds from now
//   duration = how long, in seconds
//   type     = wave shape
//   volume   = 0 to 1 (keep it low; several notes add up)
function note(
  c: AudioContext,
  freq: number,
  start: number,
  duration: number,
  type: OscillatorType = "triangle",
  volume = 0.2,
) {
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);

  // Envelope: silent → full volume in 10ms → fades to near-silent by the end.
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

  // Wire it up: oscillator → volume knob → speakers.
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

// One second of random noise (static), made once and reused. Drums are mostly noise.
let noiseBuffer: AudioBuffer | null = null;
function getNoise(c: AudioContext) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// ---------- The sounds ----------

// Little "bloop" when a player joins the lobby.
export function playPop() {
  const c = ready();
  if (!c) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  // Pitch slides up quickly: that's what makes it sound like a "pop".
  osc.frequency.setValueAtTime(500, t);
  osc.frequency.exponentialRampToValueAtTime(1000, t + 0.08);
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.15);
}

// Game-show buzzer: two low, buzzy square waves slightly out of tune with each
// other, which makes the harsh "wrong answer" rasp. Used for banned words and refusals.
export function playBuzzer() {
  const c = ready();
  if (!c) return;
  note(c, 110, 0, 0.5, "square", 0.12);
  note(c, 116, 0, 0.5, "square", 0.12);
}

// Snare drumroll that builds up, for while the score counts.
// Returns a stop() function so the reveal can cut it off if the screen changes.
export function playDrumroll(duration: number): () => void {
  const c = ready();
  if (!c) return () => {};

  // Everything goes through one master volume knob, so stop() can silence it all at once.
  const master = c.createGain();
  master.connect(c.destination);

  // A high-pass filter cuts the low rumble so the noise sounds like a snare.
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1000;
  filter.connect(master);

  const noise = getNoise(c);
  const start = c.currentTime;
  const HIT_GAP = 0.045; // seconds between hits (about 22 hits a second)

  // Schedule every hit up front. Each hit is a 40ms burst of noise.
  for (let t = 0; t < duration; t += HIT_GAP) {
    const src = c.createBufferSource();
    src.buffer = noise;
    const hit = c.createGain();
    // Crescendo: hits get louder from 0.05 to 0.3 over the roll.
    const loudness = 0.05 + 0.25 * (t / duration);
    hit.gain.setValueAtTime(loudness, start + t);
    hit.gain.exponentialRampToValueAtTime(0.001, start + t + 0.04);
    src.connect(hit).connect(filter);
    // Start each hit at a random spot in the noise so they don't all sound identical.
    src.start(start + t, Math.random() * 0.9, 0.05);
  }

  // stop(): fade the master out over 50ms (instant cuts click), then unplug it.
  return () => {
    master.gain.setTargetAtTime(0, c.currentTime, 0.02);
    setTimeout(() => master.disconnect(), 100);
  };
}

// The "ta-da" (or "womp womp") when the score lands. It depends on how well they did,
// using the same score bands as the score colors on the reveal.
export function playSting(score: number) {
  const c = ready();
  if (!c) return;

  if (score >= 70) {
    // Great: quick rising major chord, C E G C (a happy arpeggio).
    [523, 659, 784, 1047].forEach((freq, i) => note(c, freq, i * 0.08, 0.5, "triangle", 0.18));
  } else if (score >= 40) {
    // Okay: two notes going up, a polite "ding-ding".
    note(c, 659, 0, 0.25, "triangle", 0.18);
    note(c, 784, 0.15, 0.4, "triangle", 0.18);
  } else {
    // Miss: the classic sad trombone, four notes sliding down.
    [392, 370, 349, 330].forEach((freq, i) =>
      note(c, freq, i * 0.3, i === 3 ? 0.9 : 0.35, "sawtooth", 0.08),
    );
  }
}