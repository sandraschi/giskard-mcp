import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AppsHub } from "./pages/AppsHub";
import { ChatPage } from "./pages/ChatPage";
import { Dashboard } from "./pages/Dashboard";
import { ReportsPage } from "./pages/ReportsPage";
import { ScanDetail } from "./pages/ScanDetail";
import { ScansPage } from "./pages/ScansPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { StatusPage } from "./pages/StatusPage";
import { ToolsHub } from "./pages/ToolsHub";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/scans" element={<ScansPage />} />
        <Route path="/scans/:agentName" element={<ScanDetail />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/tools" element={<ToolsHub />} />
        <Route path="/apps" element={<AppsHub />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
