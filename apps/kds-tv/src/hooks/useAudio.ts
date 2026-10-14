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
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        audioCtxRef.current = new AudioCtxClass();
      }
    }
    // Resume if suspended (browser autoplay policy)
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  // Unlock AudioContext on first user interaction anywhere on the screen
  useEffect(() => {
    const unlock = () => {
      const ctx = getAudioCtx();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [getAudioCtx]);

  // ─── Ding: Distinct 3-tone chime for new KOT arrival ───
  const playDing = useCallback(() => {
    if (isMuted) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;

      // 3-tone upward chime: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz)
      const freqs = [523.25, 659.25, 783.99];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(0, now + idx * 0.12);
        gain.gain.linearRampToValueAtTime(0.4, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.5);
      });
    } catch {
      // Audio unavailable — fail silently
    }
  }, [isMuted, getAudioCtx]);

  // ─── Alarm: Urgent dual-tone warning buzzer for red-state KOTs (>15m) ───
  const playAlarmPulse = useCallback(() => {
    if (isMuted) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.setValueAtTime(680, now + 0.18);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
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
