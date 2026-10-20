import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Logo } from './components/Logo';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import InfoPage from './pages/InfoPage';
import { ChatProvider } from './features/chat/ChatContext';
import AppShell from './features/shell/AppShell';
import ChatsView from './features/chat/ChatsView';
import ContactsPage from './features/contacts/ContactsPage';
import NotificationsPage from './features/notifications/NotificationsPage';
import SettingsPage from './features/settings/SettingsPage';
import AdminPage from './features/admin/AdminPage';
import InvitePage from './features/chat/InvitePage';

function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading ChatTime">
      <Logo size={40} />
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function GuestOnly({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Splash />;
  if (user) return <Navigate to={location.state?.from || '/chats'} replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/chats" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/terms" element={<InfoPage page="terms" />} />
      <Route path="/privacy" element={<InfoPage page="privacy" />} />
      <Route path="/help" element={<InfoPage page="help" />} />

      <Route element={<RequireAuth><ChatProvider><AppShell /></ChatProvider></RequireAuth>}>
        <Route path="/chats/:conversationId?" element={<ChatsView section="chats" />} />
        <Route path="/groups/:conversationId?" element={<ChatsView section="groups" />} />
        <Route path="/archived/:conversationId?" element={<ChatsView section="archived" />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings/:tab?" element={<SettingsPage />} />
        <Route path="/admin/:tab?" element={<AdminOnly><AdminPage /></AdminOnly>} />
        <Route path="/invite/:token" element={<InvitePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/chats" replace />} />
    </Routes>
  );
}
