// @ts-nocheck
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";

function getApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const match = envFile.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  throw new Error("ANTHROPIC_API_KEY not found");
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const supabase = createServiceClient();

  // Get household from the request body
  const { householdId } = await request.json();
  if (!householdId) {
    return NextResponse.json({ error: "Missing householdId" }, { status: 400 });
  }

  // Load the full ontology
  const [
    childrenRes, activitiesRes, schoolsRes, clubsRes,
    childKnowledgeRes, familyRes, itemsRes, sendersRes,
  ] = await Promise.all([
    supabase.from("children").select("*").eq("household_id", householdId),
    supabase.from("child_activities").select("*, children!inner(household_id, name)").eq("children.household_id", householdId),
    supabase.from("school_knowledge").select("*").eq("household_id", householdId),
    supabase.from("club_knowledge").select("*").eq("household_id", householdId),
    supabase.from("child_knowledge").select("*"),
    supabase.from("family_info").select("id, parents, pickup_arrangements, emergency_contacts, payment_accounts, preferences, key_dates, notes, updated_at").eq("household_id", householdId).single(),
    supabase.from("extracted_items").select("id, type, title, date, deadline, child_name, urgency, confidence, needs_review, source_subject, raw_snippet").eq("household_id", householdId).eq("dismissed", false).order("created_at", { ascending: false }).limit(50),
    supabase.from("known_senders").select("*").eq("household_id", householdId),
  ]);

  const children = childrenRes.data ?? [];
  const activities = activitiesRes.data ?? [];
  const schools = schoolsRes.data ?? [];
  const clubs = clubsRes.data ?? [];
  const childKnowledge = childKnowledgeRes.data ?? [];
  const family = familyRes.data;
  const items = itemsRes.data ?? [];
  const senders = sendersRes.data ?? [];

  // Build context for the AI
  const context = `
CHILDREN:
${children.map((c: Record<string, string>) => `- ${c.name} (id: ${c.id}): ${c.school_name}, ${c.year_group || "year group unknown"}`).join("\n")}

CHILD ACTIVITIES:
${activities.map((a: Record<string, unknown>) => `- ${(a as Record<string, Record<string, unknown>>).children?.name}: ${a.activity_name} (${a.day_of_week || "day unknown"}, ${a.time_slot || "time unknown"})`).join("\n") || "None"}

SCHOOL KNOWLEDGE:
${schools.map((s: Record<string, unknown>) => {
  const staffList = (s.staff as { name: string; role: string }[] || []).map((st) => `  - ${st.name}: ${st.role}`).join("\n");
  return `${s.school_name}:
  Address: ${s.address || "MISSING"}
  Phone: ${s.phone || "MISSING"}
  Email: ${s.email || "MISSING"}
  Website: ${s.website || "MISSING"}
  Staff (${(s.staff as unknown[] || []).length}):
${staffList || "  None"}
  Payment systems: ${(s.payment_systems as { name: string }[] || []).map((p) => p.name).join(", ") || "MISSING"}
  Term dates: ${(s.term_dates as unknown[] || []).length} entries
  Policies: ${Object.keys(s.policies as Record<string, unknown> || {}).join(", ") || "NONE"}`;
}).join("\n\n") || "No schools"}

CLUB KNOWLEDGE:
${clubs.map((c) => `- ${c.club_name}: ${c.day_of_week || "?"} ${c.start_time || ""}-${c.end_time || ""}, provider: ${c.provider || "unknown"}, cost: ${c.cost_per_session ? "£" + c.cost_per_session : "unknown"}`).join("\n") || "No clubs"}

CHILD KNOWLEDGE:
${childKnowledge.map((ck) => {
  const child = children.find((c) => c.id === ck.child_id);
  return `- ${child?.name || "Unknown"}: class=${ck.class_name || "MISSING"}, teacher=${ck.teacher_name || "MISSING"}, TA=${ck.teaching_assistant || "MISSING"}, dietary=${ck.dietary_notes || "none"}, medical=${ck.medical_notes || "none"}`;
}).join("\n") || "No child knowledge"}

FAMILY:
  Parents: ${(family?.parents as { name: string }[] || []).map((p) => p.name).join(", ") || "MISSING"}
  Emergency contacts: ${(family?.emergency_contacts as unknown[] || []).length || 0}
  Pickup arrangements: ${(family?.pickup_arrangements as unknown[] || []).length || 0}
  Payment accounts: ${(family?.payment_accounts as { system: string }[] || []).map((a) => a.system).join(", ") || "MISSING"}

KNOWN SENDERS: ${senders.map((s) => `${s.email_address} (${s.label})`).join(", ") || "None"}

RECENT EXTRACTED ITEMS (${items.length}):
${items.slice(0, 20).map((i) => `- [${i.type}] ${i.title} | date: ${i.date || "none"} | child: ${i.child_name || "none"} | urgency: ${i.urgency} | confidence: ${i.confidence} | needs_review: ${i.needs_review}`).join("\n")}
`;

  const anthropic = new Anthropic({ apiKey: getApiKey() });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: `You are an AI assistant analyzing a family's school communication knowledge base. Your job is to find gaps, suggest linkages, identify inconsistencies, and recommend improvements.

TODAY'S DATE: ${new Date().toISOString().split("T")[0]}

${context}

Generate 5-15 specific, actionable suggestions. Each suggestion should be one of these types:

1. LINK — connect two pieces of data that should be related (e.g. child to their teacher based on year group)
2. MISSING — important information that's missing and should be filled in
3. MERGE — duplicate or overlapping items that should be combined
4. DISMISS — items that are outdated, irrelevant, or low-value
5. ENRICH — existing data that could be enhanced with additional context
6. VERIFY — data that looks inconsistent or might be wrong

For each suggestion, provide:
- type: LINK | MISSING | MERGE | DISMISS | ENRICH | VERIFY
- priority: high | medium | low
- title: short description (under 80 chars)
- description: explain what you found and what should change (2-3 sentences)
- action: human-readable description of the change
- entity_type: school | club | child | family | item (what entity this affects)
- entity_name: which specific entity
- db_operation: a structured database operation to execute if approved. Must be one of:
  {
    "op": "update",
    "table": "school_knowledge" | "club_knowledge" | "child_knowledge" | "family_info" | "extracted_items",
    "match": {"column": "value"}, // how to find the row (e.g. {"school_name": "Allfarthing"} or {"child_id": "..."})
    "set": {"column": "new_value"} // fields to update
  }
  OR
  {
    "op": "update_json",
    "table": "school_knowledge" | "club_knowledge" | "child_knowledge" | "family_info",
    "match": {"column": "value"},
    "field": "staff" | "term_dates" | "policies" | "payment_systems" | "parents" | "emergency_contacts" | "enrolled_clubs",
    "append": {...} // object to append to the JSON array field
  }
  OR
  {
    "op": "dismiss_item",
    "item_ids": ["uuid", ...] // extracted_items to mark as dismissed
  }

Use actual entity names and child names from the data. For child_knowledge updates, use match: {"child_id": "ACTUAL_CHILD_ID"} from the children data above.

Be specific. Reference actual names, dates, and data from the context. Don't suggest generic things like "add more data."

Respond with ONLY a JSON array of suggestions.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "[]";
  const jsonText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let suggestions: unknown[] = [];
  try {
    suggestions = JSON.parse(jsonText);
  } catch {
    // Try to salvage partial JSON
    try {
      const lastBracket = jsonText.lastIndexOf("}");
      if (lastBracket > 0) {
        suggestions = JSON.parse(jsonText.slice(0, lastBracket + 1) + "]");
      }
    } catch { /* ignore */ }
  }

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return NextResponse.json({ suggestions: [], runId: null });
  }

  // Save suggestions to database
  const runId = `run-${Date.now()}`;
  const rows = suggestions.map((s: Record<string, unknown>) => ({
    household_id: householdId,
    type: s.type || "ENRICH",
    priority: s.priority || "medium",
    title: s.title || "Untitled",
    description: s.description || "",
    action: s.action || "",
    entity_type: s.entity_type || "unknown",
    entity_name: s.entity_name || "unknown",
    db_operation: s.db_operation || null,
    status: "pending",
    run_id: runId,
  }));

  await supabase.from("admin_suggestions").insert(rows);

  return NextResponse.json({ suggestions, runId });
}
