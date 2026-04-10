import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { resolve } from "path";
import { SupabaseClient } from "@supabase/supabase-js";

function getApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const match = envFile.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  throw new Error("ANTHROPIC_API_KEY not found");
}

interface OntologyContext {
  householdId: string;
  childNames: string[];
  schoolNames: string[];
  supabase: SupabaseClient;
}

/**
 * Update the knowledge ontology from a processed email.
 * This runs AFTER the extraction step and enriches the persistent
 * knowledge entities (school, clubs, child, family) with any new
 * information found in the email.
 *
 * Uses Haiku for cost efficiency — ontology updates are incremental
 * and don't need Sonnet-level reasoning.
 */
export async function updateOntology(
  ctx: OntologyContext,
  email: { subject: string; from: string; body: string; messageId: string }
): Promise<{ entitiesUpdated: { entity_type: string; entity_name: string; fields_updated: string[] }[] }> {
  const anthropic = new Anthropic({ apiKey: getApiKey() });

  // Load existing knowledge for context
  const [schoolRes, clubRes, childRes, familyRes] = await Promise.all([
    ctx.supabase.from("school_knowledge").select("school_name, staff, term_dates, policies, payment_systems").eq("household_id", ctx.householdId),
    ctx.supabase.from("club_knowledge").select("club_name, provider, day_of_week, cost_per_session").eq("household_id", ctx.householdId),
    ctx.supabase.from("child_knowledge").select("child_id, class_name, teacher_name, enrolled_clubs").limit(10),
    ctx.supabase.from("family_knowledge").select("parents, payment_accounts").eq("household_id", ctx.householdId).single(),
  ]);

  const existingSchools = (schoolRes.data ?? []).map((s) => s.school_name).join(", ") || "none";
  const existingClubs = (clubRes.data ?? []).map((c) => `${c.club_name} (${c.provider || "school"})`).join(", ") || "none";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are extracting KNOWLEDGE ENTITIES from a school email to build a persistent knowledge base.

EXISTING KNOWLEDGE:
- Schools: ${existingSchools}
- Clubs: ${existingClubs}
- Children: ${ctx.childNames.join(", ") || "none"}

EMAIL:
From: ${email.from}
Subject: ${email.subject}
Body:
${email.body.slice(0, 3000)}

Extract any NEW or UPDATED knowledge about these entity types. Only include information that is EXPLICITLY stated in the email. Do not infer or guess.

Return a JSON object with only the entities that have new information:
{
  "school": {
    "school_name": "string (required if school info found)",
    "address": "string or null",
    "phone": "string or null",
    "email": "string or null",
    "website": "string or null",
    "staff": [{"name": "string", "role": "string"}],
    "term_dates": [{"term_name": "string", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}],
    "policies": {"key": "value"},
    "payment_systems": [{"name": "string", "url": "string or null"}],
    "notes": ["string"]
  },
  "clubs": [
    {
      "club_name": "string (required)",
      "school_name": "string or null",
      "day_of_week": "string or null",
      "start_time": "string or null",
      "end_time": "string or null",
      "location": "string or null",
      "provider": "string or null",
      "is_external": true/false,
      "year_groups": "string or null",
      "cost_per_session": number or null,
      "cost_per_term": number or null,
      "booking_method": "string or null",
      "booking_url": "string or null",
      "contact_email": "string or null",
      "cancellation_policy": "string or null",
      "weather_policy": "string or null"
    }
  ],
  "child": {
    "child_name": "string (must match one of: ${ctx.childNames.join(", ")})",
    "class_name": "string or null",
    "teacher_name": "string or null",
    "dietary_notes": "string or null",
    "medical_notes": "string or null"
  },
  "family": {
    "pickup_arrangements": [{"child_name": "string", "details": "string"}],
    "payment_accounts": [{"system": "string", "notes": "string"}],
    "key_dates": [{"date": "YYYY-MM-DD", "description": "string"}]
  }
}

Omit any top-level key (school, clubs, child, family) if no new information was found for that entity type. Return {} if the email contains no knowledge worth storing.

Respond with ONLY the JSON object.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const jsonText = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let updates: Record<string, unknown>;
  try {
    updates = JSON.parse(jsonText);
  } catch {
    return { entitiesUpdated: [] };
  }

  const entitiesUpdated: { entity_type: string; entity_name: string; fields_updated: string[] }[] = [];

  // Update school knowledge
  if (updates.school && typeof updates.school === "object") {
    const school = updates.school as Record<string, unknown>;
    const schoolName = (school.school_name as string) || ctx.schoolNames[0];
    if (schoolName) {
      const fieldsUpdated = await upsertSchool(ctx, schoolName, school, email.messageId);
      if (fieldsUpdated.length > 0) {
        entitiesUpdated.push({ entity_type: "school", entity_name: schoolName, fields_updated: fieldsUpdated });
      }
    }
  }

  // Update club knowledge
  if (Array.isArray(updates.clubs)) {
    for (const club of updates.clubs as Record<string, unknown>[]) {
      const clubName = club.club_name as string;
      if (!clubName) continue;
      const fieldsUpdated = await upsertClub(ctx, clubName, club, email.messageId);
      if (fieldsUpdated.length > 0) {
        entitiesUpdated.push({ entity_type: "club", entity_name: clubName, fields_updated: fieldsUpdated });
      }
    }
  }

  // Update child knowledge
  if (updates.child && typeof updates.child === "object") {
    const child = updates.child as Record<string, unknown>;
    const childName = child.child_name as string;
    if (childName && ctx.childNames.includes(childName)) {
      const fieldsUpdated = await upsertChild(ctx, childName, child, email.messageId);
      if (fieldsUpdated.length > 0) {
        entitiesUpdated.push({ entity_type: "child", entity_name: childName, fields_updated: fieldsUpdated });
      }
    }
  }

  // Update family knowledge
  if (updates.family && typeof updates.family === "object") {
    const family = updates.family as Record<string, unknown>;
    const fieldsUpdated = await upsertFamily(ctx, family, email.messageId);
    if (fieldsUpdated.length > 0) {
      entitiesUpdated.push({ entity_type: "family", entity_name: "household", fields_updated: fieldsUpdated });
    }
  }

  // Log the ontology update
  if (entitiesUpdated.length > 0) {
    await ctx.supabase.from("ontology_updates").insert({
      household_id: ctx.householdId,
      gmail_message_id: email.messageId,
      source_subject: email.subject,
      entities_updated: entitiesUpdated,
    });
  }

  return { entitiesUpdated };
}

async function upsertSchool(
  ctx: OntologyContext,
  schoolName: string,
  data: Record<string, unknown>,
  messageId: string
): Promise<string[]> {
  const fieldsUpdated: string[] = [];
  const updateObj: Record<string, unknown> = { updated_at: new Date().toISOString(), last_updated_from: messageId };

  // Simple fields
  for (const field of ["address", "phone", "email", "website"] as const) {
    if (data[field]) { updateObj[field] = data[field]; fieldsUpdated.push(field); }
  }

  // Merge JSON array fields (append new items)
  const { data: existing } = await ctx.supabase
    .from("school_knowledge")
    .select("*")
    .eq("household_id", ctx.householdId)
    .eq("school_name", schoolName)
    .single();

  for (const field of ["staff", "term_dates", "payment_systems", "notes"] as const) {
    if (Array.isArray(data[field]) && (data[field] as unknown[]).length > 0) {
      const existingArr = (existing?.[field] as unknown[]) || [];
      updateObj[field] = [...existingArr, ...(data[field] as unknown[])];
      fieldsUpdated.push(field);
    }
  }

  if (data.policies && typeof data.policies === "object") {
    const existingPolicies = (existing?.policies as Record<string, unknown>) || {};
    updateObj.policies = { ...existingPolicies, ...(data.policies as Record<string, unknown>) };
    fieldsUpdated.push("policies");
  }

  if (fieldsUpdated.length > 0) {
    await ctx.supabase.from("school_knowledge").upsert({
      household_id: ctx.householdId,
      school_name: schoolName,
      ...updateObj,
    }, { onConflict: "household_id,school_name" });
  }

  return fieldsUpdated;
}

async function upsertClub(
  ctx: OntologyContext,
  clubName: string,
  data: Record<string, unknown>,
  messageId: string
): Promise<string[]> {
  const fieldsUpdated: string[] = [];
  const updateObj: Record<string, unknown> = { updated_at: new Date().toISOString(), last_updated_from: messageId };

  for (const field of [
    "school_name", "day_of_week", "start_time", "end_time", "location",
    "provider", "is_external", "year_groups", "cost_per_session", "cost_per_term",
    "booking_method", "booking_url", "contact_email", "contact_phone",
    "cancellation_policy", "weather_policy", "behaviour_policy",
  ] as const) {
    if (data[field] !== undefined && data[field] !== null) {
      updateObj[field] = data[field];
      fieldsUpdated.push(field);
    }
  }

  if (fieldsUpdated.length > 0) {
    const schoolName = (data.school_name as string) || null;
    await ctx.supabase.from("club_knowledge").upsert({
      household_id: ctx.householdId,
      club_name: clubName,
      school_name: schoolName,
      ...updateObj,
    }, { onConflict: "household_id,club_name,coalesce(school_name, '')" as string });
  }

  return fieldsUpdated;
}

async function upsertChild(
  ctx: OntologyContext,
  childName: string,
  data: Record<string, unknown>,
  messageId: string
): Promise<string[]> {
  // Find child_id from name
  const { data: children } = await ctx.supabase
    .from("children")
    .select("id")
    .eq("household_id", ctx.householdId)
    .eq("name", childName)
    .single();

  if (!children) return [];

  const fieldsUpdated: string[] = [];
  const updateObj: Record<string, unknown> = { updated_at: new Date().toISOString(), last_updated_from: messageId };

  for (const field of ["class_name", "teacher_name", "teaching_assistant", "dietary_notes", "medical_notes", "sen_notes"] as const) {
    if (data[field]) { updateObj[field] = data[field]; fieldsUpdated.push(field); }
  }

  if (fieldsUpdated.length > 0) {
    await ctx.supabase.from("child_knowledge").upsert({
      child_id: children.id,
      ...updateObj,
    }, { onConflict: "child_id" });
  }

  return fieldsUpdated;
}

async function upsertFamily(
  ctx: OntologyContext,
  data: Record<string, unknown>,
  messageId: string
): Promise<string[]> {
  const fieldsUpdated: string[] = [];

  const { data: existing } = await ctx.supabase
    .from("family_knowledge")
    .select("*")
    .eq("household_id", ctx.householdId)
    .single();

  const updateObj: Record<string, unknown> = { updated_at: new Date().toISOString(), last_updated_from: messageId };

  for (const field of ["pickup_arrangements", "payment_accounts", "key_dates", "parents", "emergency_contacts"] as const) {
    if (Array.isArray(data[field]) && (data[field] as unknown[]).length > 0) {
      const existingArr = (existing?.[field] as unknown[]) || [];
      updateObj[field] = [...existingArr, ...(data[field] as unknown[])];
      fieldsUpdated.push(field);
    }
  }

  if (fieldsUpdated.length > 0) {
    await ctx.supabase.from("family_knowledge").upsert({
      household_id: ctx.householdId,
      ...updateObj,
    }, { onConflict: "household_id" });
  }

  return fieldsUpdated;
}
