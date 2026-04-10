import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { ClassificationResult, KnownSender, Child } from "../types";

function getApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // Fallback: read directly from .env.local
  try {
    const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const match = envFile.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  throw new Error("ANTHROPIC_API_KEY not found");
}

function getAnthropic() {
  return new Anthropic({ apiKey: getApiKey() });
}

/**
 * Stage 1: Classify whether an email is school-related.
 * Uses Haiku for speed and cost. Biased toward 99%+ recall —
 * false positives are OK, false negatives are product-killing.
 */
export async function classifyEmail(
  subject: string,
  from: string,
  bodySnippet: string,
  knownSenders: KnownSender[],
  children: Child[]
): Promise<ClassificationResult> {
  // Fast path: if the sender matches a known sender, skip AI entirely
  const senderMatch = knownSenders.find(
    (s) => from.toLowerCase().includes(s.email_address.toLowerCase())
  );
  if (senderMatch) {
    return {
      is_school_related: true,
      confidence: 1.0,
      reason: `Known sender: ${senderMatch.label} (${senderMatch.category})`,
    };
  }

  const childNames = children.map((c) => c.name).join(", ");
  const schoolNames = [...new Set(children.map((c) => c.school_name))].join(", ");
  const knownSenderList = knownSenders
    .map((s) => `${s.email_address} (${s.label})`)
    .join(", ");

  const response = await getAnthropic().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are classifying whether an email is related to school, children's activities, clubs, or childcare.

CONTEXT:
- Children: ${childNames || "not specified"}
- Schools: ${schoolNames || "not specified"}
- Known senders: ${knownSenderList || "none configured"}

EMAIL:
From: ${from}
Subject: ${subject}
Body preview: ${bodySnippet.slice(0, 500)}

IMPORTANT: Err on the side of INCLUDING the email. Missing a school communication is worse than including a non-school email. If there is ANY chance this relates to children, school, clubs, activities, PTA, childcare, or parenting logistics, classify it as school-related.

Respond with ONLY a JSON object:
{"is_school_related": true/false, "confidence": 0.0-1.0, "reason": "brief reason"}`,
      },
    ],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text);
    return {
      is_school_related: parsed.is_school_related ?? false,
      confidence: parsed.confidence ?? 0.5,
      reason: parsed.reason ?? "unknown",
    };
  } catch {
    // If we can't parse the response, assume school-related (recall > precision)
    return {
      is_school_related: true,
      confidence: 0.3,
      reason: "Classification parse error — defaulting to included",
    };
  }
}
