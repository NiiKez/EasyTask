import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-600">Welcome, {user?.displayName}!</p>
        <button
          onClick={handleLogout}
          className="rounded bg-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-300"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
