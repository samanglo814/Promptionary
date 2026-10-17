// The microphone, shared by every turn of the game.
//
// Two reasons this isn't just MediaRecorder:
// 1. iPhones ask "Allow microphone?" every time the mic is opened again. So we open it once
//    (when the player joins) and keep it open for the whole game. The phone shows its mic
//    indicator meanwhile, but the player only gets asked once.
// 2. iPhone Safari's MediaRecorder records audio/mp4, which isn't on Gemini's list of audio formats.
//    So we record raw samples with the Web Audio API and make a WAV file, which every browser can
//    record and Gemini accepts. 16 kHz mono is plenty for speech: 20 seconds is about 640 KB.

const WAV_SAMPLE_RATE = 16_000;
// Shorter than this and nobody said anything worth sending (saves an AI call).
const MIN_SECONDS = 0.5;
// Quieter than this all the way through (about -46 dB) means the mic heard nothing, e.g. it was muted.
const MIN_PEAK = 0.005;
// Louder than this (about -28 dB) counts as the player starting to talk, for onSound.
const SPEECH_PEAK = 0.04;

let stream: MediaStream | null = null;
let context: AudioContext | null = null;

// getUserMedia (the mic API) only exists on secure pages: https:// or localhost.
export function micAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

// The audio engine. Created and resumed during a tap, because iPhones only allow sound to start then.
function audioContext(): AudioContext {
  if (!context) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    context = new Ctx();
  }
  return context;
}

// The mic stream, opened the first time and reused after that. If the phone closed or muted it
// (e.g. the screen locked, or a call came in), it's opened again, which may ask again.
async function openMic(): Promise<MediaStream> {
  if (stream?.getAudioTracks().some((track) => track.readyState === "live" && !track.muted)) return stream;
  stream?.getTracks().forEach((track) => track.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return stream;
}

// Call from a tap (e.g. the Join button). Unlocks audio, so a recording can start later even outside
// a tap. With `openMic`, also asks for the mic now, so the permission popup doesn't eat into
// someone's turn. Failing here is fine: "Tap to talk" asks again.
export function warmUpMic({ openMic: open }: { openMic: boolean }) {
  if (!micAvailable()) return;
  void audioContext().resume().catch(() => {});
  if (open) void openMic().catch(() => {});
}

export type Recording = {
  // Stops recording and returns the WAV file, or throws if there's (almost) no audio.
  stop: () => Blob;
  // Stops recording and throws the audio away.
  cancel: () => void;
};

// Starts recording. Call it from a tap: the audio engine has to be resumed during one.
// onSound is called once, when the mic first hears something loud enough to be speech.
export async function startRecording(onSound?: () => void): Promise<Recording> {
  const ctx = audioContext();
  const resumed = ctx.resume(); // first, while we're still inside the tap
  const mic = await openMic();
  await resumed;

  const source = ctx.createMediaStreamSource(mic);
  // ScriptProcessorNode is old but works everywhere, including older iPhones.
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let heard = false;
  processor.onaudioprocess = (e) => {
    const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(chunk);
    if (!heard && onSound && chunk.some((s) => Math.abs(s) >= SPEECH_PEAK)) {
      heard = true;
      onSound();
    }
  };
  source.connect(processor);
  processor.connect(ctx.destination); // some browsers only run the processor when it's connected (it outputs silence)

  const disconnect = () => {
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
  };

  return {
    stop() {
      disconnect();
      const samples = downsample(chunks, ctx.sampleRate, WAV_SAMPLE_RATE);
      if (samples.length < MIN_SECONDS * WAV_SAMPLE_RATE) throw new Error("No audio was recorded.");
      if (!samples.some((s) => Math.abs(s) >= MIN_PEAK)) {
        stream?.getTracks().forEach((track) => track.stop()); // probably a dead mic: reopen it next time
        stream = null;
        throw new Error("The recording is silent.");
      }
      return encodeWav(samples, WAV_SAMPLE_RATE);
    },
    cancel: disconnect,
  };
}

// Joins the chunks and lowers the sample rate (usually 48 kHz → 16 kHz) by averaging.
function downsample(chunks: Float32Array[], fromRate: number, toRate: number): Float32Array {
  const length = chunks.reduce((sum, c) => sum + c.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    input.set(c, offset);
    offset += c.length;
  }
  if (fromRate <= toRate) return input;

  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

// A standard 16-bit mono PCM WAV file: a 44-byte header, then the samples.
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));

  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // size of this "fmt " section
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
