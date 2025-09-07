// src/UploadPitch.js
import { useRef, useState } from "react"; // React hooks

// Convert Float32Array [-1..1] to 16-bit PCM
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2); // 2 bytes per sample
  const view = new DataView(buffer); // DataView to set 16-bit values
  let offset = 0; // byte offset
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    // 2 bytes per sample
    let s = Math.max(-1, Math.min(1, float32Array[i])); // clamp
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true); // little-endian
  }
  return buffer; // return ArrayBuffer
}

// Make a minimal mono WAV (16-bit PCM)
function encodeWavMono(samplesFloat32, sampleRate) {
  // samplesFloat32: Float32Array
  const pcmBuffer = floatTo16BitPCM(samplesFloat32); // Convert to 16-bit PCM
  const wavBuffer = new ArrayBuffer(44 + pcmBuffer.byteLength); // WAV header is 44 bytes
  const view = new DataView(wavBuffer); // DataView to set header fields

  // RIFF header
  writeString(view, 0, "RIFF"); // ChunkID
  view.setUint32(4, 36 + pcmBuffer.byteLength, true); // ChunkSize
  writeString(view, 8, "WAVE"); // Format

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
  writeString(view, 36, "data"); // Subchunk2ID
  view.setUint32(40, pcmBuffer.byteLength, true); // Subchunk2Size

  // copy PCM
  new Uint8Array(wavBuffer, 44).set(new Uint8Array(pcmBuffer)); // copy PCM data after header
  return new Blob([wavBuffer], { type: "audio/wav" }); // return WAV as Blob
}

function writeString(view, offset, text) {
  // helper to write ASCII strings to DataView
  for (let i = 0; i < text.length; i++) {
    // for each character
    view.setUint8(offset + i, text.charCodeAt(i)); // write char code
  }
}

export default function UploadPitch() {
  // React component
  const [isRecording, setIsRecording] = useState(false); // Recording state
  const [status, setStatus] = useState("Idle"); // Status message
  const [freq, setFreq] = useState(null); // Detected frequency
  const [audioURL, setAudioURL] = useState(null); // Audio playback URL

  const audioCtxRef = useRef(null); // AudioContext reference
  const sourceRef = useRef(null); // MediaStreamAudioSourceNode reference
  const processorRef = useRef(null); // ScriptProcessorNode reference
  const chunksRef = useRef([]); // Float32 chunks
  const sampleRateRef = useRef(44100); // Sample rate

  async function start() {
    // Start recording
    setStatus("Requesting mic…"); // Update status
    const stream = await navigator.mediaDevices.getUserMedia({
      // Request mic access
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }, // audio only
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext; // cross-browser
    const audioCtx = new AudioCtx(); // Create AudioContext
    audioCtxRef.current = audioCtx; // store in ref
    sampleRateRef.current = audioCtx.sampleRate; // store sample rate

    const source = audioCtx.createMediaStreamSource(stream); // Create MediaStream source
    sourceRef.current = source; // store in ref

    // Use ScriptProcessor (simple, widely supported) or AudioWorklet (modern, more complex)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1); // bufferSize, inCh, outCh
    processorRef.current = processor; // store in ref

    chunksRef.current = []; // reset chunks

    processor.onaudioprocess = (e) => {
      // mono
      const ch0 = e.inputBuffer.getChannelData(0);
      // copy into our own Float32Array (detach from internal buffer)
      chunksRef.current.push(new Float32Array(ch0));
    };

    source.connect(processor); // connect source to processor
    processor.connect(audioCtx.destination); // required in some browsers
    setIsRecording(true); // update state
    setStatus("Recording… Speak now (click Stop to analyze)."); // update status
  }

  async function stopAndUpload() {
    setIsRecording(false); // update state
    setStatus("Processing…"); // update status

    // stop nodes
    try {
      processorRef.current.disconnect(); // stop processing
    } catch {}
    try {
      sourceRef.current.disconnect(); // stop source
    } catch {}
    try {
      await audioCtxRef.current.close(); // close AudioContext
    } catch {}

    // merge Float32 chunks
    const chunks = chunksRef.current; // get chunks
    const totalLen = chunks.reduce((a, b) => a + b.length, 0); // total length
    const merged = new Float32Array(totalLen); // merged array
    let offset = 0; // current offset
    for (const c of chunks) {
      // for each chunk
      merged.set(c, offset); // copy chunk
      offset += c.length; // update offset
    }

    // encode mono 16-bit WAV
    const wavBlob = encodeWavMono(merged, sampleRateRef.current); // encode to WAV
    setAudioURL(URL.createObjectURL(wavBlob)); // optional: playback

    // send to Node API
    const form = new FormData(); // create form data
    form.append("file", wavBlob, "recording.wav"); // append WAV file

    try {
      const resp = await fetch("http://localhost:3000/pitch", {
        method: "POST",
        body: form,
      }); // send to backend
      const json = await resp.json(); // parse JSON
      setFreq(json.frequency ?? null); // update frequency
      setStatus("Done"); // update status
    } catch (e) {
      console.error(e);
      setStatus("Upload failed"); // update status
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
