"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ClubKnowledge {
  id: string;
  club_name: string;
  school_name: string | null;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  provider: string | null;
  is_external: boolean;
  year_groups: string | null;
  cost_per_session: number | null;
  booking_url: string | null;
  contact_email: string | null;
  cancellation_policy: string | null;
}

interface Child {
  id: string;
  name: string;
}

interface ChildActivity {
  child_id: string;
  activity_name: string;
  day_of_week: string | null;
  time_slot: string | null;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const dayColors: Record<string, string> = {
  Monday: "border-l-blue-500",
  Tuesday: "border-l-purple-500",
  Wednesday: "border-l-green-500",
  Thursday: "border-l-amber-500",
  Friday: "border-l-red-500",
  Saturday: "border-l-pink-500",
  Sunday: "border-l-gray-400",
};

export default function ClubsView() {
  const [clubs, setClubs] = useState<ClubKnowledge[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [activities, setActivities] = useState<ChildActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"by-day" | "by-child" | "all">("by-day");

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) return;

      const [clubsRes, childrenRes] = await Promise.all([
        supabase.from("club_knowledge").select("id, club_name, school_name, day_of_week, start_time, end_time, location, provider, is_external, year_groups, cost_per_session, booking_url, contact_email, cancellation_policy").eq("household_id", household.id).order("club_name"),
        supabase.from("children").select("id, name").eq("household_id", household.id),
      ]);

      setClubs(clubsRes.data ?? []);
      setChildren(childrenRes.data ?? []);

      // Load all child activities
      const allActs: ChildActivity[] = [];
      for (const child of childrenRes.data ?? []) {
        const { data: acts } = await supabase.from("child_activities").select("child_id, activity_name, day_of_week, time_slot").eq("child_id", child.id);
        allActs.push(...(acts ?? []));
      }
      setActivities(allActs);
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Which children attend a given club?
  const childrenForClub = (clubName: string) => {
    const childIds = new Set(activities.filter((a) => a.activity_name === clubName).map((a) => a.child_id));
    return children.filter((c) => childIds.has(c.id));
  };

  // Which clubs does a child attend?
  const clubsForChild = (childId: string) => {
    const actNames = activities.filter((a) => a.child_id === childId).map((a) => a.activity_name);
    return clubs.filter((c) => actNames.includes(c.club_name));
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

  // Clubs by day
  const clubsByDay: Record<string, ClubKnowledge[]> = {};
  for (const day of DAYS) {
    const dayClubs = clubs.filter((c) => c.day_of_week === day);
    if (dayClubs.length > 0) clubsByDay[day] = dayClubs;
  }
  // Clubs with no day
  const unscheduled = clubs.filter((c) => !c.day_of_week || !DAYS.includes(c.day_of_week));

  // Morning vs afternoon vs evening
  const isMorning = (c: ClubKnowledge) => c.start_time && c.start_time < "12:00";
  const isEvening = (c: ClubKnowledge) => c.start_time && c.start_time >= "17:00";

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Clubs & Activities</h1>
            <p className="text-sm text-gray-400">{clubs.length} clubs · {children.length} children</p>
          </div>
          <div className="flex gap-2 text-sm">
            <a href="/dashboard" className="text-blue-600 hover:text-blue-700">Dashboard</a>
            <span className="text-gray-300">|</span>
            <a href="/calendar" className="text-blue-600 hover:text-blue-700">Calendar</a>
            <span className="text-gray-300">|</span>
            <a href="/knowledge" className="text-blue-600 hover:text-blue-700">Knowledge</a>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl">
          {[
            { key: "by-day" as const, label: "By Day" },
            { key: "by-child" as const, label: "By Child" },
            { key: "all" as const, label: "All Clubs" },
          ].map((v) => (
            <button key={v.key} onClick={() => setViewMode(v.key)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${viewMode === v.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {v.label}
            </button>
          ))}
        </div>

        {/* === By Day View === */}
        {viewMode === "by-day" && (
          <div>
            {DAYS.map((day) => {
              const dayClubs = clubsByDay[day];
              if (!dayClubs) return null;
              const morning = dayClubs.filter(isMorning);
              const afternoon = dayClubs.filter((c) => !isMorning(c) && !isEvening(c));
              const evening = dayClubs.filter(isEvening);

              return (
                <div key={day} className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{day}</h3>
                  {morning.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] text-gray-400 uppercase mb-1">Morning</p>
                      {morning.map((club) => <ClubCard key={club.id} club={club} enrolledChildren={childrenForClub(club.club_name)} dayColor={dayColors[day]} />)}
                    </div>
                  )}
                  {afternoon.length > 0 && (
                    <div className="mb-2">
                      {morning.length > 0 && <p className="text-[10px] text-gray-400 uppercase mb-1">After School</p>}
                      {afternoon.map((club) => <ClubCard key={club.id} club={club} enrolledChildren={childrenForClub(club.club_name)} dayColor={dayColors[day]} />)}
                    </div>
                  )}
                  {evening.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[10px] text-gray-400 uppercase mb-1">Evening</p>
                      {evening.map((club) => <ClubCard key={club.id} club={club} enrolledChildren={childrenForClub(club.club_name)} dayColor={dayColors[day]} />)}
                    </div>
                  )}
                </div>
              );
            })}
            {unscheduled.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Other</h3>
                {unscheduled.map((club) => <ClubCard key={club.id} club={club} enrolledChildren={childrenForClub(club.club_name)} />)}
              </div>
            )}
          </div>
        )}

        {/* === By Child View === */}
        {viewMode === "by-child" && (
          <div>
            {children.map((child) => {
              const childClubs = clubsForChild(child.id);
              const childActs = activities.filter((a) => a.child_id === child.id);
              return (
                <div key={child.id} className="mb-8">
                  <h3 className="text-lg font-bold text-gray-900 mb-3">{child.name}</h3>
                  <p className="text-sm text-gray-400 mb-3">{childClubs.length} clubs / activities</p>

                  {/* Weekly summary */}
                  <div className="grid grid-cols-5 gap-2 mb-4">
                    {DAYS.slice(0, 5).map((day) => {
                      const dayActs = childActs.filter((a) => a.day_of_week === day);
                      return (
                        <div key={day} className="bg-white rounded-lg border border-gray-200 p-2">
                          <p className="text-[10px] text-gray-400 mb-1">{day.slice(0, 3)}</p>
                          {dayActs.length > 0 ? dayActs.map((a, i) => (
                            <p key={i} className="text-xs text-gray-700 font-medium">{a.activity_name}</p>
                          )) : (
                            <p className="text-xs text-gray-300">-</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Full club list */}
                  {childClubs.map((club) => (
                    <ClubCard key={club.id} club={club} compact />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* === All Clubs View === */}
        {viewMode === "all" && (
          <div className="space-y-3">
            {clubs.map((club) => (
              <ClubCard key={club.id} club={club} enrolledChildren={childrenForClub(club.club_name)} showDay />
            ))}
          </div>
        )}

        {clubs.length === 0 && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <p className="text-gray-400 text-lg mb-2">No clubs yet</p>
            <p className="text-sm text-gray-300">Clubs are populated from email ingestion and the Knowledge Base.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ClubCard({ club, enrolledChildren, dayColor, compact, showDay }: {
  club: ClubKnowledge;
  enrolledChildren?: Child[];
  dayColor?: string;
  compact?: boolean;
  showDay?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl p-4 border border-gray-200 mb-2 border-l-4 ${dayColor || "border-l-gray-300"}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className={`font-semibold text-gray-900 ${compact ? "text-sm" : ""}`}>{club.club_name}</p>
            {club.is_external && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">External</span>}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {showDay && club.day_of_week && <span className="font-medium">{club.day_of_week} </span>}
            {club.start_time && `${club.start_time}`}{club.end_time && `-${club.end_time}`}
            {club.location && ` · ${club.location}`}
            {club.year_groups && ` · ${club.year_groups}`}
          </p>
          {!compact && (
            <>
              {club.provider && <p className="text-xs text-gray-400 mt-0.5">Provider: {club.provider}</p>}
              {club.cost_per_session != null && <p className="text-xs text-gray-400">£{club.cost_per_session}/session</p>}
              {club.contact_email && <p className="text-xs text-gray-400">{club.contact_email}</p>}
              {club.cancellation_policy && <p className="text-xs text-gray-400 italic mt-1">{club.cancellation_policy}</p>}
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          {enrolledChildren && enrolledChildren.map((child) => (
            <span key={child.id} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {child.name.split(" ")[0]}
            </span>
          ))}
          {club.booking_url && (
            <a href={club.booking_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-700 mt-1">
              Book →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
