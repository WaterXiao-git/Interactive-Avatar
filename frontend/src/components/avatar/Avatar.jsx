import { useEffect, useMemo, useRef } from "react";
import { useFBX, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import {
  detectRootBoneName,
  findFirstSkinnedMesh,
  removeLowerBodyTracks,
  removeRootPositionTracks,
  summarizeClipMatch,
  weightedPick,
} from "./avatarFbxUtils";
import { createAvatarFbxController } from "./avatarFbxController";
import { toAbsoluteUrl } from "../../lib/config";

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

const NOOP = () => {};

export function Avatar({
  isWaving = false,
  setIsWaving = () => {},
  isTalking = false,
  interruptSeq = 0,
  isSessionActive = false,
  userSpeaking = false,
  previewAnimationName = "",
  previewAnimationUrl = "",
  onPreviewApplied = NOOP,
  loadInteractionClips = true,
  avatarModelUrl = "/models/avatar.fbx",
  actionBasePath = "/animations",
  ...threeProps
}) {
  const group = useRef();
  const resolvedModel = resolveAssetUrl(avatarModelUrl);
  const modelPath = /\.fbx(\?|$)/i.test(resolvedModel || "") ? resolvedModel : "/models/avatar.fbx";
  const model = useFBX(modelPath);
  const rootBoneName = useMemo(() => detectRootBoneName(model), [model]);
  const previewMode = Boolean(previewAnimationName);
  const fitTransform = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const safeHeight = Math.max(size.y, 0.0001);
    const targetHeight = previewMode ? 0.82 : 0.84;
    const scale = targetHeight / safeHeight;
    return {
      scale,
      position: [-center.x * scale, -box.min.y * scale, -center.z * scale],
    };
  }, [model, previewMode]);

  const idleUrl = resolveAssetUrl(joinActionPath(actionBasePath, "Standing Idle.fbx"));
  const waveUrl = resolveAssetUrl(
    joinActionPath(actionBasePath, loadInteractionClips ? "Waving.fbx" : "Standing Idle.fbx"),
  );
  const talking1Url = resolveAssetUrl(
    joinActionPath(actionBasePath, loadInteractionClips ? "Talking1.fbx" : "Standing Idle.fbx"),
  );
  const talking2Url = resolveAssetUrl(
    joinActionPath(actionBasePath, loadInteractionClips ? "Talking2.fbx" : "Standing Idle.fbx"),
  );
  const talking3Url = resolveAssetUrl(
    joinActionPath(actionBasePath, loadInteractionClips ? "Talking3.fbx" : "Standing Idle.fbx"),
  );
  const listeningUrl = resolveAssetUrl(
    joinActionPath(actionBasePath, loadInteractionClips ? "Listening.fbx" : "Standing Idle.fbx"),
  );
  const globalIdleUrl = resolveAssetUrl("/animations/Standing Idle.fbx");
  const fallbackPreviewUrl = resolveAssetUrl(previewAnimationUrl || idleUrl);
  const previewActionName = useMemo(() => {
    const seed = `${previewAnimationName}|${fallbackPreviewUrl}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return `Preview_${Math.abs(hash).toString(36)}`;
  }, [previewAnimationName, fallbackPreviewUrl]);

  const idleFbx = useFBX(idleUrl);
  const waveFbx = useFBX(waveUrl);
  const talk1Fbx = useFBX(talking1Url);
  const talk2Fbx = useFBX(talking2Url);
  const talk3Fbx = useFBX(talking3Url);
  const listeningFbx = useFBX(listeningUrl);
  const globalIdleFbx = useFBX(globalIdleUrl);
  const previewFbx = useFBX(fallbackPreviewUrl);

  const TALK_WEIGHTS = useMemo(
    () => [
      { key: "Talking1", weight: 0.4 },
      { key: "Talking2", weight: 0.4 },
      { key: "Talking3", weight: 0.2 },
    ],
    [],
  );

  const clips = useMemo(() => {
    const out = [];
    const add = (clip, name) => {
      if (!clip) return;
      const cleaned = removeRootPositionTracks(clip, rootBoneName);
      cleaned.name = name;
      out.push(cleaned);
    };
    const addUpperBody = (clip, name) => {
      if (!clip) return;
      const noRoot = removeRootPositionTracks(clip, rootBoneName);
      const upper = removeLowerBodyTracks(noRoot, { removeHipsRotation: true });
      upper.name = name;
      out.push(upper);
    };
    add(idleFbx?.animations?.[0], "Idle");
    if (previewMode) {
      const hint = String(previewAnimationName || previewAnimationUrl || "");
      const rawPreview = previewFbx?.animations?.[0];

      if (rawPreview) {
        let previewClip = removeRootPositionTracks(rawPreview, rootBoneName);
        if (!/idle|standing/i.test(hint)) {
          previewClip = removeLowerBodyTracks(previewClip, { removeHipsRotation: true });
        }

        if (/idle|standing/i.test(hint) && globalIdleFbx?.animations?.[0]) {
          const skinned = findFirstSkinnedMesh(model);
          const boneSet = new Set((skinned?.skeleton?.bones || []).map((bone) => bone.name));
          const previewMatch = summarizeClipMatch({ clip: previewClip, boneSet });

          const globalIdleClip = removeRootPositionTracks(globalIdleFbx.animations[0], rootBoneName);
          const globalMatch = summarizeClipMatch({ clip: globalIdleClip, boneSet });

          const previewWeak = previewClip.tracks.length < 6 || previewMatch.rate < 0.45;
          const globalStrong = globalIdleClip.tracks.length >= previewClip.tracks.length || globalMatch.rate >= 0.6;

          if (previewWeak && globalStrong) {
            previewClip = globalIdleClip;
          }
        }

        previewClip.name = previewActionName;
        out.push(previewClip);
      }
      return out;
    }

    addUpperBody(waveFbx?.animations?.[0], "Wave");
    addUpperBody(talk1Fbx?.animations?.[0], "Talking1");
    addUpperBody(talk2Fbx?.animations?.[0], "Talking2");
    addUpperBody(talk3Fbx?.animations?.[0], "Talking3");
    addUpperBody(listeningFbx?.animations?.[0], "Listening");
    return out;
  }, [
    idleFbx,
    previewMode,
    previewAnimationName,
    waveFbx,
    talk1Fbx,
    talk2Fbx,
    talk3Fbx,
    listeningFbx,
    globalIdleFbx,
    previewFbx,
    previewAnimationUrl,
    previewActionName,
    rootBoneName,
  ]);

  const { actions, mixer } = useAnimations(clips, group);
  const ctrlRef = useRef(null);

  useEffect(() => {
    if (!model) return;
    model.traverse((obj) => {
      if (!obj?.isMesh || !obj.material) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((material) => {
        if (!material) return;
        material.transparent = false;
        material.opacity = 1;
        material.depthWrite = true;
        material.needsUpdate = true;
      });
    });
  }, [model]);

  useEffect(() => {
    if (previewMode) {
      ctrlRef.current?.dispose?.();
      ctrlRef.current = null;
      return undefined;
    }
    if (!actions) return undefined;
    ctrlRef.current = createAvatarFbxController({
      actions,
      mixer,
      setIsWaving,
      setIsWavingExternal: setIsWaving,
      TALK_WEIGHTS,
      weightedPick,
    });
    return () => {
      ctrlRef.current?.dispose?.();
      ctrlRef.current = null;
    };
  }, [actions, mixer, setIsWaving, TALK_WEIGHTS, previewMode]);

  useEffect(() => {
    if (!previewMode || !actions) return;
    mixer?.stopAllAction();

    Object.entries(actions).forEach(([key, action]) => {
      if (!action) return;
      if (key !== "Idle" && key !== previewActionName) {
        action.stop();
        action.enabled = false;
      }
    });

    const preview = actions[previewActionName];
    const hasPreview = Boolean(preview);

    const idle = actions.Idle;
    if (idle) {
      idle.enabled = true;
      idle.paused = false;
      idle.setLoop(THREE.LoopRepeat, Infinity);
      idle.clampWhenFinished = false;
      idle.reset();
      idle.setEffectiveWeight(hasPreview ? 0 : 1);
      idle.setEffectiveTimeScale(1);
      idle.play();
    }

    if (!preview) {
      return;
    }
    preview.enabled = true;
    preview.paused = false;
    preview.setLoop(THREE.LoopRepeat, Infinity);
    preview.clampWhenFinished = false;
    preview.reset();
    preview.setEffectiveWeight(1);
    preview.setEffectiveTimeScale(1);
    preview.play();
    onPreviewApplied(previewAnimationName || previewActionName);
  }, [actions, previewMode, previewAnimationName, previewActionName, mixer, onPreviewApplied]);

  useEffect(() => {
    if (previewMode) return;
    if (!ctrlRef.current) return;
    ctrlRef.current.update({
      isWaving,
      isTalking,
      interruptSeq,
      userSpeaking,
    });
  }, [isWaving, isTalking, interruptSeq, userSpeaking, previewMode]);

  useEffect(() => {
    const skinned = findFirstSkinnedMesh(model);
    const bones = skinned?.skeleton?.bones || [];
    const boneSet = new Set(bones.map((bone) => bone.name));
    const names = previewMode
      ? ["Idle", previewActionName]
      : ["Idle", "Wave", "Listening", "Talking1", "Talking2", "Talking3"];

    names.forEach((name) => {
      summarizeClipMatch({
        clip: clips.find((clipItem) => clipItem.name === name),
        boneSet,
      });
    });
  }, [model, actions, clips, previewMode, previewActionName]);

  useEffect(() => {
    if (previewMode) return;
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    if (!isSessionActive) {
      ctrl.endSessionNow?.();
      return;
    }
    ctrl.beginSessionNow?.();
    ctrl.update?.({
      isWaving,
      isTalking,
      interruptSeq,
      userSpeaking,
    });
  }, [isSessionActive, previewMode]);

  return (
    <group ref={group} {...threeProps}>
      <group position={fitTransform.position} scale={fitTransform.scale}>
        <primitive object={model} />
      </group>
    </group>
  );
}

export default Avatar;
