import { NextResponse } from "next/server";
import { getPositions } from "@/lib/alpaca";

export async function GET() {
  try {
    const positions = await getPositions();
    return NextResponse.json(positions);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
