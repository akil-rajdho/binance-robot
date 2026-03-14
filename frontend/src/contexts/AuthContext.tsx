'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_API || 'http://localhost:8080';
const TOKEN_KEY = 'auth_token';
const LAST_ACTIVITY_KEY = 'auth_last_activity';
const INACTIVITY_TIMEOUT_MS = 48 * 60 * 60 * 1000; // 48 hours

export interface AuthContextType {
  token: string | null;
  login: (password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  updateActivity: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const logoutRef = useRef<() => void>(() => undefined);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    setToken(null);
  }, []);

  // Keep ref in sync so the inactivity check can call the latest logout
  logoutRef.current = logout;

  const updateActivity = useCallback(() => {
    localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  }, []);

  // On mount: read stored token and check inactivity
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    const lastActivity = localStorage.getItem(LAST_ACTIVITY_KEY);

    if (stored) {
      // Check session timeout
      if (lastActivity) {
        const elapsed = Date.now() - parseInt(lastActivity, 10);
        if (elapsed > INACTIVITY_TIMEOUT_MS) {
          // Session expired — clear everything
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(LAST_ACTIVITY_KEY);
          setToken(null);
          setInitialized(true);
          return;
        }
      }
      setToken(stored);
      updateActivity();
    }

    setInitialized(true);
  }, [updateActivity]);

  const login = useCallback(async (password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      let message = 'Invalid password';
      try {
        const data = (await res.json()) as { error?: string; message?: string };
        message = data.error ?? data.message ?? message;
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }

    const data = (await res.json()) as { token: string };
    const newToken = data.token;

    localStorage.setItem(TOKEN_KEY, newToken);
    updateActivity();
    setToken(newToken);
  }, [updateActivity]);

  // Don't render children until we've read from localStorage
  if (!initialized) {
    return null;
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        login,
        logout,
        isAuthenticated: token !== null,
        updateActivity,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
