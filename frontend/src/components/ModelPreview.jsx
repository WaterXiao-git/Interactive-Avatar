import { Canvas } from "@react-three/fiber";
import { OrbitControls, useFBX } from "@react-three/drei";
import { useEffect } from "react";
import Experience from "./avatar/Experience";
import { toAbsoluteUrl } from "../lib/config";

function resolveAssetUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (String(pathOrUrl).startsWith("/assets/")) return toAbsoluteUrl(pathOrUrl);
  return pathOrUrl;
}

function joinActionPath(basePath, fileName) {
  const base = String(basePath || "").replace(/\/$/, "");
  const file = String(fileName || "").replace(/^\//, "");
  return `${base}/${file}`;
}

export default function ModelPreview({ modelUrl, actionBasePath = "/animations" }) {
  const idlePreviewUrl = resolveAssetUrl(joinActionPath(actionBasePath, "Standing Idle.fbx"));

  useEffect(() => {
    if (!idlePreviewUrl) return;
    useFBX.preload(idlePreviewUrl);
  }, [idlePreviewUrl]);

  return (
    <div className="model-preview">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0, -0.25, 9.6], fov: 23 }}
        style={{ height: "100%", width: "100%" }}
      >
        <color attach="background" args={["#edf7ff"]} />
        <ambientLight intensity={0.95} />
        <directionalLight position={[5, 10, 5]} intensity={1.35} />

        <Experience
          isWaving={false}
          setIsWaving={() => {}}
          isTalking={false}
          interruptSeq={0}
          isSessionActive={true}
          userSpeaking={false}
          previewAnimationName="Standing Idle.fbx"
          previewAnimationUrl={idlePreviewUrl}
          loadInteractionClips={false}
          avatarModelUrl={modelUrl}
          actionBasePath={actionBasePath}
          showBackdrop={false}
          showEnvironment={false}
        />

        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={2.2}
          maxDistance={14}
        />
      </Canvas>
    </div>
  );
}
