import { useRef, useState } from "react";

/** ====== CONFIG: set your fixed Madhya Sa frequency here ====== */
const SA_FREQ = 240; // Hz (change later if you like)

/** ====== WAV helpers (unchanged) ====== */
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i++)
    view.setUint8(offset + i, text.charCodeAt(i));
}
function encodeWavMono(samplesFloat32, sampleRate) {
  const pcmBuffer = floatTo16BitPCM(samplesFloat32);
  const wavBuffer = new ArrayBuffer(44 + pcmBuffer.byteLength);
  const view = new DataView(wavBuffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBuffer.byteLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcmBuffer.byteLength, true);
  new Uint8Array(wavBuffer, 44).set(new Uint8Array(pcmBuffer));
  return new Blob([wavBuffer], { type: "audio/wav" });
}

/** ====== Carnatic mapping ======
 * 12 swarasthanas per octave (just-intonation-ish ratios relative to Sa)
 * You can tweak these later if you prefer a different tuning.
 */
const SWARAS = [
  { name: "Sa", ratio: 1.0 },
  { name: "Ri1", ratio: 16 / 15 },
  { name: "Ri2", ratio: 9 / 8 },
  { name: "Ga2", ratio: 5 / 4 },
  { name: "Ga3", ratio: 6 / 5 },
  { name: "Ma1", ratio: 4 / 3 },
  { name: "Ma2", ratio: 45 / 32 },
  { name: "Pa", ratio: 3 / 2 },
  { name: "Da1", ratio: 8 / 5 },
  { name: "Da2", ratio: 5 / 3 },
  { name: "Ni2", ratio: 9 / 5 },
  { name: "Ni3", ratio: 15 / 8 },
  { name: "Sa↑", ratio: 2.0 }, // next Sa (for boundary)
];

/** Map frequency -> { swaraName, sthayi, cents }
 * - Normalizes freq to the nearest octave around Sa
 * - Finds nearest swarasthana by smallest cents difference
 * - Computes sthayi from octave offset
 */
function frequencyToCarnatic(freq, saFreq = SA_FREQ) {
  if (!freq || freq <= 0) return null;

  // relative ratio to Sa
  let rel = freq / saFreq;
  let octave = 0;
  // bring into [1, 2)
  while (rel < 1) {
    rel *= 2;
    octave -= 1;
  }
  while (rel >= 2) {
    rel /= 2;
    octave += 1;
  }

  // find nearest swara by cents distance
  let best = null;
  for (const sw of SWARAS) {
    const cents = 1200 * Math.log2(rel / sw.ratio); // + = sharp, - = flat
    const abs = Math.abs(cents);
    if (!best || abs < best.abs) best = { name: sw.name, cents, abs };
  }
  // choose sthayi name based on octave shift
  const sthayi =
    octave <= -2
      ? "Anumandra"
      : octave === -1
      ? "Mandra"
      : octave === 0
      ? "Madhya"
      : octave === 1
      ? "Tara"
      : "Athi Tara";

  // if nearest is the top "Sa↑", call it "Sa" but with sthayi one higher
  let swaraName = best.name;
  let sthayiAdj = sthayi;
  if (swaraName === "Sa↑") {
    swaraName = "Sa";
    // bump sthayi by one (since it's the upper Sa)
    sthayiAdj =
      sthayi === "Anumandra"
        ? "Mandra"
        : sthayi === "Mandra"
        ? "Madhya"
        : sthayi === "Madhya"
        ? "Tara"
        : "Athi Tara";
  }

  return {
    swaraName,
    sthayi: sthayiAdj,
    cents: Math.round(best.cents), // integer cents
  };
}

export default function UploadPitch() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [freq, setFreq] = useState(null);
  const [note, setNote] = useState(null); // {swaraName, sthayi, cents}
  const [audioURL, setAudioURL] = useState(null);

  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const chunksRef = useRef([]);
  const sampleRateRef = useRef(44100);

  async function start() {
    setStatus("Requesting mic…");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    const ACtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new ACtx();
    audioCtxRef.current = audioCtx;
    sampleRateRef.current = audioCtx.sampleRate;

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    chunksRef.current = [];
    processor.onaudioprocess = (e) => {
      const ch0 = e.inputBuffer.getChannelData(0);
      chunksRef.current.push(new Float32Array(ch0));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    setIsRecording(true);
    setStatus("Recording… Speak/sing, then click Stop & Analyze.");
  }

  async function stopAndUpload() {
    setIsRecording(false);
    setStatus("Processing…");

    try {
      processorRef.current.disconnect();
    } catch {}
    try {
      sourceRef.current.disconnect();
    } catch {}
    try {
      await audioCtxRef.current.close();
    } catch {}

    const chunks = chunksRef.current;
    const totalLen = chunks.reduce((a, b) => a + b.length, 0);
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const wavBlob = encodeWavMono(merged, sampleRateRef.current);
    setAudioURL(URL.createObjectURL(wavBlob));

    const form = new FormData();
    form.append("file", wavBlob, "recording.wav");

    try {
      const resp = await fetch("http://localhost:3000/pitch", {
        method: "POST",
        body: form,
      });
      const json = await resp.json();
      const f = json.frequency ?? null;
      setFreq(f);
      setStatus("Done");

      const mapping = frequencyToCarnatic(f, SA_FREQ);
      setNote(mapping);
    } catch (e) {
      console.error(e);
      setStatus("Upload failed");
      setFreq(null);
      setNote(null);
    }
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 16, maxWidth: 560 }}>
      <h2>Record & Analyze (Carnatic)</h2>
      <p style={{ opacity: 0.8 }}>{status}</p>

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={isRecording} onClick={start}>
          Start
        </button>
        <button disabled={!isRecording} onClick={stopAndUpload}>
          Stop & Analyze
        </button>
      </div>

      <div style={{ marginTop: 16, lineHeight: 1.6 }}>
        <div>
          <strong>Detected Frequency:</strong>{" "}
          {freq ? `${Math.round(freq)} Hz` : "—"}
        </div>
        <div>
          <strong>Sa (Madhya) set to:</strong> {SA_FREQ} Hz
        </div>
        <div>
          <strong>Nearest Shruti:</strong>{" "}
          {note ? `${note.swaraName} (${note.sthayi})` : "—"}
          {note && Math.abs(note.cents) <= 50
            ? `  (${note.cents >= 0 ? "+" : ""}${note.cents}¢)`
            : ""}
        </div>
      </div>

      {audioURL && (
        <div style={{ marginTop: 12 }}>
          <audio controls src={audioURL}></audio>
        </div>
      )}
    </div>
  );
}
