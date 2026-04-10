import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /api/auth/callback
 * Handles the OAuth callback from Supabase Auth (Google provider).
 * Stores Gmail tokens (provider_token + provider_refresh_token) for background polling.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/onboarding";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("Auth callback error:", error);
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  // Store Gmail tokens for background polling
  const providerToken = data.session.provider_token;
  const providerRefreshToken = data.session.provider_refresh_token;

  if (providerToken) {
    // Check if household exists for this user
    const { data: existingHousehold } = await supabase
      .from("households")
      .select("id")
      .eq("owner_user_id", data.session.user.id)
      .single();

    let householdId = existingHousehold?.id;

    if (!householdId) {
      // Create household
      const { data: newHousehold } = await supabase
        .from("households")
        .insert({ owner_user_id: data.session.user.id })
        .select("id")
        .single();
      householdId = newHousehold?.id;
    }

    if (householdId) {
      // Use service client to store tokens (bypasses RLS)
      // In production, use the service role key via a server action
      const { createClient } = require("@supabase/supabase-js");
      const serviceClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      await serviceClient.from("gmail_tokens").upsert(
        {
          household_id: householdId,
          access_token: providerToken,
          refresh_token: providerRefreshToken ?? "",
          expiry_date: new Date(
            Date.now() + 3600 * 1000 // 1 hour default
          ).toISOString(),
        },
        { onConflict: "household_id" }
      );

      // Initialize processing state
      await serviceClient.from("processing_state").upsert(
        {
          household_id: householdId,
          initial_import_complete: false,
        },
        { onConflict: "household_id" }
      );
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
