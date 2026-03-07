import { NextRequest, NextResponse } from "next/server";
import { getLatestQuotes } from "@/lib/alpaca";

// Default watchlist symbols
const DEFAULT_SYMBOLS = [
  "TSLA", "AMD", "AAPL", "NVDA", "DNN", "URNM", "SPY", "QQQ",
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbolsParam = searchParams.get("symbols");
    const symbols = symbolsParam
      ? symbolsParam.split(",").map((s) => s.trim())
      : DEFAULT_SYMBOLS;

    const quotes = await getLatestQuotes(symbols);
    return NextResponse.json(quotes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
