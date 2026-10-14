"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type ToastVariant = "default" | "success" | "error" | "warning";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextType {
  toasts: Toast[];
  toast: (opts: { title: string; description?: string; variant?: ToastVariant }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: { title: string; description?: string; variant?: ToastVariant }) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast: Toast = { id, variant: "default", ...opts };
      setToasts((prev) => [...prev, newToast]);

      // Auto-dismiss after 4 seconds
      setTimeout(() => dismiss(id), 4000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

// ─── Toast Container (renders at bottom-right) ───

const VARIANT_STYLES: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
  default: { bg: "bg-white", border: "border-gray-200", icon: "ℹ️" },
  success: { bg: "bg-white", border: "border-emerald-200", icon: "✅" },
  error: { bg: "bg-white", border: "border-red-200", icon: "❌" },
  warning: { bg: "bg-white", border: "border-amber-200", icon: "⚠️" },
};

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const style = VARIANT_STYLES[t.variant];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto ${style.bg} ${style.border} border rounded-xl px-4 py-3 shadow-lg shadow-black/5 animate-in slide-in-from-right-5 fade-in-0 duration-300 flex items-start gap-3`}
          >
            <span className="text-base mt-0.5 shrink-0">{style.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{t.title}</p>
              {t.description && (
                <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => onDismiss(t.id)}
              className="text-gray-400 hover:text-gray-600 text-sm font-bold shrink-0 mt-0.5 transition-colors"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
