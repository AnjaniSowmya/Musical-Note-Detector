// index.js
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { decode } = require("wav-decoder");
const Pitchfinder = require("pitchfinder");

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

// ---- Tunables ----
const MIN_F = 60; // Hz  (voices/instruments: raise/lower as you need)
const MAX_F = 1200; // Hz
const FRAME_SIZE = 2048; // samples per analysis frame (~46 ms @ 44.1 kHz)
const HOP_SIZE = 1024; // advance per step (50% overlap)
const RMS_GATE = 0.01; // ignore very quiet frames

// Small helpers
function rms(frame) {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / frame.length);
}
function removeDC(frame) {
  let mean = 0;
  for (let i = 0; i < frame.length; i++) mean += frame[i];
  mean /= frame.length;
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] - mean;
  return out;
}
function median(arr) {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

app.get("/", (_req, res) => {
  res.send("Server running. POST /pitch with form-data 'file' = WAV.");
});

app.post("/pitch", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const audioData = await decode(req.file.buffer); // { sampleRate, channelData: [Float32Array,...] }
    const samples = audioData.channelData[0]; // first channel
    const sampleRate = audioData.sampleRate;

    // Use AMDF with min/max constraints (robust & fast)
    const detect = Pitchfinder.AMDF({
      sampleRate,
      minFrequency: MIN_F,
      maxFrequency: MAX_F,
    });

    const pitches = [];
    let totalFrames = 0;
    let voicedFrames = 0;

    for (let i = 0; i + FRAME_SIZE <= samples.length; i += HOP_SIZE) {
      totalFrames++;
      let frame = samples.slice(i, i + FRAME_SIZE);

      // gate silence and DC
      frame = removeDC(frame);
      if (rms(frame) < RMS_GATE) continue;

      const f = detect(frame);
      if (f && f >= MIN_F && f <= MAX_F && Number.isFinite(f)) {
        pitches.push(f);
        voicedFrames++;
      }
    }

    const freq = median(pitches); // stable estimate
    const confidence = totalFrames ? voicedFrames / totalFrames : 0;

    res.json({
      frequency: freq ? Number(freq.toFixed(2)) : null,
      confidence: Number(confidence.toFixed(2)),
      framesAnalyzed: totalFrames,
      framesVoiced: voicedFrames,
    });
  } catch (err) {
    console.error("Pitch detection error:", err);
    res.status(500).json({ error: "Failed to process audio" });
  }
});

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`Pitch API listening on http://localhost:${PORT}`)
);
