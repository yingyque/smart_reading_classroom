import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import TeacherDashboard from './pages/TeacherDashboard';
import Analytics from './pages/Analytics';
import StudentHome from './pages/StudentHome';
import ReadingRoom from './pages/ReadingRoom';
import AdminDashboard from './pages/AdminDashboard';

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-500">加载中…</div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            {user?.role === 'ADMIN' ? (
              <Navigate to="/shimin" replace />
            ) : user?.role === 'TEACHER' ? (
              <Navigate to="/teacher" replace />
            ) : (
              <Navigate to="/student" replace />
            )}
          </Protected>
        }
      />
      <Route
        path="/teacher"
        element={
          <Protected>
            <TeacherDashboard />
          </Protected>
        }
      />
      <Route
        path="/teacher/:classroomId/analytics"
        element={
          <Protected>
            <Analytics />
          </Protected>
        }
      />
      <Route
        path="/shimin"
        element={
          <Protected>
            <AdminDashboard />
          </Protected>
        }
      />
      <Route
        path="/student"
        element={
          <Protected>
            <StudentHome />
          </Protected>
        }
      />
      <Route
        path="/reading/:classroomId"
        element={
          <Protected>
            <ReadingRoom />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
