import { API_BASE } from "./config";
import { getToken } from "./auth";

function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || "Request failed");
  }
  return data;
}

export async function authRegister(username, password) {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJson(response);
}

export async function authLogin(username, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJson(response);
}

export async function authMe() {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: authHeaders(),
  });
  return parseJson(response);
}

export async function listPresets() {
  const response = await fetch(`${API_BASE}/presets`);
  return parseJson(response);
}

export async function createFromPreset(presetName) {
  const response = await fetch(`${API_BASE}/pipeline/preset`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ preset_name: presetName }),
  });
  return parseJson(response);
}

export async function createFromText(prompt) {
  const response = await fetch(`${API_BASE}/pipeline/text`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prompt }),
  });
  return parseJson(response);
}

export async function createFromImage(file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE}/pipeline/image`, {
    method: "POST",
    headers: authHeaders(),
    body,
  });
  return parseJson(response);
}

export async function saveModel(payload) {
  const response = await fetch(`${API_BASE}/models/save`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}

export async function myModels({ page = 1, pageSize = 20 } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  const response = await fetch(`${API_BASE}/models/my?${params.toString()}`, {
    headers: authHeaders(),
  });
  return parseJson(response);
}

export async function myHistory({ q = "", start = "", end = "", page = 1, pageSize = 20 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  const response = await fetch(`${API_BASE}/history/my?${params.toString()}`, {
    headers: authHeaders(),
  });
  return parseJson(response);
}

export async function getHistoryDetail(sessionId) {
  const response = await fetch(`${API_BASE}/history/${sessionId}`, {
    headers: authHeaders(),
  });
  return parseJson(response);
}

export async function startRig(payload) {
  const response = await fetch(`${API_BASE}/pipeline/rig`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}

export async function getRigStatus(taskId) {
  const response = await fetch(`${API_BASE}/pipeline/rig/${taskId}`);
  return parseJson(response);
}

export async function listAnimations(presetName = "") {
  const params = new URLSearchParams();
  if (presetName) params.set("preset_name", presetName);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE}/animations${suffix}`);
  return parseJson(response);
}

export async function retryPipeline(payload) {
  const response = await fetch(`${API_BASE}/pipeline/retry`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}
