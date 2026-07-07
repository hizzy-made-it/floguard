import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export const ProtectedRoute = ({ children }) => {
  const { user, checking } = useAuth();
  if (checking)
    return (
      <div className="min-h-screen bg-brand-ink flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-orange" size={32} />
      </div>
    );
  if (!user) return <Navigate to="/admin/login" replace />;
  return children;
};
