import { Environment } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import Avatar from "./Avatar";
import { TEXTURE_PATH } from "./constant";

export default function Experience({
  isWaving,
  setIsWaving,
  isTalking,
  interruptSeq,
  isSessionActive,
  userSpeaking,
  previewAnimationName,
  previewAnimationUrl,
  loadInteractionClips = true,
  avatarModelUrl,
  actionBasePath,
  backdropTexturePath,
  showBackdrop = true,
  showEnvironment = false,
}) {
  const scene = useThree((state) => state.scene);
  const avatarPosition = previewAnimationName ? [0, -1.3, 2] : [0, -1.3, 2];
  const [backdropTexture, setBackdropTexture] = useState(null);

  const textureUrl = useMemo(() => backdropTexturePath || TEXTURE_PATH, [backdropTexturePath]);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();

    const applyTexture = (texture) => {
      if (cancelled || !texture) return;
      texture.colorSpace = THREE.SRGBColorSpace;
      setBackdropTexture(texture);
    };

    loader.load(
      textureUrl,
      (texture) => applyTexture(texture),
      undefined,
      () => {
        if (textureUrl === TEXTURE_PATH) {
          if (!cancelled) setBackdropTexture(null);
          return;
        }
        loader.load(
          TEXTURE_PATH,
          (texture) => applyTexture(texture),
          undefined,
          () => {
            if (!cancelled) setBackdropTexture(null);
          },
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [textureUrl]);

  useEffect(() => {
    if (!showBackdrop) {
      scene.background = null;
      return;
    }
    scene.background = backdropTexture || null;
    return () => {
      if (scene.background === backdropTexture) {
        scene.background = null;
      }
    };
  }, [scene, backdropTexture, showBackdrop]);

  return (
    <>
      <Avatar
        position={avatarPosition}
        scale={3}
        isWaving={isWaving}
        setIsWaving={setIsWaving}
        isTalking={isTalking}
        interruptSeq={interruptSeq}
        isSessionActive={isSessionActive}
        userSpeaking={userSpeaking}
        previewAnimationName={previewAnimationName}
        previewAnimationUrl={previewAnimationUrl}
        loadInteractionClips={loadInteractionClips}
        avatarModelUrl={avatarModelUrl}
        actionBasePath={actionBasePath}
      />

      {showEnvironment ? <Environment preset="sunset" /> : null}
    </>
  );
}
