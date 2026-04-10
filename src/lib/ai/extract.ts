import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult, Child, ChildActivity } from "../types";

function getAnthropic() {
  return new Anthropic();
}

/**
 * Stage 2: Extract structured data from a school-related email.
 * Uses Sonnet for accuracy. This is the core product intelligence.
 */
export async function extractFromEmail(
  subject: string,
  from: string,
  body: string,
  children: Child[],
  activities: ChildActivity[],
  today: string // ISO date string for resolving relative dates
): Promise<ExtractionResult[]> {
  const childContext = children
    .map((c) => {
      const childActivities = activities
        .filter((a) => a.child_id === c.id)
        .map(
          (a) =>
            `${a.activity_name}${a.day_of_week ? ` (${a.day_of_week}` + (a.time_slot ? ` ${a.time_slot}` : "") + ")" : ""}`
        )
        .join(", ");
      return `- ${c.name}: ${c.school_name}${c.year_group ? `, ${c.year_group}` : ""}${childActivities ? `. Activities: ${childActivities}` : ""}`;
    })
    .join("\n");

  const response = await getAnthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are extracting structured data from a school/children's activity email for a parent.

TODAY'S DATE: ${today}

CHILDREN IN THIS FAMILY:
${childContext || "No children specified"}

EMAIL:
From: ${from}
Subject: ${subject}
Body:
${body.slice(0, 3000)}

Extract ALL events, deadlines, actions, or important information from this email.
For each item, return a JSON object. One email may contain multiple items.

Rules:
- Resolve relative dates: "next Friday" means the coming Friday from ${today}. "tomorrow" means the day after ${today}.
- If the email mentions a specific child by name, set child_name. If it's clearly for all children or a specific year group matching one of the children, set accordingly.
- Set urgency: "high" if deadline is within 48 hours or action is time-sensitive, "medium" for this week, "low" for next week or later.
- Extract any booking/sign-up/RSVP URLs into action_url.
- event_fingerprint should be a stable identifier: lowercase normalized title + date (if any). Example: "drama-club-booking-2026-04-15". Same event across multiple emails should produce the same fingerprint.
- raw_snippet: include the most relevant 1-2 sentences from the email for this item.

Respond with ONLY a JSON array of objects:
[{
  "type": "event" | "deadline" | "action" | "info",
  "title": "string",
  "date": "ISO8601 or null",
  "deadline": "ISO8601 or null",
  "child_name": "string or null",
  "urgency": "high" | "medium" | "low",
  "action_url": "string or null",
  "confidence": 0.0-1.0,
  "event_fingerprint": "string",
  "raw_snippet": "string"
}]

If the email contains no extractable items, return an empty array [].`,
      },
    ],
  });

  try {
    const text =
      response.content[0].type === "text" ? response.content[0].text : "[]";
    // Handle case where response includes markdown code fence
    const jsonText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: Record<string, unknown>) => ({
      type: item.type ?? "info",
      title: item.title ?? "Untitled",
      date: item.date ?? null,
      deadline: item.deadline ?? null,
      child_name: item.child_name ?? null,
      urgency: item.urgency ?? "low",
      action_url: item.action_url ?? null,
      confidence: item.confidence ?? 0.5,
      event_fingerprint: item.event_fingerprint ?? `unknown-${Date.now()}`,
      raw_snippet: item.raw_snippet ?? "",
    })) as ExtractionResult[];
  } catch {
    // Return empty on parse failure — email goes to unprocessed
    return [];
  }
}
