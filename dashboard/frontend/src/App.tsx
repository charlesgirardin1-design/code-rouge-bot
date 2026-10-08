import { Navigate, Route, Routes, useParams } from "react-router-dom";
import type { Me } from "./api";
import { useApi } from "./hooks";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { LoginPage } from "./pages/Login";
import { GuildSelect } from "./pages/GuildSelect";
import { DashboardPage } from "./pages/Dashboard";
import { SecurityPage } from "./pages/Security";
import { ModerationPage } from "./pages/Moderation";
import { LogsPage } from "./pages/Logs";
import { TicketsPage } from "./pages/Tickets";
import { AnnouncementsPage } from "./pages/Announcements";
import { SettingsPage } from "./pages/Settings";

function GuildRoutes({ me }: { me: Me }) {
  const { guildId } = useParams();
  const guild = me.guilds.find((g) => g.id === guildId);
  if (!guild) return <Navigate to="/" replace />;
  return (
    <Layout me={me} guild={guild}>
      <Routes>
        <Route path="dashboard" element={<DashboardPage guild={guild} />} />
        <Route path="security" element={<SecurityPage guild={guild} />} />
        <Route path="moderation" element={<ModerationPage guild={guild} />} />
        <Route path="logs" element={<LogsPage guild={guild} />} />
        <Route path="tickets" element={<TicketsPage guild={guild} />} />
        <Route path="announcements" element={<AnnouncementsPage guild={guild} />} />
        <Route path="settings" element={<SettingsPage guild={guild} />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  const { data: me, error, loading } = useApi<Me>("/api/me");
  if (loading && !me) return <Loading />;
  if (error?.status === 401 || !me) return <LoginPage />;
  return (
    <Routes>
      <Route path="/" element={<GuildSelect me={me} />} />
      <Route path="/g/:guildId/*" element={<GuildRoutes me={me} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
