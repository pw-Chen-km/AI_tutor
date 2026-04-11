import { Sidebar } from "@/components/sidebar/sidebar";
import { ContextPanel } from "@/components/context-panel/context-panel";
import { MainPanel } from "@/components/main-panel";

export default function DashboardPage() {
    return (
        <div className="flex h-screen bg-background">
            {/* Subtle background pattern */}
            <div className="fixed inset-0 -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.03] via-transparent to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-accent/[0.02] to-transparent" />
            </div>

            {/* Left Sidebar - Navigation & Settings */}
            <Sidebar />

            {/* Middle Panel - Context Management */}
            <ContextPanel />

            {/* Right Main Panel - Interaction & Results */}
            <MainPanel />
        </div>
    );
}
