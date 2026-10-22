export function getApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && envUrl.trim() !== "") {
    const clean = envUrl.trim().replace(/\/+$/, "");
    return clean.endsWith("/api/v1") ? clean : `${clean}/api/v1`;
  }
  // In the browser, use relative path so Next.js rewrites proxy to backend without CORS issues
  if (typeof window !== "undefined") {
    return "/api/v1";
  }
  // On the server (SSR), use API_GATEWAY_URL or local default
  const serverUrl = (process.env.API_GATEWAY_URL || "http://localhost:3001").replace(/\/+$/, "");
  return serverUrl.endsWith("/api/v1") ? serverUrl : `${serverUrl}/api/v1`;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )gusto_token=([^;]*)/);
  if (match && match[1]) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Handle endpoints whether they start with slash or already contain /api/v1
  const apiBase = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  let requestUrl: string;

  if (cleanEndpoint.startsWith("/api/v1/")) {
    const baseWithoutV1 = apiBase.endsWith("/api/v1") ? apiBase.slice(0, -7) : apiBase;
    requestUrl = `${baseWithoutV1}${cleanEndpoint}`;
  } else {
    requestUrl = `${apiBase}${cleanEndpoint}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(requestUrl, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await res.json();

    if (res.status === 401 && typeof window !== "undefined" && !endpoint.includes("/auth/")) {
      // Clear cookie and redirect to login if unauthenticated
      document.cookie = "gusto_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
      window.location.href = "/login";
    }

    if (!res.ok) {
      return {
        success: false,
        message: data.message || `Request failed with status ${res.status}`,
      };
    }

    return data as ApiResponse<T>;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        success: false,
        message: "Request timed out. Check your network connection and try again.",
      };
    }
    return {
      success: false,
      message: err instanceof Error ? err.message : "Network error occurred",
    };
  }
}
