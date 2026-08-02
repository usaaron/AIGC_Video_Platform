const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    const payload = parseErrorPayload(responseText);
    throw new ApiError(
      formatApiError(payload?.detail, response.status, responseText),
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

function parseErrorPayload(responseText: string): { detail?: unknown } | null {
  if (!responseText.trim()) return null;
  try {
    return JSON.parse(responseText) as { detail?: unknown };
  } catch {
    return null;
  }
}

function formatApiError(detail: unknown, status: number, responseText: string): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { loc?: unknown; msg?: unknown };
      if (typeof candidate.msg !== "string") return [];
      const location = Array.isArray(candidate.loc)
        ? candidate.loc.filter((part) => part !== "body").join(".")
        : "";
      return [location ? `${location}: ${candidate.msg}` : candidate.msg];
    });
    if (messages.length) return messages.join("; ");
  }
  const plainText = responseText.trim();
  if (plainText && !plainText.startsWith("<")) return plainText.slice(0, 500);
  return `The API request failed (HTTP ${status}).`;
}
