/**
 * KDS-TV — Audio Alert Hook
 *
 * Uses the Web Audio API to generate:
 * - A short "ding" for new KOT arrivals
 * - A pulsing alarm for KOTs that have gone red (>15 min)
 *
 * Mute state is persisted to localStorage.
 */

import { useCallback, useRef, useState, useEffect } from "react";

const MUTE_KEY = "kds-audio-muted";

export function useAudio() {
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const audioCtxRef = useRef<AudioContext | null>(null);
  const alarmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAlarmActiveRef = useRef(false);

  // Lazy-init AudioContext (must be created after user interaction)
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    // Resume if suspended (browser autoplay policy)
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // ─── Ding: Short pleasant chime for new KOT ───
  const playDing = useCallback(() => {
    if (isMuted) return;
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;

      // Two-tone chime
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now); // A5
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1320, now); // E6

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now + 0.1);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.6);
    } catch {
      // Audio unavailable — fail silently
    }
  }, [isMuted, getAudioCtx]);

  // ─── Alarm: Pulsing tone for red-state KOTs ───
  const playAlarmPulse = useCallback(() => {
    if (isMuted) return;
    try {
      const ctx = getAudioCtx();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(550, now + 0.15);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      // Audio unavailable — fail silently
    }
  }, [isMuted, getAudioCtx]);

  // ─── Start/Stop recurring alarm ───
  const startAlarm = useCallback(() => {
    if (isAlarmActiveRef.current) return;
    isAlarmActiveRef.current = true;
    playAlarmPulse();
    alarmIntervalRef.current = setInterval(playAlarmPulse, 5000);
  }, [playAlarmPulse]);

  const stopAlarm = useCallback(() => {
    isAlarmActiveRef.current = false;
    if (alarmIntervalRef.current) {
      clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }, []);

  // ─── Toggle mute ───
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MUTE_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      if (next) {
        // If muting, stop any active alarm
        stopAlarm();
      }
      return next;
    });
  }, [stopAlarm]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAlarm();
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, [stopAlarm]);

  return {
    isMuted,
    toggleMute,
    playDing,
    startAlarm,
    stopAlarm,
  };
}
