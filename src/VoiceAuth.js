import React, { useEffect, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { Chart, registerables } from "chart.js";
import Meyda from "meyda";

Chart.register(...registerables);

const VoiceAuth = () => {
  const [audioContext, setAudioContext] = useState(null);
  const [mediaStreamSource, setMediaStreamSource] = useState(null);
  const [referenceVoice, setReferenceVoice] = useState(null);
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [mode, setMode] = useState("idle"); // "idle", "recording", "testing", "control"
  const [notification, setNotification] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [soundLevels, setSoundLevels] = useState([]);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const meydaRef = useRef(null);
  const collectedSamples = useRef([]);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    initAudio();
  }, []);

  const initAudio = async () => {
    if (audioContext) return; // Prevent multiple initializations

    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = context.createMediaStreamSource(stream);

      setAudioContext(context);
      setMediaStreamSource(source);
    } catch (err) {
      setNotification("❌ Microphone access denied! Please allow microphone access.");
      console.error("Microphone Error:", err);
    }
  };

  const startRecording = async () => {
    await initAudio();
    setNotification("Recording... Please speak continuously.");
    setMode("recording");
    collectedSamples.current = [];
    setCountdown(10);
    setSoundLevels([]);

    startListening((mfcc, volume) => {
      collectedSamples.current.push(mfcc);
      setSoundLevels((prev) => [...prev.slice(-50), volume]);
    });

    const mediaRecorder = new MediaRecorder(mediaStreamSource.mediaStream);
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
      setRecordedAudio(URL.createObjectURL(audioBlob));
    };

    mediaRecorder.start();

    let timeLeft = 10;
    const interval = setInterval(() => {
      timeLeft -= 1;
      setCountdown(timeLeft);
      if (timeLeft === 0) {
        clearInterval(interval);
        stopRecording();
      }
    }, 1000);
  };

  const stopRecording = () => {
    if (meydaRef.current) meydaRef.current.stop();
    if (mediaRecorderRef.current) mediaRecorderRef.current.stop();

    if (collectedSamples.current.length > 0) {
      const avgProfile = calculateAverageMFCC(collectedSamples.current);
      setReferenceVoice(avgProfile);
      setNotification("Recording completed! You can replay it before proceeding.");
      setMode("testing");
    } else {
      setNotification("Error: No voice data captured. Try again.");
      setMode("idle");
    }
  };

  const startListening = (callback) => {
    if (!audioContext || !mediaStreamSource) {
      console.warn("AudioContext or MediaStreamSource not initialized.");
      return;
    }

    if (meydaRef.current) {
      meydaRef.current.stop();
    }

    try {
      meydaRef.current = Meyda.createMeydaAnalyzer({
        audioContext,
        source: mediaStreamSource, // Correct source for Meyda
        bufferSize: 512,
        featureExtractors: ["mfcc", "rms"],
        callback: (features) => {
          if (features && features.mfcc && features.rms) {
            callback(features.mfcc, features.rms * 100);
          }
        },
      });

      meydaRef.current.start();
    } catch (error) {
      console.error("Meyda Analyzer Error:", error);
    }
  };

  const calculateAverageMFCC = (samples) => {
    const numFeatures = samples[0].length;
    const numSamples = samples.length;
    const avgMFCC = new Array(numFeatures).fill(0);

    samples.forEach((sample) => {
      sample.forEach((value, index) => {
        avgMFCC[index] += value / numSamples;
      });
    });

    return avgMFCC;
  };

  const startVoiceControl = () => {
    if (!referenceVoice) {
      setNotification("Error: No speaker voice recorded. Please scan the speaker first.");
      return;
    }

    setNotification("Voice control mode active. Only the scanned speaker is allowed to speak.");
    setMode("control");

    startListening((mfcc) => {
      const similarity = cosineSimilarity(referenceVoice, mfcc);

      if (similarity < 0.8) {
        playAlert();
        setIsAuthorized(false);
        setNotification("❌ Unauthorized speaker detected!");
      } else {
        setIsAuthorized(true);
        setNotification("✅ Speaker recognized. All good!");
      }
    });
  };

  const cosineSimilarity = (vecA, vecB) => {
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const magA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
    const magB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
    return dotProduct / (magA * magB);
  };

  const playAlert = () => {
    const alertSound = new Audio("/alert.mp3");
    alertSound.play();
  };

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h1>AI Voice Authentication</h1>
      <p>Status: {mode === "idle" ? "Waiting for action..." : notification}</p>

      {mode === "idle" && (
        <button onClick={startRecording} style={{ margin: "10px", padding: "10px" }}>
          Scan Speaker Voice
        </button>
      )}

      {mode === "recording" && <h2>Recording... {countdown} seconds left</h2>}

      {mode === "testing" && recordedAudio && (
        <>
          <h3>Replay Recorded Voice</h3>
          <audio controls>
            <source src={recordedAudio} type="audio/wav" />
          </audio>
          <button onClick={startVoiceControl} style={{ margin: "10px", padding: "10px" }}>
            Start Voice Control Mode
          </button>
        </>
      )}

      {mode === "control" && (
        <button onClick={() => setMode("idle")} style={{ margin: "10px", padding: "10px" }}>
          Stop Voice Control
        </button>
      )}

      <h2 style={{ color: isAuthorized ? "green" : "red" }}>
        {isAuthorized ? "✅ Speaker Allowed" : "❌ Unauthorized Speaker Detected!"}
      </h2>

      {soundLevels.length > 0 && (
        <div style={{ width: "400px", margin: "auto" }}>
          <Line
            data={{
              labels: soundLevels.map((_, i) => i),
              datasets: [{ label: "Sound Level", data: soundLevels, borderColor: "blue", borderWidth: 2 }],
            }}
          />
        </div>
      )}
    </div>
  );
};

export default VoiceAuth;
