import axios from "axios";

const BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");

export function assertApiConfigured() {
  if (!BACKEND_URL) {
    throw new Error(
      "REACT_APP_BACKEND_URL is not set. Leads and uploads cannot reach the API."
    );
  }
}

export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";
const TOKEN_KEY = "fg_admin_token";

// Render free tier can cold-start ~30–50s; leave headroom for lead POST.
export const client = axios.create({ baseURL: API, timeout: 60000 });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Public
export async function submitLead(payload) {
  assertApiConfigured();
  const { data } = await client.post("/leads", payload);
  return data;
}
export async function uploadPhoto(file) {
  assertApiConfigured();
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await client.post("/upload", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
export const fileUrl = (pathOrUrl) => {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return `${API}/files/${pathOrUrl}`;
};
export async function submitGuide(payload) {
  assertApiConfigured();
  const { data } = await client.post("/guide", payload);
  return data;
}
export const guideDownloadUrl = `${API}/guide/download`;

// Auth
export async function login(email, password) {
  assertApiConfigured();
  const { data } = await client.post("/auth/login", { email, password });
  setToken(data.token);
  return data.user;
}
export async function getMe() {
  assertApiConfigured();
  const { data } = await client.get("/auth/me");
  return data;
}
export function logout() {
  clearToken();
}

// Admin
export async function getLeads() {
  assertApiConfigured();
  const { data } = await client.get("/leads");
  return data;
}
export async function getLeadStats() {
  assertApiConfigured();
  const { data } = await client.get("/leads/stats");
  return data;
}
export async function updateLeadStatus(id, status) {
  assertApiConfigured();
  const { data } = await client.patch(`/leads/${id}`, { status });
  return data;
}
