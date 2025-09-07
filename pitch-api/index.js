// index.js
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { decode } = require("wav-decoder");
const Pitchfinder = require("pitchfinder");

const app = express();
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => {
  res.send("Server running. POST /pitch with a WAV file.");
});

app.post("/pitch", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const audioData = await decode(req.file.buffer);
    const samples = audioData.channelData[0];
    const sampleRate = audioData.sampleRate;

    const detectPitch = Pitchfinder.YIN({ sampleRate });
    const frequency = detectPitch(samples) || null;

    res.json({ frequency });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process audio" });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
