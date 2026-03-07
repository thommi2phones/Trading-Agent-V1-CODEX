import { NextRequest, NextResponse } from "next/server";
import { closePosition, getPosition } from "@/lib/alpaca";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const position = await getPosition(symbol);
    return NextResponse.json(position);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params;
    const { searchParams } = new URL(req.url);
    const qty = searchParams.get("qty") ?? undefined;
    const percentage = searchParams.get("percentage") ?? undefined;

    const order = await closePosition(symbol, qty, percentage);
    return NextResponse.json(order);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
