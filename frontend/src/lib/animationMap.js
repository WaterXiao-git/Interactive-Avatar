import { toAbsoluteUrl } from "./config";

function pickByRegex(items, pattern) {
  return items.find((item) => pattern.test(`${item.file_name} ${item.display_name}`));
}

function resolveUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (String(path).startsWith("/assets/")) return toAbsoluteUrl(path);
  return path;
}

export function buildActionMap(items = [], fallbackBasePath = "/animations") {
  const safe = Array.isArray(items) ? items : [];
  const wave = pickByRegex(safe, /wave|waving/i);
  const listening = pickByRegex(safe, /listen|listening/i);
  const talking1 = pickByRegex(safe, /talking\s*1|talk1|speak1/i);
  const talking2 = pickByRegex(safe, /talking\s*2|talk2|speak2/i);
  const talking3 = pickByRegex(safe, /talking\s*3|talk3|speak3/i);
  const idle = pickByRegex(safe, /standing\s*idle|\bidle\b|stand/i);

  return {
    idle: resolveUrl(idle?.file_url || `${fallbackBasePath}/Standing Idle.fbx`),
    wave: resolveUrl(wave?.file_url || `${fallbackBasePath}/Waving.fbx`),
    listening: resolveUrl(listening?.file_url || `${fallbackBasePath}/Listening.fbx`),
    talking1: resolveUrl(talking1?.file_url || `${fallbackBasePath}/Talking1.fbx`),
    talking2: resolveUrl(talking2?.file_url || `${fallbackBasePath}/Talking2.fbx`),
    talking3: resolveUrl(talking3?.file_url || `${fallbackBasePath}/Talking3.fbx`),
  };
}
