import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { FaceLandmarker, FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

export default function GestureDetector({ onGreet, onLeave, isSessionActive }) {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const gestureRecognizer = useRef(null);
  const faceLandmarker = useRef(null);
  const requestRef = useRef(null);

  const localLockedRef = useRef(false);
  const greetedOnceRef = useRef(false);
  const lastSeenPersonTime = useRef(0);

  const [modelLoaded, setModelLoaded] = useState(false);
  const [debugStatus, setDebugStatus] = useState("未检测到手");

  const waveState = useRef({
    prevX: 0,
    prevDirection: 0,
    inflectionCounts: 0,
    lastInflectionTime: 0,
    lastOpenPalmTime: 0,
  });

  const isCoolingDown = useRef(false);

  useEffect(() => {
    const loadModel = async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm",
      );

      gestureRecognizer.current = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/gesture_recognizer.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 1,
      });

      faceLandmarker.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });

      setModelLoaded(true);
    };

    loadModel();
  }, []);

  useEffect(() => {
    if (!isSessionActive) {
      localLockedRef.current = false;
      greetedOnceRef.current = false;
      waveState.current.inflectionCounts = 0;
      waveState.current.prevDirection = 0;
    }
  }, [isSessionActive]);

  const drawSkeleton = (ctx, landmarks, width, height) => {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#21a6ff";
    ctx.lineWidth = 2;
    ctx.fillStyle = "#00c896";

    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-width, 0);

    HAND_CONNECTIONS.forEach(([start, end]) => {
      const p1 = landmarks[start];
      const p2 = landmarks[end];
      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    });

    landmarks.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 4, 0, 2 * Math.PI);
      ctx.fill();
    });

    ctx.restore();
  };

  const detectWaveAction = (wristX, categoryName) => {
    const now = Date.now();
    const state = waveState.current;

    if (categoryName === "Open_Palm") {
      state.lastOpenPalmTime = now;
    }

    const isTechnicallyOpenPalm = now - state.lastOpenPalmTime < 500;

    if (!isTechnicallyOpenPalm) {
      if (now - state.lastInflectionTime > 1000) {
        state.inflectionCounts = 0;
        state.prevDirection = 0;
      }
      state.prevX = wristX;
      return false;
    }

    const velocity = wristX - state.prevX;
    if (Math.abs(velocity) > 0.01) {
      const currentDirection = velocity > 0 ? 1 : -1;
      if (state.prevDirection !== 0 && currentDirection !== state.prevDirection) {
        state.inflectionCounts += 1;
        state.lastInflectionTime = now;
      }
      state.prevDirection = currentDirection;
    }

    state.prevX = wristX;

    if (state.inflectionCounts >= 3 && !isCoolingDown.current) {
      if (now - state.lastInflectionTime < 1000) return true;
      state.inflectionCounts = 0;
    }

    return false;
  };

  const clearCanvas = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const predict = () => {
    const locked = isSessionActive || localLockedRef.current;

    if (locked) {
      setDebugStatus("会话中（检测在场）");
      clearCanvas();

      if (webcamRef.current?.video?.readyState === 4) {
        const video = webcamRef.current.video;
        const now = Date.now();
        let seen = false;

        if (faceLandmarker.current) {
          const faceResults = faceLandmarker.current.detectForVideo(video, now);
          if (faceResults?.faceLandmarks?.length > 0) seen = true;
        }

        if (!seen && gestureRecognizer.current) {
          const handResults = gestureRecognizer.current.recognizeForVideo(video, now);
          if (handResults?.landmarks?.length > 0) seen = true;
        }

        if (seen) {
          lastSeenPersonTime.current = now;
        } else if (lastSeenPersonTime.current && now - lastSeenPersonTime.current > 10000) {
          onLeave?.();
        }
      }

      requestRef.current = requestAnimationFrame(predict);
      return;
    }

    if (webcamRef.current?.video?.readyState === 4 && gestureRecognizer.current) {
      const video = webcamRef.current.video;
      const { videoWidth, videoHeight } = video;

      if (canvasRef.current) {
        canvasRef.current.width = videoWidth;
        canvasRef.current.height = videoHeight;
      }

      const results = gestureRecognizer.current.recognizeForVideo(video, Date.now());

      if (results.gestures?.length > 0 && results.landmarks?.length > 0) {
        const gesture = results.gestures[0][0];
        const landmarks = results.landmarks[0];
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) drawSkeleton(ctx, landmarks, videoWidth, videoHeight);

        const wristX = landmarks[0].x;
        const wristY = landmarks[0].y;
        const isCenter = wristX > 0.15 && wristX < 0.85;
        const isHighEnough = wristY < 0.8;

        let statusMsg = `动作:${gesture.categoryName} | 摆动:${waveState.current.inflectionCounts}`;
        if (!isCenter) statusMsg = "位置偏离";
        if (!isHighEnough) statusMsg = "请举起手";
        setDebugStatus(statusMsg);

        if (isCenter && isHighEnough) {
          const isWaving = detectWaveAction(wristX, gesture.categoryName);
          if (isWaving && !greetedOnceRef.current) {
            greetedOnceRef.current = true;
            localLockedRef.current = true;
            clearCanvas();
            onGreet?.();
            waveState.current.inflectionCounts = 0;
            isCoolingDown.current = true;
            setTimeout(() => {
              isCoolingDown.current = false;
            }, 4000);
          }
        }
      } else {
        setDebugStatus("未检测到手");
        if (Date.now() - waveState.current.lastInflectionTime > 1000) {
          waveState.current.inflectionCounts = 0;
        }
        clearCanvas();
      }
    }

    requestRef.current = requestAnimationFrame(predict);
  };

  useEffect(() => {
    if (!modelLoaded) return undefined;
    requestRef.current = requestAnimationFrame(predict);
    return () => cancelAnimationFrame(requestRef.current);
  }, [modelLoaded]);

  return (
    <div className="gesture-widget">
      <div className="gesture-camera-wrap">
        <Webcam
          ref={webcamRef}
          style={{
            width: "100%",
            borderRadius: "10px",
            opacity: isSessionActive || localLockedRef.current ? 0.24 : 1,
            display: "block",
          }}
          mirrored
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>
      <div className="gesture-caption">{isSessionActive || localLockedRef.current ? "会话中..." : debugStatus}</div>
    </div>
  );
}
