import { NextResponse } from "next/server";
import { getLatestEvent } from "@/lib/render";

export async function GET() {
  try {
    const event = await getLatestEvent();
    return NextResponse.json(event);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
