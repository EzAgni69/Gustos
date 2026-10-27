"use client";

import React from "react";
import { useRealtimeSocket } from "@/lib/socket-context";
import { Wifi, WifiOff } from "lucide-react";

export function UplinkIndicator() {
  const { isConnected } = useRealtimeSocket();

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        isConnected
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-gray-50 text-gray-500 border-gray-200"
      }`}
      title={isConnected ? "Connected to Cloud Real-time Socket (POS Uplink Active)" : "Connecting to Cloud Real-time Socket..."}
    >
      <span className="relative flex h-2 w-2">
        {isConnected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            isConnected ? "bg-emerald-500" : "bg-gray-400"
          }`}
        ></span>
      </span>
      <span className="hidden sm:inline">
        {isConnected ? "POS Uplink Live" : "Offline"}
      </span>
    </div>
  );
}
