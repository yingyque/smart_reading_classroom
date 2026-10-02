import axios from 'axios';
import { API_PREFIX } from './config';

export const api = axios.create({
  baseURL: API_PREFIX,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      if (!location.pathname.startsWith('/login')) {
        location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export function getToken(): string | null {
  return localStorage.getItem('token');
}
