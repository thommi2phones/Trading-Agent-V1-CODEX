import { NextResponse } from "next/server";
import { getAccount } from "@/lib/alpaca";

export async function GET() {
  try {
    const account = await getAccount();
    return NextResponse.json(account);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
