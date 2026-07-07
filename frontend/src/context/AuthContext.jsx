import { createContext, useContext, useEffect, useState } from "react";
import { getMe, login as apiLogin, logout as apiLogout, getToken } from "../lib/api";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null); // null = checking, false = anon, object = admin
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      if (!getToken()) {
        setUser(false);
        setChecking(false);
        return;
      }
      try {
        setUser(await getMe());
      } catch {
        setUser(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const login = async (email, password) => {
    const u = await apiLogin(email, password);
    setUser(u);
    return u;
  };
  const logout = () => {
    apiLogout();
    setUser(false);
  };

  return <AuthContext.Provider value={{ user, checking, login, logout }}>{children}</AuthContext.Provider>;
};
