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
  setAuthToken,
  setUnauthorizedHandler,
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
  /** Session token from PIN login, sent with every request */
  token: string | null;
  isConnected: boolean;
  isLoading: boolean;
  isHydrated: boolean;

  // Actions
  connectToServer: (ip: string) => Promise<void>;
  login: (pin: string, userId?: string) => Promise<AuthUser>;
  logoutUser: () => void;
  disconnectServer: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      serverIp: null,
      user: null,
      token: null,
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

      login: async (pin: string, userId?: string) => {
        set({ isLoading: true });
        try {
          const userData = await pinLogin(pin, userId);
          const user: AuthUser = {
            id: userData.id,
            name: userData.name,
            role: userData.role,
          };

          setCurrentUserId(user.id);
          setAuthToken(userData.token);
          set({ user, token: userData.token, isLoading: false });
          // Reconnect so queued offline actions drain under the new session
          const { serverIp } = get();
          if (serverIp) connectSocket(serverIp, user.id);
          return user;
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      logoutUser: () => {
        setCurrentUserId(null);
        setAuthToken(null);
        set({ user: null, token: null });
      },

      disconnectServer: () => {
        setCurrentUserId(null);
        setAuthToken(null);
        disconnectSocket();
        set({ user: null, token: null, isConnected: false, serverIp: null });
      },

      restoreSession: () => {
        const { serverIp, user, token } = get();
        if (serverIp) {
          setBaseUrl(serverIp);
          if (user && token) {
            setCurrentUserId(user.id);
            setAuthToken(token);
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
        token: state.token,
      }),
      onRehydrateStorage: () => (state) => {
        // A session saved by an older build has no token — ask for the PIN again
        const hasSession = !!state?.user && !!state?.token;
        if (state?.serverIp) {
          setBaseUrl(state.serverIp);
          if (hasSession) {
            setCurrentUserId(state.user!.id);
            setAuthToken(state.token!);
          }
          connectSocket(state.serverIp, hasSession ? state.user!.id : null);
          useAuthStore.setState({
            isConnected: true,
            isHydrated: true,
            ...(hasSession ? {} : { user: null, token: null }),
          });
        } else {
          useAuthStore.setState({ isHydrated: true, user: null, token: null });
        }
      },
    }
  )
);

// The server rejected our session (expired, or the user was deactivated in the ERP)
setUnauthorizedHandler(() => {
  if (useAuthStore.getState().user) {
    useAuthStore.getState().logoutUser();
  }
});
