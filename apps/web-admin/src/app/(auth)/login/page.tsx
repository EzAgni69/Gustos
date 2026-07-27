"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginRequestSchema, type LoginRequest, registerRequestSchema, type RegisterRequest } from "@gusto/api-contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { User, Lock, Building, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const loginForm = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: {
      organizationName: "",
      organizationSlug: "",
      name: "",
      email: "",
      password: "",
      phone: "",
      gstNumber: "",
    },
  });

  const onLoginSubmit = async (data: LoginRequest) => {
    setLoading(true);
    setApiError("");

    try {
      const res = await apiFetch<{ token: string; user: any }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(data),
      });

      if (!res.success || !res.data) {
        setApiError(res.message || "Invalid email or password");
        return;
      }

      document.cookie = `gusto_token=${res.data.token}; path=/; max-age=86400;`;
      router.push("/");
    } catch (err) {
      setApiError("An unexpected error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  const onRegisterSubmit = async (data: RegisterRequest) => {
    setLoading(true);
    setApiError("");

    try {
      const res = await apiFetch<{ token: string; user: any; organization: any }>(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify(data),
        }
      );

      if (!res.success || !res.data) {
        setApiError(res.message || "Registration failed");
        return;
      }

      document.cookie = `gusto_token=${res.data.token}; path=/; max-age=86400;`;
      router.push("/");
    } catch (err) {
      setApiError("An unexpected error occurred during registration");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50/50 p-4">
      <div className="absolute inset-0 bg-linear-to-b from-blue-50 to-white -z-10" />
      <Card className="w-full max-w-md shadow-xl border-0 ring-1 ring-black/5 bg-white/80 backdrop-blur-xl">
        <CardHeader className="space-y-2 text-center pt-8">
          <div className="mx-auto w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/30">
            <span className="text-3xl">🍽️</span>
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight text-gray-900">
            Gusto ERP
          </CardTitle>
          <CardDescription className="text-gray-500">
            {mode === "login"
              ? "Enter your credentials to access the dashboard"
              : "Register your organization to get started"}
          </CardDescription>

          <div className="flex bg-gray-100 p-1 rounded-lg mt-4">
            <button
              type="button"
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                mode === "login" ? "bg-white shadow-xs text-gray-900" : "text-gray-500"
              }`}
              onClick={() => {
                setMode("login");
                setApiError("");
                loginForm.reset();
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                mode === "register" ? "bg-white shadow-xs text-gray-900" : "text-gray-500"
              }`}
              onClick={() => {
                setMode("register");
                setApiError("");
                registerForm.reset();
              }}
            >
              Create Organization
            </button>
          </div>
        </CardHeader>

        <CardContent>
          {mode === "login" ? (
            <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="email">Email Address</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@gusto.com"
                    className="pl-9 bg-white"
                    {...loginForm.register("email")}
                  />
                </div>
                {loginForm.formState.errors.email && (
                  <p className="text-red-500 text-xs font-medium">{loginForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-9 bg-white"
                    {...loginForm.register("password")}
                  />
                </div>
                {loginForm.formState.errors.password && (
                  <p className="text-red-500 text-xs font-medium">{loginForm.formState.errors.password.message}</p>
                )}
              </div>

              {apiError && (
                <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium">
                  ⚠️ {apiError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full py-5 font-semibold bg-blue-600 hover:bg-blue-700 shadow-md"
                disabled={loading}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Sign In"}
              </Button>
            </form>
          ) : (
            <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="orgName">Organization Name</Label>
                <div className="relative">
                  <Building className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="orgName"
                    type="text"
                    placeholder="Gusto Foods Inc."
                    className="pl-9 bg-white"
                    {...registerForm.register("organizationName", {
                      onChange: (e) => {
                        const slug = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-");
                        registerForm.setValue("organizationSlug", slug, { shouldValidate: true });
                      }
                    })}
                  />
                </div>
                {registerForm.formState.errors.organizationName && (
                  <p className="text-red-500 text-xs font-medium">{registerForm.formState.errors.organizationName.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="orgSlug">Organization Slug</Label>
                <Input
                  id="orgSlug"
                  type="text"
                  placeholder="gusto-foods"
                  className="bg-white font-mono text-xs"
                  {...registerForm.register("organizationSlug")}
                />
                {registerForm.formState.errors.organizationSlug && (
                  <p className="text-red-500 text-xs font-medium">{registerForm.formState.errors.organizationSlug.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="name">Your Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  className="bg-white"
                  {...registerForm.register("name")}
                />
                {registerForm.formState.errors.name && (
                  <p className="text-red-500 text-xs font-medium">{registerForm.formState.errors.name.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="regEmail">Email Address</Label>
                <Input
                  id="regEmail"
                  type="email"
                  placeholder="owner@gusto.com"
                  className="bg-white"
                  {...registerForm.register("email")}
                />
                {registerForm.formState.errors.email && (
                  <p className="text-red-500 text-xs font-medium">{registerForm.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor="regPassword">Password</Label>
                <Input
                  id="regPassword"
                  type="password"
                  placeholder="At least 6 characters"
                  className="bg-white"
                  {...registerForm.register("password")}
                />
                {registerForm.formState.errors.password && (
                  <p className="text-red-500 text-xs font-medium">{registerForm.formState.errors.password.message}</p>
                )}
              </div>

              {apiError && (
                <div className="p-3 rounded-lg bg-red-50 text-red-600 text-sm font-medium">
                  ⚠️ {apiError}
                </div>
              )}

              <Button
                type="submit"
                className="w-full py-5 font-semibold bg-blue-600 hover:bg-blue-700 shadow-md"
                disabled={loading}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Register Organization"}
              </Button>
            </form>
          )}
        </CardContent>

        <CardFooter className="justify-center pb-6">
          <p className="text-xs text-gray-500 text-center">
            Multi-tenant Enterprise Restaurant ERP system.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
