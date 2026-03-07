import EventFeed from "@/components/EventFeed";

export default function EventsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Events</h1>
        <p className="text-sm text-tv-text-dim">
          TradingView webhook event feed from Render
        </p>
      </div>
      <EventFeed limit={50} showFilters />
    </div>
  );
}
