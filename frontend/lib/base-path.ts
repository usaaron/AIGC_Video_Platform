export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export const API_BASE_URL = BASE_PATH ? `${BASE_PATH}/api` : process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
