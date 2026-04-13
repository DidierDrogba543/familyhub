"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ChildWithActivities {
  id: string;
  name: string;
  activities: {
    activity_name: string;
    day_of_week: string | null;
    time_slot: string | null;
    notes: string | null;
    term: string | null;
    link_url: string | null;
    link_label: string | null;
  }[];
}

interface Holiday {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  holiday_type: string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const WEEKEND = ["Saturday", "Sunday"];
const DAYS = [...WEEKDAYS, ...WEEKEND];

const childColors: Record<string, { bg: string; text: string; dot: string }> = {
  "Bella Cotton": { bg: "bg-pink-50", text: "text-pink-700", dot: "bg-pink-400" },
  "Lucy Cotton": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400" },
  "Harry Cotton": { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-400" },
};

function getStartHour(timeSlot: string | null): number {
  if (!timeSlot) return 12;
  const start = timeSlot.split("-")[0]?.trim();
  if (!start) return 12;
  const [h] = start.split(":").map(Number);
  return h;
}

function formatTime(timeSlot: string | null): string {
  if (!timeSlot) return "";
  return timeSlot.replace("-", " – ");
}

export default function CalendarView() {
  const [children, setChildren] = useState<ChildWithActivities[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeekStart, setCurrentWeekStart] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  });

  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) return;

      const [childrenRes, holidaysRes] = await Promise.all([
        supabase.from("children").select("id, name").eq("household_id", household.id),
        supabase.from("holiday_dates").select("id, title, start_date, end_date, holiday_type").eq("household_id", household.id).order("start_date"),
      ]);

      const childrenWithActs: ChildWithActivities[] = [];
      for (const child of childrenRes.data ?? []) {
        const { data: acts } = await supabase
          .from("child_activities")
          .select("activity_name, day_of_week, time_slot, notes, term, link_url, link_label")
          .eq("child_id", child.id)
          .eq("term", "Summer 2026");
        childrenWithActs.push({ ...child, activities: acts ?? [] });
      }
      setChildren(childrenWithActs);
      setHolidays(holidaysRes.data ?? []);
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const getHolidayForDate = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return holidays.find((h) => dateStr >= h.start_date && dateStr <= h.end_date);
  };

  const prevWeek = () => { const d = new Date(currentWeekStart); d.setDate(d.getDate() - 7); setCurrentWeekStart(d); };
  const nextWeek = () => { const d = new Date(currentWeekStart); d.setDate(d.getDate() + 7); setCurrentWeekStart(d); };
  const thisWeek = () => {
    const now = new Date(); const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now); monday.setDate(now.getDate() + diff); monday.setHours(0, 0, 0, 0);
    setCurrentWeekStart(monday);
  };

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

  // Build day schedules
  const getDaySchedule = (dayName: string) => {
    const morning: { child: string; activity: string; time: string; notes: string | null; link_url: string | null; link_label: string | null }[] = [];
    const afterSchool: { child: string; activity: string; time: string; notes: string | null; link_url: string | null; link_label: string | null }[] = [];
    const evening: { child: string; activity: string; time: string; notes: string | null; link_url: string | null; link_label: string | null }[] = [];

    for (const child of children) {
      const dayActs = child.activities.filter((a) => a.day_of_week === dayName);
      for (const act of dayActs) {
        const hour = getStartHour(act.time_slot);
        const entry = { child: child.name, activity: act.activity_name, time: formatTime(act.time_slot), notes: act.notes, link_url: act.link_url, link_label: act.link_label };
        if (hour < 9) morning.push(entry);
        else if (hour >= 17) evening.push(entry);
        else afterSchool.push(entry);
      }
    }

    // Sort by time within each group
    const sortByTime = (a: { time: string }, b: { time: string }) => a.time.localeCompare(b.time);
    morning.sort(sortByTime);
    afterSchool.sort(sortByTime);
    evening.sort(sortByTime);

    return { morning, afterSchool, evening };
  };

  // Get first name
  const firstName = (name: string) => name.split(" ")[0];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Weekly Calendar</h1>
            <p className="text-sm text-gray-400">
              {weekDates[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {weekDates[6].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <div className="flex gap-2">
            <a href="/dashboard" className="text-sm text-blue-600 hover:text-blue-700 mr-4">Dashboard</a>
            <button onClick={prevWeek} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">‹</button>
            <button onClick={thisWeek} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Today</button>
            <button onClick={nextWeek} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">›</button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex gap-4 mb-6">
          {children.map((child) => {
            const colors = childColors[child.name] || { dot: "bg-gray-400" };
            return (
              <div key={child.id} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                <span className="text-xs text-gray-500">{firstName(child.name)}</span>
              </div>
            );
          })}
        </div>

        {/* Weekdays */}
        <div className="space-y-3">
          {DAYS.map((day, i) => {
            const isWeekend = WEEKEND.includes(day);
            const date = weekDates[i];
            const isToday = date.toDateString() === new Date().toDateString();
            const holiday = getHolidayForDate(date);
            const schedule = getDaySchedule(day);
            const totalEvents = schedule.morning.length + schedule.afterSchool.length + schedule.evening.length;

            // Skip weekend days with no activities
            if (isWeekend && totalEvents === 0 && !holiday) {
              return (
                <div key={day} className="bg-gray-50 rounded-xl border border-gray-100 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-center text-gray-400">
                      <p className="text-xs">{day}</p>
                      <p className="text-lg font-bold">{date.getDate()}</p>
                    </div>
                    <p className="text-xs text-gray-300">No activities</p>
                  </div>
                </div>
              );
            }

            return (
              <div key={day} className={`bg-white rounded-xl border ${isToday ? "border-blue-400 ring-1 ring-blue-100" : isWeekend ? "border-gray-100" : "border-gray-200"}`}>
                {/* Day header */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${isToday ? "border-blue-100 bg-blue-50/30" : "border-gray-100"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`text-center ${isToday ? "text-blue-600" : "text-gray-900"}`}>
                      <p className="text-xs text-gray-400">{day}</p>
                      <p className="text-lg font-bold">{date.getDate()}</p>
                    </div>
                    {holiday && (
                      <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{holiday.title}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-300">{totalEvents} activities</span>
                </div>

                {holiday ? (
                  <div className="px-4 py-4 text-center">
                    <p className="text-sm text-red-400">No school – {holiday.title}</p>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    {/* Morning */}
                    {schedule.morning.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] text-gray-400 uppercase mb-1.5">Morning</p>
                        <div className="flex flex-wrap gap-2">
                          {schedule.morning.map((entry, j) => {
                            const colors = childColors[entry.child] || { bg: "bg-gray-50", text: "text-gray-700" };
                            return (
                              <div key={j} className={`${colors.bg} rounded-lg px-3 py-1.5`}>
                                <span className={`text-xs font-medium ${colors.text}`}>{entry.activity}</span>
                                <span className="text-[10px] text-gray-400 ml-1.5">{firstName(entry.child)}</span>
                                {entry.time && <span className="text-[10px] text-gray-400 ml-1">{entry.time}</span>}
                                {entry.link_url && <a href={entry.link_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:text-blue-600 ml-1">{entry.link_label || "↗"}</a>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* After School */}
                    {schedule.afterSchool.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] text-gray-400 uppercase mb-1.5">After School</p>
                        <div className="flex flex-wrap gap-2">
                          {schedule.afterSchool.map((entry, j) => {
                            const colors = childColors[entry.child] || { bg: "bg-gray-50", text: "text-gray-700" };
                            return (
                              <div key={j} className={`${colors.bg} rounded-lg px-3 py-1.5`}>
                                <span className={`text-xs font-medium ${colors.text}`}>{entry.activity}</span>
                                <span className="text-[10px] text-gray-400 ml-1.5">{firstName(entry.child)}</span>
                                {entry.time && <span className="text-[10px] text-gray-400 ml-1">{entry.time}</span>}
                                {entry.link_url && <a href={entry.link_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:text-blue-600 ml-1">{entry.link_label || "↗"}</a>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Evening */}
                    {schedule.evening.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase mb-1.5">Evening</p>
                        <div className="flex flex-wrap gap-2">
                          {schedule.evening.map((entry, j) => {
                            const colors = childColors[entry.child] || { bg: "bg-gray-50", text: "text-gray-700" };
                            return (
                              <div key={j} className={`${colors.bg} rounded-lg px-3 py-1.5`}>
                                <span className={`text-xs font-medium ${colors.text}`}>{entry.activity}</span>
                                <span className="text-[10px] text-gray-400 ml-1.5">{firstName(entry.child)}</span>
                                {entry.time && <span className="text-[10px] text-gray-400 ml-1">{entry.time}</span>}
                                {entry.link_url && <a href={entry.link_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:text-blue-600 ml-1">{entry.link_label || "↗"}</a>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {totalEvents === 0 && (
                      <p className="text-sm text-gray-300 text-center py-2">No activities</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
