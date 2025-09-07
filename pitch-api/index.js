// index.js
const express = require("express"); // express → Web server framework
const multer = require("multer"); // multer → Middleware for handling multipart/form-data (file uploads)
const cors = require("cors"); // cors → Cross-Origin Resource Sharing (frontend:5173 → backend:3000)
const { decode } = require("wav-decoder"); // wav-decoder → Decode WAV files
const Pitchfinder = require("pitchfinder"); // pitchfinder → Pitch detection algorithm (YIN)

const app = express();
app.use(cors()); // Enable CORS for all routes

// Configure multer for file uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Health check route
app.get("/", (req, res) => {
  res.send("Server running. POST /pitch with a WAV file.");
});

app.post("/pitch", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Decode WAV
    const audioData = await decode(req.file.buffer);
    const samples = audioData.channelData[0]; // first channel (mono/stereo)
    const sampleRate = audioData.sampleRate;

    // YIN detector
    const detectPitch = Pitchfinder.YIN({ sampleRate });

    // Analyze in frames (better than whole file)
    const frameSize = 2048;
    let detected = null;

    for (let i = 0; i + frameSize <= samples.length; i += frameSize) {
      const frame = samples.slice(i, i + frameSize);
      const f = detectPitch(frame);
      if (f) {
        detected = f;
        break; // take the first non-null pitch found
      }
    }

    res.json({ frequency: detected });
  } catch (err) {
    console.error("Pitch detection error:", err);
    res.status(500).json({ error: "Failed to process audio" });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
