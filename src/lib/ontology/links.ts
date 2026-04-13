import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Palantir-style ontology link types.
 * Each link connects a source entity to a target entity with a typed relationship.
 */
export const LINK_TYPES = {
  // Child relationships
  CHILD_ATTENDS_SCHOOL: "attends",
  CHILD_ENROLLED_IN_CLUB: "enrolled_in",
  CHILD_TAUGHT_BY: "taught_by",

  // School relationships
  SCHOOL_EMPLOYS: "employs",
  SCHOOL_USES_SYSTEM: "uses_system",
  SCHOOL_HAS_CLUB: "has_club",

  // Family relationships
  FAMILY_HAS_CHILD: "has_child",
  FAMILY_HAS_PARENT: "has_parent",
  FAMILY_USES_PROVIDER: "uses_provider",
  FAMILY_HAS_ACCOUNT: "has_account",

  // Club relationships
  CLUB_PROVIDED_BY: "provided_by",
  CLUB_AT_SCHOOL: "at_school",
} as const;

export type LinkType = (typeof LINK_TYPES)[keyof typeof LINK_TYPES];

interface LinkInput {
  sourceType: string;
  sourceId: string;
  sourceName: string;
  linkType: string;
  targetType: string;
  targetId: string;
  targetName: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create or update an ontology link.
 * Upserts based on the unique constraint (source + link_type + target).
 */
export async function createLink(
  supabase: SupabaseClient,
  householdId: string,
  link: LinkInput
): Promise<void> {
  await supabase.from("ontology_links").upsert({
    household_id: householdId,
    source_type: link.sourceType,
    source_id: link.sourceId,
    source_name: link.sourceName,
    link_type: link.linkType,
    target_type: link.targetType,
    target_id: link.targetId,
    target_name: link.targetName,
    metadata: link.metadata || {},
  }, {
    onConflict: "household_id,source_type,source_id,link_type,target_type,target_id",
  });
}

/**
 * Get all links for an entity (as source or target).
 */
export async function getLinksForEntity(
  supabase: SupabaseClient,
  householdId: string,
  entityType: string,
  entityId: string
) {
  const [asSource, asTarget] = await Promise.all([
    supabase.from("ontology_links")
      .select("*")
      .eq("household_id", householdId)
      .eq("source_type", entityType)
      .eq("source_id", entityId),
    supabase.from("ontology_links")
      .select("*")
      .eq("household_id", householdId)
      .eq("target_type", entityType)
      .eq("target_id", entityId),
  ]);

  return {
    outgoing: asSource.data ?? [],
    incoming: asTarget.data ?? [],
  };
}

/**
 * Rebuild ALL ontology links from the current data.
 * This is the materialization step — reads all entities and creates
 * explicit links between them based on their properties.
 */
export async function rebuildAllLinks(
  supabase: SupabaseClient,
  householdId: string
): Promise<{ created: number; types: Record<string, number> }> {
  // Clear existing links for this household
  await supabase.from("ontology_links").delete().eq("household_id", householdId);

  let created = 0;
  const types: Record<string, number> = {};

  const track = (type: string) => {
    created++;
    types[type] = (types[type] || 0) + 1;
  };

  // Load all entities
  const [childrenRes, schoolsRes, clubsRes, familyRes, loginsRes, activitiesRes] = await Promise.all([
    supabase.from("children").select("id, name, school_name").eq("household_id", householdId),
    supabase.from("school_knowledge").select("id, school_name, staff, payment_systems").eq("household_id", householdId),
    supabase.from("club_knowledge").select("id, club_name, school_name, provider, is_external").eq("household_id", householdId),
    supabase.from("family_info").select("id, parents, emergency_contacts, payment_accounts").eq("household_id", householdId).single(),
    supabase.from("provider_logins").select("id, provider_name, category").eq("household_id", householdId),
    supabase.from("child_activities").select("id, child_id, activity_name, term").eq("term", "Summer 2026"),
  ]);

  const children = childrenRes.data ?? [];
  const schools = schoolsRes.data ?? [];
  const clubs = clubsRes.data ?? [];
  const family = familyRes.data;
  const logins = loginsRes.data ?? [];
  const activities = activitiesRes.data ?? [];

  // Family → Children
  for (const child of children) {
    await createLink(supabase, householdId, {
      sourceType: "family", sourceId: householdId, sourceName: "Cotton Family",
      linkType: LINK_TYPES.FAMILY_HAS_CHILD,
      targetType: "child", targetId: child.id, targetName: child.name,
    });
    track("family→child");

    // Child → School
    const school = schools.find((s) => child.school_name?.includes(s.school_name));
    if (school) {
      await createLink(supabase, householdId, {
        sourceType: "child", sourceId: child.id, sourceName: child.name,
        linkType: LINK_TYPES.CHILD_ATTENDS_SCHOOL,
        targetType: "school", targetId: school.id, targetName: school.school_name,
      });
      track("child→school");
    }

    // Child → Clubs (via activities)
    const childActs = activities.filter((a) => a.child_id === child.id);
    for (const act of childActs) {
      const club = clubs.find((c) => c.club_name === act.activity_name);
      await createLink(supabase, householdId, {
        sourceType: "child", sourceId: child.id, sourceName: child.name,
        linkType: LINK_TYPES.CHILD_ENROLLED_IN_CLUB,
        targetType: "club", targetId: club?.id || act.id, targetName: act.activity_name,
        metadata: { term: act.term, activity_id: act.id },
      });
      track("child→club");
    }
  }

  // Family → Parents
  const parents = (family?.parents || []) as { name: string }[];
  parents.forEach((p, i) => {
    createLink(supabase, householdId, {
      sourceType: "family", sourceId: householdId, sourceName: "Cotton Family",
      linkType: LINK_TYPES.FAMILY_HAS_PARENT,
      targetType: "parent", targetId: `parent-${i}`, targetName: p.name,
    });
    track("family→parent");
  });

  // School → Staff
  for (const school of schools) {
    const staff = (school.staff || []) as { name: string; role: string }[];
    for (let i = 0; i < staff.length; i++) {
      await createLink(supabase, householdId, {
        sourceType: "school", sourceId: school.id, sourceName: school.school_name,
        linkType: LINK_TYPES.SCHOOL_EMPLOYS,
        targetType: "staff", targetId: `staff-${school.id}-${i}`, targetName: staff[i].name,
        metadata: { role: staff[i].role },
      });
      track("school→staff");
    }

    // School → Payment Systems
    const payments = (school.payment_systems || []) as { name: string }[];
    for (let i = 0; i < payments.length; i++) {
      await createLink(supabase, householdId, {
        sourceType: "school", sourceId: school.id, sourceName: school.school_name,
        linkType: LINK_TYPES.SCHOOL_USES_SYSTEM,
        targetType: "system", targetId: `system-${school.id}-${i}`, targetName: payments[i].name,
      });
      track("school→system");
    }

    // School → Clubs
    const schoolClubs = clubs.filter((c) => c.school_name === school.school_name || c.school_name?.includes(school.school_name));
    for (const club of schoolClubs) {
      await createLink(supabase, householdId, {
        sourceType: "school", sourceId: school.id, sourceName: school.school_name,
        linkType: LINK_TYPES.SCHOOL_HAS_CLUB,
        targetType: "club", targetId: club.id, targetName: club.club_name,
      });
      track("school→club");
    }
  }

  // Family → Provider Logins
  for (const login of logins) {
    await createLink(supabase, householdId, {
      sourceType: "family", sourceId: householdId, sourceName: "Cotton Family",
      linkType: LINK_TYPES.FAMILY_USES_PROVIDER,
      targetType: "provider", targetId: login.id, targetName: login.provider_name,
      metadata: { category: login.category },
    });
    track("family→provider");
  }

  return { created, types };
}
