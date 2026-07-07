import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;
const TOKEN_KEY = "fg_admin_token";

export const client = axios.create({ baseURL: API });

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
  const { data } = await client.post("/leads", payload);
  return data;
}
export async function uploadPhoto(file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await client.post("/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
  return data; // { path, url }
}
export const fileUrl = (path) => `${API}/files/${path}`;
export async function submitGuide(payload) {
  const { data } = await client.post("/guide", payload);
  return data;
}
export const guideDownloadUrl = `${API}/guide/download`;

// Auth
export async function login(email, password) {
  const { data } = await client.post("/auth/login", { email, password });
  setToken(data.token);
  return data.user;
}
export async function getMe() {
  const { data } = await client.get("/auth/me");
  return data;
}
export function logout() {
  clearToken();
}

// Admin
export async function getLeads() {
  const { data } = await client.get("/leads");
  return data;
}
export async function getLeadStats() {
  const { data } = await client.get("/leads/stats");
  return data;
}
export async function updateLeadStatus(id, status) {
  const { data } = await client.patch(`/leads/${id}`, { status });
  return data;
}
