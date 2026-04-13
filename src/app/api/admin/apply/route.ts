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
  const { householdId, operation, suggestion } = await request.json() as {
    householdId: string;
    operation: DbOperation;
    suggestion: { title: string; type: string; action: string };
  };

  if (!householdId || !operation) {
    return NextResponse.json({ error: "Missing householdId or operation" }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    if (operation.op === "update" && operation.table && operation.match && operation.set) {
      // Simple field update
      let query = supabase.from(operation.table).update({
        ...operation.set,
        updated_at: new Date().toISOString(),
      });

      // Apply match conditions
      for (const [col, val] of Object.entries(operation.match)) {
        query = query.eq(col, val);
      }

      // Scope to household for safety
      if (["school_knowledge", "club_knowledge", "family_knowledge"].includes(operation.table)) {
        query = query.eq("household_id", householdId);
      }

      const { error } = await query;
      if (error) {
        return NextResponse.json({ error: error.message, success: false });
      }

    } else if (operation.op === "update_json" && operation.table && operation.match && operation.field && operation.append) {
      // Append to a JSON array field
      // First, read the current value
      let readQuery = supabase.from(operation.table).select(operation.field);
      for (const [col, val] of Object.entries(operation.match)) {
        readQuery = readQuery.eq(col, val);
      }
      if (["school_knowledge", "club_knowledge", "family_knowledge"].includes(operation.table)) {
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
      for (const [col, val] of Object.entries(operation.match)) {
        writeQuery = writeQuery.eq(col, val);
      }
      if (["school_knowledge", "club_knowledge", "family_knowledge"].includes(operation.table)) {
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

    // Log the applied suggestion
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
