import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

interface DbOperation {
  op: "update" | "update_json" | "dismiss_item";
  table?: string;
  match?: Record<string, string>;
  set?: Record<string, unknown>;
  field?: string;
  append?: unknown;
  item_ids?: string[];
}

export async function POST(request: Request) {
  const { householdId, operation, suggestion, suggestionId } = await request.json() as {
    householdId: string;
    operation: DbOperation;
    suggestion: { title: string; type: string; action: string };
    suggestionId?: string; // database ID of the suggestion
  };

  if (!householdId || !operation) {
    return NextResponse.json({ error: "Missing householdId or operation" }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    if (operation.op === "update" && operation.table && operation.match && operation.set) {
      // Resolve child names to child_ids if needed
      const resolvedMatch = await resolveMatch(supabase, householdId, operation.table, operation.match);

      // Fix common column name mismatches from AI
      const fixedSet = fixColumnNames(operation.table, operation.set);

      // Simple field update
      let query = supabase.from(operation.table).update({
        ...fixedSet,
        updated_at: new Date().toISOString(),
      });

      // Apply match conditions
      for (const [col, val] of Object.entries(resolvedMatch)) {
        query = query.eq(col, val);
      }

      // Scope to household for safety
      if (["school_knowledge", "club_knowledge", "family_info"].includes(operation.table)) {
        query = query.eq("household_id", householdId);
      }

      const { error } = await query;
      if (error) {
        return NextResponse.json({ error: error.message, success: false });
      }

    } else if (operation.op === "update_json" && operation.table && operation.match && operation.field && operation.append) {
      // Resolve child names to child_ids if needed
      const resolvedMatch = await resolveMatch(supabase, householdId, operation.table, operation.match);

      // Append to a JSON array field
      // First, read the current value
      let readQuery = supabase.from(operation.table).select(operation.field);
      for (const [col, val] of Object.entries(resolvedMatch)) {
        readQuery = readQuery.eq(col, val);
      }
      if (["school_knowledge", "club_knowledge", "family_info"].includes(operation.table)) {
        readQuery = readQuery.eq("household_id", householdId);
      }

      const { data: existing } = await readQuery.single();
      const currentArray = (existing?.[operation.field] as unknown[]) || [];
      const updatedArray = [...currentArray, operation.append];

      // Write back
      let writeQuery = supabase.from(operation.table).update({
        [operation.field]: updatedArray,
        updated_at: new Date().toISOString(),
      });
      for (const [col, val] of Object.entries(resolvedMatch)) {
        writeQuery = writeQuery.eq(col, val);
      }
      if (["school_knowledge", "club_knowledge", "family_info"].includes(operation.table)) {
        writeQuery = writeQuery.eq("household_id", householdId);
      }

      const { error } = await writeQuery;
      if (error) {
        return NextResponse.json({ error: error.message, success: false });
      }

    } else if (operation.op === "dismiss_item" && operation.item_ids?.length) {
      // Dismiss extracted items
      const { error } = await supabase
        .from("extracted_items")
        .update({ dismissed: true })
        .in("id", operation.item_ids)
        .eq("household_id", householdId);

      if (error) {
        return NextResponse.json({ error: error.message, success: false });
      }

    } else {
      return NextResponse.json({ error: "Unknown operation type", success: false });
    }

    // Mark suggestion as applied in the database
    if (suggestionId) {
      await supabase.from("admin_suggestions").update({
        status: "applied",
        applied_at: new Date().toISOString(),
      }).eq("id", suggestionId);
    }

    // Log the applied suggestion to ontology updates
    await supabase.from("ontology_updates").insert({
      household_id: householdId,
      gmail_message_id: "admin-suggestion",
      source_subject: `[Admin] ${suggestion.type}: ${suggestion.title}`,
      entities_updated: [{ entity_type: suggestion.type, entity_name: suggestion.title, fields_updated: ["admin-approved"] }],
    });

    return NextResponse.json({ success: true });

  } catch (err) {
    return NextResponse.json({ error: String(err), success: false });
  }
}

/**
 * Resolve match conditions that might use names instead of IDs.
 * The AI sometimes returns {"child_name": "Bella Cotton"} instead of {"child_id": "uuid"}.
 * This function resolves names to actual database IDs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveMatch(supabase: any, householdId: string, table: string, match: Record<string, string>): Promise<Record<string, string>> {
  const resolved = { ...match };

  // If matching child_knowledge by child_name, resolve to child_id
  if (table === "child_knowledge" && resolved.child_name && !resolved.child_id) {
    const { data: child } = await supabase
      .from("children")
      .select("id")
      .eq("household_id", householdId)
      .eq("name", resolved.child_name)
      .single();
    if (child) {
      resolved.child_id = child.id;
      delete resolved.child_name;
    }
  }

  // If matching school_knowledge by school_name, ensure household scoping
  if (table === "school_knowledge" && resolved.school_name) {
    // school_name match is fine as-is, household scoped in the caller
  }

  // If matching club_knowledge by club_name, ensure household scoping
  if (table === "club_knowledge" && resolved.club_name) {
    // club_name match is fine as-is, household scoped in the caller
  }

  return resolved;
}

/**
 * Fix common column name mismatches between what the AI generates
 * and what the actual database schema uses.
 */
function fixColumnNames(table: string, data: Record<string, unknown>): Record<string, unknown> {
  const fixed: Record<string, unknown> = {};

  // Column aliases the AI commonly gets wrong
  const aliases: Record<string, Record<string, string>> = {
    child_knowledge: {
      class: "class_name",
      teacher: "teacher_name",
      ta: "teaching_assistant",
      assistant: "teaching_assistant",
      dietary: "dietary_notes",
      medical: "medical_notes",
      sen: "sen_notes",
    },
    school_knowledge: {
      name: "school_name",
      telephone: "phone",
      tel: "phone",
      url: "website",
      site: "website",
    },
    family_info: {},
    club_knowledge: {
      name: "club_name",
      day: "day_of_week",
      start: "start_time",
      end: "end_time",
      cost: "cost_per_session",
      contact: "contact_email",
    },
  };

  const tableAliases = aliases[table] || {};

  // Known valid columns per table (prevents writing to non-existent columns)
  const validColumns: Record<string, Set<string>> = {
    child_knowledge: new Set(["class_name", "teacher_name", "teaching_assistant", "dietary_notes", "medical_notes", "sen_notes", "enrolled_clubs", "classmates", "achievements", "notes"]),
    school_knowledge: new Set(["school_name", "address", "phone", "email", "website", "staff", "term_dates", "policies", "channels", "pta_contacts", "pta_events", "payment_systems", "notes"]),
    club_knowledge: new Set(["club_name", "school_name", "day_of_week", "start_time", "end_time", "location", "provider", "is_external", "year_groups", "cost_per_session", "cost_per_term", "booking_method", "booking_url", "contact_email", "contact_phone", "cancellation_policy", "weather_policy", "behaviour_policy", "current_term", "is_active", "notes"]),
    family_info: new Set(["parents", "pickup_arrangements", "emergency_contacts", "payment_accounts", "preferences", "key_dates", "notes"]),
  };

  const tableValid = validColumns[table];

  for (const [key, value] of Object.entries(data)) {
    const fixedKey = tableAliases[key] || key;
    // Only include columns that exist in the table
    if (!tableValid || tableValid.has(fixedKey)) {
      fixed[fixedKey] = value;
    }
  }

  return fixed;
}
