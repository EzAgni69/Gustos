import { create } from "zustand";

interface UserInfo {
  id: string;
  name: string;
  role: string;
}

export interface AuthStoreState {
  token: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;

  setToken: (token: string) => void;
  setUser: (user: UserInfo) => void;
  logout: () => void;
}

const getInitialToken = () => {
  const token = localStorage.getItem("pos_auth_token") || null;
  // Tokens issued by older builds ("pos_token_<id>") are no longer accepted by the server
  if (token && token.startsWith("pos_token")) {
    localStorage.removeItem("pos_auth_token");
    localStorage.removeItem("pos_auth_user");
    return null;
  }
  return token;
};

const getInitialUser = (): UserInfo | null => {
  const userStr = localStorage.getItem("pos_auth_user");
  if (userStr) {
    try {
      return JSON.parse(userStr);
    } catch (e) {
      return null;
    }
  }
  return null;
};

export const useAuthStore = create<AuthStoreState>((set) => ({
  token: getInitialToken(),
  user: getInitialUser(),
  isAuthenticated: !!getInitialToken(),

  setToken: (token) => {
    localStorage.setItem("pos_auth_token", token);
    set({ token, isAuthenticated: true });
  },

  setUser: (user) => {
    localStorage.setItem("pos_auth_user", JSON.stringify(user));
    set({ user });
  },

  logout: () => {
    localStorage.removeItem("pos_auth_token");
    localStorage.removeItem("pos_auth_user");
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
