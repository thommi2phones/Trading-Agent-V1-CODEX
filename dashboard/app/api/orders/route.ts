import { NextRequest, NextResponse } from "next/server";
import { getOrders, placeOrder } from "@/lib/alpaca";
import type { OrderRequest } from "@/lib/types";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "all";
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);

    const orders = await getOrders(status, limit);
    return NextResponse.json(orders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: OrderRequest = await req.json();

    // Validate required fields
    if (!body.symbol || !body.side || !body.type || !body.time_in_force) {
      return NextResponse.json(
        { error: "Missing required fields: symbol, side, type, time_in_force" },
        { status: 400 }
      );
    }
    if (!body.qty && !body.notional) {
      return NextResponse.json(
        { error: "Must specify either qty or notional" },
        { status: 400 }
      );
    }

    const order = await placeOrder(body);
    return NextResponse.json(order, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
