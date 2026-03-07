import { NextRequest, NextResponse } from "next/server";
import { cancelOrder } from "@/lib/alpaca";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await cancelOrder(id);
    return NextResponse.json({ success: true, cancelled: id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
