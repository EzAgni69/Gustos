export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api";

interface FetchOptions extends RequestInit {
  requireAuth?: boolean;
}

export async function apiClient<T>(
  endpoint: string,
  { requireAuth = true, ...customConfig }: FetchOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(customConfig.body ? { "Content-Type": "application/json" } : {}),
  };

  if (requireAuth) {
    const token = localStorage.getItem("pos_auth_token");
    const userStr = localStorage.getItem("pos_auth_user");
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    } else {
      console.warn("No auth token found, request might fail");
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

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  if (!response.ok) {
    let errorMessage = `HTTP Error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.message) {
        errorMessage = errorData.message;
      }
    } catch (e) {
      // ignore JSON parse error
    }
    throw new Error(errorMessage);
  }

  // Handle empty responses
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}
