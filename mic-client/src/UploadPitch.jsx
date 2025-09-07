// src/UploadPitch.js
import { useRef, useState } from "react";

// Float32 -> 16-bit PCM
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

// Make a minimal mono WAV (16-bit PCM)
function encodeWavMono(samplesFloat32, sampleRate) {
  const pcmBuffer = floatTo16BitPCM(samplesFloat32);
  const wavBuffer = new ArrayBuffer(44 + pcmBuffer.byteLength);
  const view = new DataView(wavBuffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmBuffer.byteLength, true);
  writeString(view, 8, "WAVE");

  // fmt  subchunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono, 16-bit)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data subchunk
  writeString(view, 36, "data");
  view.setUint32(40, pcmBuffer.byteLength, true);

  // copy PCM
  new Uint8Array(wavBuffer, 44).set(new Uint8Array(pcmBuffer));
  return new Blob([wavBuffer], { type: "audio/wav" });
}

function writeString(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export default function UploadPitch() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [freq, setFreq] = useState(null);
  const [audioURL, setAudioURL] = useState(null);

  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const processorRef = useRef(null);
  const chunksRef = useRef([]); // Float32 chunks
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

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    audioCtxRef.current = audioCtx;
    sampleRateRef.current = audioCtx.sampleRate;

    const source = audioCtx.createMediaStreamSource(stream);
    sourceRef.current = source;

    // Use ScriptProcessor (simple, widely supported)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    chunksRef.current = [];

    processor.onaudioprocess = (e) => {
      // mono
      const ch0 = e.inputBuffer.getChannelData(0);
      // copy into our own Float32Array (detach from internal buffer)
      chunksRef.current.push(new Float32Array(ch0));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination); // required in some browsers
    setIsRecording(true);
    setStatus("Recording… Speak now (click Stop to analyze).");
  }

  async function stopAndUpload() {
    setIsRecording(false);
    setStatus("Processing…");

    // stop nodes
    try {
      processorRef.current.disconnect();
    } catch {}
    try {
      sourceRef.current.disconnect();
    } catch {}
    try {
      await audioCtxRef.current.close();
    } catch {}

    // merge Float32 chunks
    const chunks = chunksRef.current;
    const totalLen = chunks.reduce((a, b) => a + b.length, 0);
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    // encode mono 16-bit WAV
    const wavBlob = encodeWavMono(merged, sampleRateRef.current);
    setAudioURL(URL.createObjectURL(wavBlob)); // optional: playback

    // send to Node API
    const form = new FormData();
    form.append("file", wavBlob, "recording.wav");

    try {
      const resp = await fetch("http://localhost:3000/pitch", {
        method: "POST",
        body: form,
      });
      const json = await resp.json();
      setFreq(json.frequency ?? null);
      setStatus("Done");
    } catch (e) {
      console.error(e);
      setStatus("Upload failed");
    }
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 16, maxWidth: 520 }}>
      <h2>Record & Analyze (server)</h2>
      <p style={{ opacity: 0.8 }}>{status}</p>

      <div style={{ display: "flex", gap: 8 }}>
        <button disabled={isRecording} onClick={start}>
          Start
        </button>
        <button disabled={!isRecording} onClick={stopAndUpload}>
          Stop & Analyze
        </button>
      </div>

      <div style={{ marginTop: 16, fontSize: 24, fontWeight: 700 }}>
        {freq ? `${Math.round(freq)} Hz` : "—"}
      </div>

      {audioURL && (
        <div style={{ marginTop: 12 }}>
          <audio controls src={audioURL}></audio>
        </div>
      )}

      <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        Tip: Mic works on HTTPS or <code>localhost</code>.
      </p>
    </div>
  );
}
