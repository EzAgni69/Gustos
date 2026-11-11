import React, { useEffect, useState } from "react";
import { useAuthStore } from "../../store/useAuthStore";
import { apiClient } from "../../api/client";
import { useUIStore } from "../../store/useUIStore";

export const LoginScreen: React.FC = () => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { setToken, setUser } = useAuthStore();
  const { showNotification } = useUIStore();
  const [staff, setStaff] = useState<{ id: string; name: string; role: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Staff list for the "who is signing in" chips. If it cannot be loaded the
  // screen still works with PIN-only sign-in.
  useEffect(() => {
    let cancelled = false;
    apiClient<{ success: boolean; data: { id: string; name: string; role: string }[] }>("/auth/users", {
      requireAuth: false,
    })
      .then((res) => {
        if (cancelled || !res.success || !Array.isArray(res.data)) return;
        // Billing counter staff first; kitchen-only roles do not use the POS
        const order = ["OWNER", "SUPER_ADMIN", "MANAGER", "CASHIER", "WAITER"];
        const list = res.data
          .filter((u) => u.role !== "CHEF")
          .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
        setStaff(list);
        const last = localStorage.getItem("pos_last_user_id");
        if (last && list.some((u) => u.id === last)) setSelectedUserId(last);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleKeyPress = (key: string) => {
    if (error) setError("");
    if (pin.length < 6) {
      setPin((prev) => prev + key);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    if (error) setError("");
  };

  const handleClear = () => {
    setPin("");
    if (error) setError("");
  };

  const handleLogin = async () => {
    if (isLoading) return;
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await apiClient<{ success: boolean; token?: string; user?: any; data?: any }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(selectedUserId ? { pin, userId: selectedUserId } : { pin }),
          requireAuth: false,
        }
      );

      const userObj = response.user || response.data;

      if (response.success && userObj && response.token) {
        setToken(response.token);
        setUser({ id: userObj.id, name: userObj.name, role: userObj.role });
        localStorage.setItem("pos_last_user_id", userObj.id);
        showNotification(`Welcome back, ${userObj.name}`);
      } else {
        setError("Invalid PIN");
        setPin("");
      }
    } catch (err: any) {
      setError(err.message || "Failed to connect to server");
      setPin("");
    } finally {
      setIsLoading(false);
    }
  };

  // Physical keyboard support — billing counters usually have one
  const handleLoginRef = React.useRef(handleLogin);
  handleLoginRef.current = handleLogin;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) {
        setError("");
        setPin((prev) => (prev.length < 6 ? prev + e.key : prev));
      } else if (e.key === "Backspace") {
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === "Escape") {
        setPin("");
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleLoginRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const numpadKeys = [
    "1", "2", "3",
    "4", "5", "6",
    "7", "8", "9",
    "Clear", "0", "Delete"
  ];

  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-background font-sans text-text-main select-none">
      <div className="bg-surface border border-border rounded-2xl p-8 w-96 shadow-2xl flex flex-col items-center">
        <div className="bg-white p-4 rounded-xl mb-6 shadow-sm">
          <img src="/logo.png" alt="Gusto's Pizzeria" className="h-16 object-contain" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Gusto's POS</h1>
        <p className="text-text-muted text-sm mb-6">
          {staff.length > 0 ? "Select your name and enter your PIN" : "Enter your PIN to access billing"}
        </p>

        {/* Who is signing in */}
        {staff.length > 0 && (
          <div className="w-full flex flex-wrap justify-center gap-2 mb-6 max-h-28 overflow-y-auto">
            {staff.map((u) => {
              const active = u.id === selectedUserId;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelectedUserId(active ? null : u.id);
                    setPin("");
                    setError("");
                  }}
                  disabled={isLoading}
                  aria-pressed={active}
                  title={u.role}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    active
                      ? "bg-primary text-text-inverse border-primary"
                      : "bg-surface-hover text-text-main border-border hover:border-primary"
                  }`}
                >
                  {u.name}
                </button>
              );
            })}
          </div>
        )}

        {/* PIN Display */}
        <div className="w-full flex justify-center mb-6">
          <div className="flex gap-3">
            {[0, 1, 2, 3].map((index) => (
              <div 
                key={index} 
                className={`w-4 h-4 rounded-full border-2 ${
                  pin.length > index 
                    ? "bg-primary-hover border-primary" 
                    : "bg-transparent border-gray-600"
                }`}
              />
            ))}
          </div>
        </div>

        {error && <div className="text-rose-500 text-xs mb-4">{error}</div>}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full mb-6">
          {numpadKeys.map((key) => {
            const isAction = key === "Clear" || key === "Delete";
            return (
              <button
                key={key}
                onClick={() => {
                  if (key === "Clear") handleClear();
                  else if (key === "Delete") handleBackspace();
                  else handleKeyPress(key);
                }}
                disabled={isLoading}
                className={`
                  h-14 rounded-xl text-xl font-bold flex items-center justify-center active:scale-[0.98] transition-transform
                  ${isAction ? "bg-surface-hover text-text-muted hover:bg-surface-hover" : "bg-surface-hover text-text-main hover:bg-surface-hover"}
                  ${isLoading ? "opacity-50 cursor-not-allowed" : ""}
                `}
              >
                {key === "Delete" ? "⌫" : key === "Clear" ? "C" : key}
              </button>
            );
          })}
        </div>

        {/* Login Button */}
        <button
          onClick={handleLogin}
          disabled={pin.length < 4 || isLoading}
          className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2
            ${pin.length >= 4 && !isLoading 
              ? "bg-primary hover:bg-primary-hover text-text-inverse" 
              : "bg-surface-hover text-text-muted cursor-not-allowed"
            }
          `}
        >
          {isLoading ? "Authenticating..." : "LOGIN"}
        </button>
      </div>
    </div>
  );
};
