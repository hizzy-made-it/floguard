import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const client = axios.create({ baseURL: API });

export async function submitLead(payload) {
  const { data } = await client.post("/leads", payload);
  return data;
}
