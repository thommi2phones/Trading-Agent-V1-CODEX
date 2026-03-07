import { NextRequest, NextResponse } from "next/server";
import { analyzeChart } from "@/lib/anthropic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    const ticker = (formData.get("ticker") as string) || undefined;
    const description = (formData.get("description") as string) || undefined;

    if (!file) {
      return NextResponse.json(
        { error: "No image file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const validTypes = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ] as const;
    if (!validTypes.includes(file.type as (typeof validTypes)[number])) {
      return NextResponse.json(
        { error: "Invalid image type. Accepts PNG, JPEG, WEBP, GIF." },
        { status: 400 }
      );
    }

    // Convert to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    const analysis = await analyzeChart({
      imageBase64: base64,
      mediaType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
      tradeDescription: description,
      ticker,
    });

    return NextResponse.json(analysis);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
