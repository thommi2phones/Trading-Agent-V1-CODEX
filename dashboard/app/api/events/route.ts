import { NextRequest, NextResponse } from "next/server";
import { getEvents } from "@/lib/render";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const setup_id = searchParams.get("setup_id") ?? undefined;

    const events = await getEvents(limit, setup_id);
    return NextResponse.json(events);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
