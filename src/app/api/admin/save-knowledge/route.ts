import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/save-knowledge
 * Saves knowledge base updates using the service role (bypasses RLS).
 * Used by the Knowledge page for all writes.
 */
export async function POST(request: Request) {
  const { table, match, set, householdId } = await request.json() as {
    table: string;
    match: Record<string, string>;
    set: Record<string, unknown>;
    householdId: string;
  };

  if (!table || !set || !householdId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Whitelist tables
  const allowedTables = ["school_knowledge", "child_knowledge", "family_info", "club_knowledge"];
  if (!allowedTables.includes(table)) {
    return NextResponse.json({ error: "Invalid table" }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    let query = supabase.from(table).update({
      ...set,
      updated_at: new Date().toISOString(),
    });

    // Apply match conditions
    for (const [col, val] of Object.entries(match)) {
      query = query.eq(col, val);
    }

    // Always scope to household
    if (table !== "child_knowledge") {
      query = query.eq("household_id", householdId);
    }

    const { error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message, success: false });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err), success: false });
  }
}
