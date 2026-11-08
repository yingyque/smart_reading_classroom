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

function homePath(role?: string) {
  return role === 'ADMIN' ? '/shimin' : role === 'TEACHER' ? '/teacher' : '/student';
}

// 角色守卫：非对应角色一律弹回各自首页，避免打开无权限页面后接口静默 403
function RoleGuard({ role, children }: { role: string; children: JSX.Element }) {
  const { user } = useAuth();
  if (user && user.role !== role) return <Navigate to={homePath(user.role)} replace />;
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
            <RoleGuard role="TEACHER">
              <TeacherDashboard />
            </RoleGuard>
          </Protected>
        }
      />
      <Route
        path="/teacher/:classroomId/analytics"
        element={
          <Protected>
            <RoleGuard role="TEACHER">
              <Analytics />
            </RoleGuard>
          </Protected>
        }
      />
      <Route
        path="/shimin"
        element={
          <Protected>
            <RoleGuard role="ADMIN">
              <AdminDashboard />
            </RoleGuard>
          </Protected>
        }
      />
      <Route
        path="/student"
        element={
          <Protected>
            <RoleGuard role="STUDENT">
              <StudentHome />
            </RoleGuard>
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
