const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

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
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

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
    return {
      success: false,
      message: err instanceof Error ? err.message : "Network error occurred",
    };
  }
}
