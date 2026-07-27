/**
 * Gusto Captain — Async Storage
 *
 * Persistent key-value store for offline resilience.
 * Used as the persistence layer for Zustand stores.
 * Replaces MMKV for Expo Go compatibility.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StateStorage } from "zustand/middleware";

/**
 * Zustand-compatible storage adapter for AsyncStorage.
 */
export const asyncStorageAdapter: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return await AsyncStorage.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await AsyncStorage.setItem(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await AsyncStorage.removeItem(name);
  },
};
