import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="app-shell"><div className="glass-panel">加载用户状态中...</div></div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
