// index.js
const express = require("express"); // express → Web server framework
const multer = require("multer"); // multer → Middleware for handling multipart/form-data (file uploads)
const cors = require("cors"); // cors → Cross-Origin Resource Sharing from frontend port 5173 to backend port 3000
const { decode } = require("wav-decoder"); // wav-decoder → Decode WAV files
const Pitchfinder = require("pitchfinder"); // pitchfinder → Pitch detection algorithm (YIN in this case)

const app = express(); // Create an Express application
app.use(cors()); // Enable CORS for all routes

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() }); // Use memory storage for uploaded files

app.get("/", (req, res) => {
  res.send("Server running. POST /pitch with a WAV file."); // Simple route to check if server is running
});

app.post("/pitch", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" }); // Check if a file was uploaded

    // Decode the WAV file

    const audioData = await decode(req.file.buffer); // Decode the uploaded WAV file from buffer
    const samples = audioData.channelData[0]; // Use the first channel for pitch detection
    const sampleRate = audioData.sampleRate; // Get the sample rate from the audio data

    // Detect pitch using YIN algorithm
    const detectPitch = Pitchfinder.YIN({ sampleRate }); // Initialize YIN pitch detector with the sample rate
    const frequency = detectPitch(samples) || null; // Detect pitch from the audio samples

    // Return the detected frequency

    res.json({ frequency });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process audio" });
  }
});

const PORT = 3000; // Define the port to run the server
app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`)); // Start the server and listen on the defined port
