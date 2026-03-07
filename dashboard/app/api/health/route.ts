import { NextResponse } from "next/server";
import { checkAlpacaHealth } from "@/lib/alpaca";
import { checkRenderHealth } from "@/lib/render";

export async function GET() {
  const [alpaca, render] = await Promise.all([
    checkAlpacaHealth(),
    checkRenderHealth(),
  ]);

  const allOk = alpaca.ok && render.ok;

  return NextResponse.json({
    ok: allOk,
    alpaca,
    render,
    timestamp: new Date().toISOString(),
  });
}
