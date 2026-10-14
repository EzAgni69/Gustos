import { create } from "zustand";

interface UserInfo {
  id: string;
  name: string;
  role: string;
  pin: string;
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
  return localStorage.getItem("pos_auth_token") || null;
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
