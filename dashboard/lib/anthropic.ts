/**
 * Anthropic Claude Vision API client (server-side only).
 *
 * Sends chart screenshots to Claude for analysis using the
 * chart analysis framework trained on 268+ trade images.
 */

import { CHART_ANALYSIS_PROMPT } from "./chart-framework";
import type { ChartAnalysis } from "./types";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = "claude-opus-4-6";

interface AnalyzeChartParams {
  /** Base64-encoded image data */
  imageBase64: string;
  /** Image MIME type */
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Optional trade context from user */
  tradeDescription?: string;
  /** Ticker symbol if known */
  ticker?: string;
}

export async function analyzeChart(
  params: AnalyzeChartParams
): Promise<ChartAnalysis> {
  const { imageBase64, mediaType, tradeDescription, ticker } = params;

  // Build the user message with chart image + context
  const userParts: string[] = [];

  if (ticker) {
    userParts.push(`Ticker: ${ticker}`);
  }
  if (tradeDescription) {
    userParts.push(`Trade context: ${tradeDescription}`);
  }
  userParts.push(
    "Analyze this chart using the framework provided. Return your analysis in the structured format."
  );

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: CHART_ANALYSIS_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: userParts.join("\n"),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic ${response.status}: ${text}`);
  }

  const data = await response.json();
  const rawText =
    data.content?.[0]?.text ?? "No analysis returned from Claude.";

  // Parse structured analysis from Claude's response
  return parseAnalysis(rawText, ticker);
}

function parseAnalysis(text: string, ticker?: string): ChartAnalysis {
  // Extract structured sections from Claude's response
  const sections: Record<string, string> = {};
  const sectionPatterns = [
    { key: "dominant_pattern", regex: /1\.\s*DOMINANT PATTERN\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "fib_confluence", regex: /2\.\s*FIB CONFLUENCE\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "historical_levels", regex: /3\.\s*HISTORICAL LEVEL ALIGNMENT\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "macd_ttm", regex: /4\.\s*MACD \+ TTM STATE\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "rsi_structure", regex: /5\.\s*RSI STRUCTURE\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "confluence", regex: /6\.\s*(?:OVERALL )?CONFLUENCE\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "bias", regex: /7\.\s*BIAS\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "invalidation", regex: /8\.\s*INVALIDATION LEVEL\s*\n([\s\S]*?)(?=\n\d\.|$)/i },
    { key: "next_move", regex: /9\.\s*MOST PROBABLE NEXT MOVE\s*\n([\s\S]*?)$/i },
  ];

  for (const { key, regex } of sectionPatterns) {
    const match = text.match(regex);
    sections[key] = match ? match[1].trim() : "";
  }

  // Extract bias
  const biasText = sections.bias?.toUpperCase() || "";
  let bias: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (biasText.includes("BULLISH")) bias = "BULLISH";
  else if (biasText.includes("BEARISH")) bias = "BEARISH";

  // Extract confluence level
  const confText = sections.confluence?.toUpperCase() || "";
  let confluenceLevel: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  if (confText.includes("HIGH")) confluenceLevel = "HIGH";
  else if (confText.includes("MEDIUM")) confluenceLevel = "MEDIUM";

  // Try to extract entry/stop/TP prices from text
  const entryMatch = text.match(/entry[:\s]*\$?([\d,.]+)/i);
  const stopMatch = text.match(/stop[:\s]*\$?([\d,.]+)/i);
  const tpMatches = [...text.matchAll(/(?:take profit|tp|target)[:\s]*\$?([\d,.]+)/gi)];

  return {
    id: `analysis_${Date.now()}`,
    timestamp: new Date().toISOString(),
    ticker: ticker || "UNKNOWN",
    raw_text: text,
    dominant_pattern: sections.dominant_pattern || "Not identified",
    fib_confluence: sections.fib_confluence || "Not identified",
    historical_levels: sections.historical_levels || "Not identified",
    macd_ttm: sections.macd_ttm || "Not identified",
    rsi_structure: sections.rsi_structure || "Not identified",
    confluence: confluenceLevel,
    bias,
    invalidation: sections.invalidation || "Not identified",
    next_move: sections.next_move || "Not identified",
    entry_price: entryMatch ? parseFloat(entryMatch[1].replace(",", "")) : undefined,
    stop_price: stopMatch ? parseFloat(stopMatch[1].replace(",", "")) : undefined,
    tp_prices: tpMatches.map((m) => parseFloat(m[1].replace(",", ""))),
    direction:
      entryMatch && tpMatches.length > 0
        ? parseFloat(tpMatches[0][1].replace(",", "")) >
          parseFloat(entryMatch[1].replace(",", ""))
          ? "long"
          : "short"
        : undefined,
  };
}
