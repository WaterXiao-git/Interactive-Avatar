import { Navigate, Route, Routes } from "react-router-dom";
import CreatePage from "./pages/CreatePage";
import RigAssistPage from "./pages/RigAssistPage";
import InteractPage from "./pages/InteractPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import DashboardPage from "./pages/DashboardPage";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/create" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/create"
        element={
          <ProtectedRoute>
            <CreatePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rig-preview"
        element={
          <ProtectedRoute>
            <RigAssistPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/interact"
        element={
          <ProtectedRoute>
            <InteractPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default App;
