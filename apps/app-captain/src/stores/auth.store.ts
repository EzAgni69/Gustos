/**
 * Gusto Captain — Auth Store
 *
 * Manages server connection and PIN-based authentication.
 * Persisted to AsyncStorage so the waiter stays logged in across app restarts.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { asyncStorageAdapter } from "../lib/storage";
import {
  checkHealth,
  pinLogin,
  setBaseUrl,
  setCurrentUserId,
} from "../services/api";
import { connectSocket, disconnectSocket } from "../services/socket";

export interface AuthUser {
  id: string;
  name: string;
  role: string;
}

interface AuthState {
  serverIp: string | null;
  user: AuthUser | null;
  isConnected: boolean;
  isLoading: boolean;
  isHydrated: boolean;

  // Actions
  connectToServer: (ip: string) => Promise<void>;
  login: (pin: string) => Promise<AuthUser>;
  logoutUser: () => void;
  disconnectServer: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      serverIp: null,
      user: null,
      isConnected: false,
      isLoading: false,
      isHydrated: false,

      connectToServer: async (ip: string) => {
        set({ isLoading: true });
        try {
          // Normalize IP — add port if missing
          let serverIp = ip.trim();
          if (!serverIp.includes(":")) {
            serverIp = `${serverIp}:8080`;
          }

          setBaseUrl(serverIp);
          const health = await checkHealth();

          if (health.status !== "ok") {
            throw new Error("Server is not healthy");
          }

          // Connect Socket.IO
          connectSocket(serverIp, get().user?.id);

          set({ serverIp, isConnected: true, isLoading: false });
        } catch (err) {
          set({ isLoading: false, isConnected: false });
          throw err;
        }
      },

      login: async (pin: string) => {
        set({ isLoading: true });
        try {
          const userData = await pinLogin(pin);
          const user: AuthUser = {
            id: userData.id,
            name: userData.name,
            role: userData.role,
          };

          setCurrentUserId(user.id);
          set({ user, isLoading: false });
          return user;
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logoutUser: () => {
        setCurrentUserId(null);
        set({ user: null });
      },

      disconnectServer: () => {
        setCurrentUserId(null);
        disconnectSocket();
        set({ user: null, isConnected: false, serverIp: null });
      },

      restoreSession: () => {
        const { serverIp, user } = get();
        if (serverIp) {
          setBaseUrl(serverIp);
          if (user) {
            setCurrentUserId(user.id);
          }
          // Reconnect socket
          connectSocket(serverIp, user?.id);
          set({ isConnected: true });
        }
      },
    }),
    {
      name: "gusto-captain-auth",
      storage: createJSONStorage(() => asyncStorageAdapter),
      // Only persist serverIp and user, not transient state
      partialize: (state) => ({
        serverIp: state.serverIp,
        user: state.user,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.serverIp) {
          setBaseUrl(state.serverIp);
          if (state.user) {
            setCurrentUserId(state.user.id);
          }
          connectSocket(state.serverIp, state.user?.id);
          useAuthStore.setState({ isConnected: true, isHydrated: true });
        } else {
          useAuthStore.setState({ isHydrated: true });
        }
      },
    }
  )
);
