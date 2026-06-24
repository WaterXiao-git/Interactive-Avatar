export function findFirstSkinnedMesh(root) {
  if (!root) return null;
  let found = null;
  root.traverse((obj) => {
    if (!found && obj.isSkinnedMesh) found = obj;
  });
  return found;
}

export function normalizeTrackTarget(name) {
  const last = String(name).split("|").pop();
  return String(last).split(".")[0];
}

function isTrackType(trackName, type) {
  return String(trackName).toLowerCase().endsWith(`.${type.toLowerCase()}`);
}

function isHipsLikeTarget(target, rootBoneName = "mixamorigHips") {
  const value = String(target || "").toLowerCase();
  const root = String(rootBoneName || "").toLowerCase();
  if (value === root || value.endsWith(root)) {
    return true;
  }
  return /(?:^|[_\-])(?:hips|pelvis|root)$/.test(value) || /(hips|pelvis|root)$/.test(value);
}

function isLowerBodyTarget(target) {
  const value = String(target || "").toLowerCase();
  return /(upleg|thigh|leg|calf|shin|knee|foot|ankle|toe)/.test(value);
}

export function removeRootPositionTracks(clip, rootBoneName = "mixamorigHips") {
  if (!clip) return clip;
  const cloned = clip.clone();
  cloned.tracks = cloned.tracks.filter((track) => {
    const target = normalizeTrackTarget(track.name);
    return !(isTrackType(track.name, "position") && isHipsLikeTarget(target, rootBoneName));
  });
  return cloned;
}

export function removeLowerBodyTracks(
  clip,
  {
    removeHipsRotation = false,
    lowerBones = [
      "mixamorigLeftUpLeg",
      "mixamorigRightUpLeg",
      "mixamorigLeftLeg",
      "mixamorigRightLeg",
      "mixamorigLeftFoot",
      "mixamorigRightFoot",
      "mixamorigLeftToeBase",
      "mixamorigRightToeBase",
    ],
  } = {},
) {
  if (!clip) return clip;
  const cloned = clip.clone();
  const deny = new Set(lowerBones.map((name) => String(name).toLowerCase()));

  cloned.tracks = cloned.tracks.filter((track) => {
    const target = normalizeTrackTarget(track.name);
    const lowerByName = deny.has(String(target).toLowerCase());
    const lowerByPattern = isLowerBodyTarget(target);
    if (lowerByName || lowerByPattern) {
      return false;
    }
    if (removeHipsRotation && isTrackType(track.name, "quaternion") && isHipsLikeTarget(target)) {
      return false;
    }
    if (isTrackType(track.name, "scale")) {
      return false;
    }
    return true;
  });
  return cloned;
}

export function detectRootBoneName(root) {
  const skinned = findFirstSkinnedMesh(root);
  const bones = skinned?.skeleton?.bones || [];
  if (!bones.length) return "mixamorigHips";
  const byHint = bones.find((b) => /hips|pelvis/i.test(String(b.name || "")));
  return byHint?.name || bones[0].name || "mixamorigHips";
}

export function summarizeClipMatch({ clip, boneSet }) {
  if (!clip) {
    return { targets: [], hit: [], miss: [], rate: 0 };
  }
  const trackNames = clip.tracks.map((track) => track.name);
  const targets = Array.from(new Set(trackNames.map(normalizeTrackTarget)));
  const hit = targets.filter((target) => boneSet.has(target));
  const miss = targets.filter((target) => !boneSet.has(target));
  const rate = targets.length ? hit.length / targets.length : 0;
  return { targets, hit, miss, rate };
}

export function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + (item.weight || 0), 0);
  if (total <= 0) return items[0]?.key;
  let random = Math.random() * total;
  for (const item of items) {
    random -= item.weight || 0;
    if (random <= 0) return item.key;
  }
  return items[items.length - 1]?.key;
}
