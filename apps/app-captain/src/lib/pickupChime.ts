/**
 * Gusto Captain — Pickup chime
 *
 * One shared player for the "food ready" chime. Plays even with the iOS silent
 * switch on (a captain's phone is a work device) and mixes with other audio
 * rather than stopping it. Rapid repeats (several stations bumping the same
 * order) are throttled so the chime doesn't stutter.
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

const MIN_GAP_MS = 1500;

let player: AudioPlayer | null = null;
let lastPlayedAt = 0;

function getPlayer(): AudioPlayer | null {
  if (player) return player;
  try {
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "mixWithOthers" }).catch(() => {});
    player = createAudioPlayer(require("../../assets/sounds/pickup-chime.wav"));
  } catch (err) {
    console.warn("[PickupChime] Audio unavailable:", err);
    player = null;
  }
  return player;
}

/** Load the chime ahead of the first alert so it plays without delay. */
export function preloadPickupChime(): void {
  getPlayer();
}

export function playPickupChime(): void {
  const now = Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) return;
  lastPlayedAt = now;

  const p = getPlayer();
  if (!p) return;
  try {
    p.seekTo(0).catch(() => {});
    p.play();
  } catch (err) {
    console.warn("[PickupChime] Failed to play:", err);
  }
}
