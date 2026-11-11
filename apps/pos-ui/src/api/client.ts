export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api";

interface FetchOptions extends RequestInit {
  requireAuth?: boolean;
}

export async function apiClient<T>(
  endpoint: string,
  { requireAuth = true, ...customConfig }: FetchOptions = {}
): Promise<T> {
  const isMutating = customConfig.method && ["POST", "PATCH", "PUT"].includes(customConfig.method.toUpperCase());
  const headers: Record<string, string> = {
    ...(customConfig.body || isMutating ? { "Content-Type": "application/json" } : {}),
  };

  if (requireAuth) {
    const token = localStorage.getItem("pos_auth_token");
    const userStr = localStorage.getItem("pos_auth_user");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (userStr) {
      try {
        const user = JSON.parse(userStr) as { id?: string };
        if (user.id) headers["X-User-Id"] = user.id;
      } catch {
        // Ignore malformed local auth cache.
      }
    }
  }

  if (customConfig.headers) {
    Object.assign(headers, customConfig.headers);
  }

  const config: RequestInit = {
    ...customConfig,
    headers,
  };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, config);
  } catch {
    // fetch only rejects when the server could not be reached at all
    throw new Error("Cannot reach the POS server. Check that it is running and this device is on the same network.");
  }

  if (!response.ok) {
    let errorMessage = `HTTP Error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch {
      // ignore JSON parse error
    }

    // Session expired, signed out elsewhere, or the user was deactivated in the
    // ERP: drop the stale session so the login screen comes back.
    if (response.status === 401 && requireAuth) {
      const { useAuthStore } = await import("../store/useAuthStore");
      if (useAuthStore.getState().isAuthenticated) {
        useAuthStore.getState().logout();
        errorMessage = "Your session has expired. Please sign in again.";
      }
    }

    throw new ApiError(errorMessage, response.status);
  }

  // Handle empty responses
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

/** Error carrying the HTTP status, so callers can tell 4xx (user error) from 5xx / offline. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
