import React, { useState } from "react";
import { useAuthStore } from "../../store/useAuthStore";
import { apiClient } from "../../api/client";
import { useUIStore } from "../../store/useUIStore";

export const LoginScreen: React.FC = () => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { setToken, setUser } = useAuthStore();
  const { showNotification } = useUIStore();

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
          body: JSON.stringify({ pin }),
          requireAuth: false,
        }
      );

      const userObj = response.user || response.data;
      const tokenVal = response.token || (userObj?.id ? `pos_token_${userObj.id}` : "pos_token");

      if (response.success && userObj) {
        setToken(tokenVal);
        setUser(userObj);
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
        <h1 className="text-2xl font-bold mb-2">Gusto POS</h1>
        <p className="text-text-muted text-sm mb-6">Enter your PIN to access billing</p>
        
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
