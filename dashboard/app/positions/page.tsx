import PositionsTable from "@/components/PositionsTable";

export default function PositionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Positions</h1>
        <p className="text-sm text-tv-text-dim">
          Open positions with real-time P&L
        </p>
      </div>
      <PositionsTable showActions />
    </div>
  );
}
