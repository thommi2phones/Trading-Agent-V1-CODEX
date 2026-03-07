import { NextResponse } from "next/server";

// Analysis history is stored client-side in localStorage
// This route exists as a placeholder for future server-side storage
export async function GET() {
  return NextResponse.json({
    message:
      "Analysis history is stored client-side in localStorage. Use the browser directly.",
    storage: "localStorage",
    key: "chart_analyses",
  });
}
