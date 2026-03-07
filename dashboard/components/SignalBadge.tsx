interface Props {
  level: "HIGH" | "MEDIUM" | "LOW" | string;
  className?: string;
}

const colors: Record<string, string> = {
  HIGH: "bg-tv-green/20 text-tv-green border-tv-green/30",
  MEDIUM: "bg-tv-orange/20 text-tv-orange border-tv-orange/30",
  LOW: "bg-tv-red/20 text-tv-red border-tv-red/30",
};

export default function SignalBadge({ level, className = "" }: Props) {
  const normalized = level.toUpperCase();
  const color = colors[normalized] || colors.LOW;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${color} ${className}`}
    >
      {normalized}
    </span>
  );
}
