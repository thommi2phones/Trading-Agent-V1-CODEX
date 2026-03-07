import AccountCard from "@/components/AccountCard";
import PositionsTable from "@/components/PositionsTable";
import EventFeed from "@/components/EventFeed";
import SystemStatus from "@/components/SystemStatus";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="text-sm text-tv-text-dim">
          Trading Agent command center — paper trading
        </p>
      </div>

      {/* Top row: Account + System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <AccountCard />
        </div>
        <SystemStatus />
      </div>

      {/* Bottom row: Positions + Events */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PositionsTable compact />
        <EventFeed limit={10} />
      </div>
    </div>
  );
}
