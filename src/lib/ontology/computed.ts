import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Palantir-style computed properties (Functions).
 * These derive values from the ontology data rather than storing them.
 */

export interface ComputedProperties {
  family: {
    totalChildren: number;
    totalWeeklyCost: number;
    totalClubEnrollments: number;
    uniqueClubs: number;
    morningDropOffs: { day: string; earliest: string; children: string[] }[];
    eveningPickups: { day: string; latest: string; children: string[] }[];
  };
  children: {
    name: string;
    activitiesCount: number;
    weeklyCost: number;
    busyDay: string;
    busyDayCount: number;
    morningClubs: number;
    afterSchoolClubs: number;
    clubs: string[];
  }[];
  school: {
    name: string;
    totalStaff: number;
    totalClubs: number;
    externalClubs: number;
    schoolRunClubs: number;
  }[];
}

export async function computeProperties(
  supabase: SupabaseClient,
  householdId: string
): Promise<ComputedProperties> {
  const [childrenRes, activitiesRes, clubsRes, schoolsRes] = await Promise.all([
    supabase.from("children").select("id, name").eq("household_id", householdId),
    supabase.from("child_activities").select("child_id, activity_name, day_of_week, time_slot, term").eq("term", "Summer 2026"),
    supabase.from("club_knowledge").select("club_name, cost_per_session, is_external, school_name").eq("household_id", householdId),
    supabase.from("school_knowledge").select("school_name, staff").eq("household_id", householdId),
  ]);

  const children = childrenRes.data ?? [];
  const activities = activitiesRes.data ?? [];
  const clubs = clubsRes.data ?? [];
  const schools = schoolsRes.data ?? [];

  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  // Per-child computed properties
  const childProps = children.map((child) => {
    const childActs = activities.filter((a) => a.child_id === child.id);
    const clubNames = [...new Set(childActs.map((a) => a.activity_name))];

    // Weekly cost
    let weeklyCost = 0;
    for (const act of childActs) {
      const club = clubs.find((c) => c.club_name === act.activity_name);
      if (club?.cost_per_session) weeklyCost += Number(club.cost_per_session);
    }

    // Busiest day
    const dayCount: Record<string, number> = {};
    for (const act of childActs) {
      if (act.day_of_week) dayCount[act.day_of_week] = (dayCount[act.day_of_week] || 0) + 1;
    }
    const busyDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0];

    // Morning vs after-school
    const morningClubs = childActs.filter((a) => {
      if (!a.time_slot) return false;
      const hour = parseInt(a.time_slot.split(":")[0]);
      return hour < 9;
    }).length;

    return {
      name: child.name,
      activitiesCount: childActs.length,
      weeklyCost,
      busyDay: busyDay ? busyDay[0] : "N/A",
      busyDayCount: busyDay ? busyDay[1] : 0,
      morningClubs,
      afterSchoolClubs: childActs.length - morningClubs,
      clubs: clubNames,
    };
  });

  // Family totals
  const totalWeeklyCost = childProps.reduce((sum, c) => sum + c.weeklyCost, 0);
  const allClubs = new Set(childProps.flatMap((c) => c.clubs));
  const totalEnrollments = childProps.reduce((sum, c) => sum + c.activitiesCount, 0);

  // Morning drop-offs and evening pickups
  const morningDropOffs = DAYS.map((day) => {
    const dayActs = activities.filter((a) => a.day_of_week === day && a.time_slot);
    const mornings = dayActs.filter((a) => parseInt(a.time_slot!.split(":")[0]) < 9);
    if (mornings.length === 0) return { day, earliest: "08:45", children: children.map((c) => c.name) };

    const earliest = mornings.reduce((min, a) => a.time_slot! < min ? a.time_slot! : min, "08:45").split("-")[0];
    const childrenWithMorning = [...new Set(mornings.map((a) => {
      const child = children.find((c) => c.id === a.child_id);
      return child?.name || "";
    }).filter(Boolean))];

    return { day, earliest, children: childrenWithMorning };
  });

  const eveningPickups = DAYS.map((day) => {
    const dayActs = activities.filter((a) => a.day_of_week === day && a.time_slot);
    if (dayActs.length === 0) return { day, latest: "15:30", children: [] };

    const latest = dayActs.reduce((max, a) => {
      const endTime = a.time_slot!.split("-")[1]?.trim() || a.time_slot!.split("-")[0];
      return endTime > max ? endTime : max;
    }, "15:30");

    const lateChildren = [...new Set(dayActs.filter((a) => {
      const endTime = a.time_slot!.split("-")[1]?.trim() || a.time_slot!.split("-")[0];
      return endTime === latest;
    }).map((a) => {
      const child = children.find((c) => c.id === a.child_id);
      return child?.name || "";
    }).filter(Boolean))];

    return { day, latest, children: lateChildren };
  });

  // School computed
  const schoolProps = schools.map((school) => {
    const schoolClubs = clubs.filter((c) => c.school_name?.includes(school.school_name));
    return {
      name: school.school_name,
      totalStaff: ((school.staff as unknown[]) || []).length,
      totalClubs: schoolClubs.length,
      externalClubs: schoolClubs.filter((c) => c.is_external).length,
      schoolRunClubs: schoolClubs.filter((c) => !c.is_external).length,
    };
  });

  return {
    family: {
      totalChildren: children.length,
      totalWeeklyCost,
      totalClubEnrollments: totalEnrollments,
      uniqueClubs: allClubs.size,
      morningDropOffs,
      eveningPickups,
    },
    children: childProps,
    school: schoolProps,
  };
}
