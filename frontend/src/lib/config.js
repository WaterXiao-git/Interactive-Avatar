export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8788";

export function toAbsoluteUrl(pathOrUrl) {
  if (!pathOrUrl) {
    return "";
  }
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return `${API_BASE}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
