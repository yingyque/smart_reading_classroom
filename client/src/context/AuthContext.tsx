import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { disconnectSocket } from '../lib/socket';
import { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  setAuth: (token: string, user: User) => void;
  updateUser: (patch: Partial<User>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  setAuth: () => {},
  updateUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get('/auth/me')
      .then((res) => setUser(res.data))
      .catch((err) => console.error('获取用户失败', err))
      .finally(() => setLoading(false));
  }, []);

  const setAuth = (token: string, u: User) => {
    localStorage.setItem('token', token);
    setUser(u);
  };

  const updateUser = (patch: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const logout = () => {
    localStorage.removeItem('token');
    disconnectSocket();
    setUser(null);
    location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, setAuth, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
