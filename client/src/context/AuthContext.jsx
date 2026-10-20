import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { socket } from '../lib/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      return data.user;
    } catch (_error) {
      setUser(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // The server ended this session (logout elsewhere, revoked, suspended).
  useEffect(() => {
    const onUnauthorized = () => {
      socket.disconnect();
      setUser((current) => {
        if (current) setNotice('Your session has ended. Please log in again.');
        return null;
      });
    };
    window.addEventListener('chattime:unauthorized', onUnauthorized);
    return () => window.removeEventListener('chattime:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    setNotice('');
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (details) => {
    const { data } = await api.post('/auth/register', details);
    setNotice('');
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async (message = '') => {
    socket.disconnect();
    await api.post('/auth/logout').catch(() => {});
    setNotice(message);
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user, ready, notice, setNotice, setUser, refresh, login, register, logout,
  }), [user, ready, notice, refresh, login, register, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
