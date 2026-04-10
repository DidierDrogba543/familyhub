"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface CalendarEvent {
  id: string;
  title: string;
  day_of_week: string;
  start_time: string;
  end_time: string | null;
  child_name: string | null;
  event_type: string;
  location: string | null;
}

interface Holiday {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  holiday_type: string;
  applies_to: string | null;
}

interface ChildData {
  name: string;
  activities: { activity_name: string; day_of_week: string | null; time_slot: string | null }[];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_COLORS: Record<string, string> = {
  school: "bg-blue-100 border-l-blue-500 text-blue-900",
  club: "bg-amber-50 border-l-amber-500 text-amber-900",
  sport: "bg-pink-50 border-l-pink-500 text-pink-900",
  music: "bg-purple-50 border-l-purple-500 text-purple-900",
  other: "bg-gray-50 border-l-gray-400 text-gray-900",
};

export default function CalendarView() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [children, setChildren] = useState<ChildData[]>([]);
  const [householdId, setHouseholdId] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [showAddHoliday, setShowAddHoliday] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: "", day_of_week: "Monday", start_time: "15:30", end_time: "16:30",
    child_name: "", event_type: "club", location: "",
  });
  const [newHoliday, setNewHoliday] = useState({
    title: "", start_date: "", end_date: "", holiday_type: "school", applies_to: "all",
  });
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

      const { data: household } = await supabase
        .from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) return;
      setHouseholdId(household.id);

      const [eventsRes, holidaysRes, childrenRes] = await Promise.all([
        supabase.from("recurring_events").select("*").eq("household_id", household.id),
        supabase.from("holiday_dates").select("*").eq("household_id", household.id).order("start_date"),
        supabase.from("children").select("id, name").eq("household_id", household.id),
      ]);

      setEvents(eventsRes.data ?? []);
      setHolidays(holidaysRes.data ?? []);

      // Also load child activities as events
      const childrenWithActs: ChildData[] = [];
      for (const child of childrenRes.data ?? []) {
        const { data: acts } = await supabase
          .from("child_activities").select("activity_name, day_of_week, time_slot").eq("child_id", child.id);
        childrenWithActs.push({ name: child.name, activities: acts ?? [] });
      }
      setChildren(childrenWithActs);
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addEvent = async () => {
    if (!newEvent.title || !householdId) return;
    const { data } = await supabase.from("recurring_events").insert({
      household_id: householdId, ...newEvent,
      child_name: newEvent.child_name || null,
      end_time: newEvent.end_time || null,
      location: newEvent.location || null,
    }).select("*").single();
    if (data) {
      setEvents([...events, data]);
      setNewEvent({ title: "", day_of_week: "Monday", start_time: "15:30", end_time: "16:30", child_name: "", event_type: "club", location: "" });
      setShowAddEvent(false);
    }
  };

  const addHoliday = async () => {
    if (!newHoliday.title || !newHoliday.start_date || !householdId) return;
    const { data } = await supabase.from("holiday_dates").insert({
      household_id: householdId,
      ...newHoliday,
      end_date: newHoliday.end_date || newHoliday.start_date,
      applies_to: newHoliday.applies_to || "all",
    }).select("*").single();
    if (data) {
      setHolidays([...holidays, data]);
      setNewHoliday({ title: "", start_date: "", end_date: "", holiday_type: "school", applies_to: "all" });
      setShowAddHoliday(false);
    }
  };

  const removeEvent = async (id: string) => {
    await supabase.from("recurring_events").delete().eq("id", id);
    setEvents(events.filter((e) => e.id !== id));
  };

  const removeHoliday = async (id: string) => {
    await supabase.from("holiday_dates").delete().eq("id", id);
    setHolidays(holidays.filter((h) => h.id !== id));
  };

  // Get dates for the current week
  const weekDates = DAYS.map((_, i) => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  // Check if a date falls within any holiday
  const getHolidayForDate = (date: Date) => {
    const dateStr = date.toISOString().split("T")[0];
    return holidays.find((h) => dateStr >= h.start_date && dateStr <= h.end_date);
  };

  // Get events for a day (recurring events + child activities)
  const getEventsForDay = (dayName: string) => {
    const recurring = events.filter((e) => e.day_of_week === dayName);
    const fromActivities: CalendarEvent[] = children.flatMap((child) =>
      child.activities
        .filter((a) => a.day_of_week === dayName)
        .map((a) => ({
          id: `act-${child.name}-${a.activity_name}`,
          title: a.activity_name,
          day_of_week: dayName,
          start_time: a.time_slot?.split("-")[0]?.trim() || "15:30",
          end_time: a.time_slot?.split("-")[1]?.trim() || null,
          child_name: child.name,
          event_type: "club",
          location: null,
        }))
    );
    return [...recurring, ...fromActivities].sort((a, b) => a.start_time.localeCompare(b.start_time));
  };

  const prevWeek = () => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - 7);
    setCurrentWeekStart(d);
  };
  const nextWeek = () => {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + 7);
    setCurrentWeekStart(d);
  };
  const thisWeek = () => {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    setCurrentWeekStart(monday);
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;
  }

  const childNames = children.map((c) => c.name);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Weekly Calendar</h1>
            <p className="text-sm text-gray-400">
              {weekDates[0].toLocaleDateString("en-GB", { day: "numeric", month: "short" })} — {weekDates[6].toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={prevWeek} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">&lt;</button>
            <button onClick={thisWeek} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Today</button>
            <button onClick={nextWeek} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">&gt;</button>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-2 mb-6">
          <a href="/dashboard" className="text-sm text-blue-600 hover:text-blue-700">Dashboard</a>
          <span className="text-gray-300">|</span>
          <a href="/clubs" className="text-sm text-blue-600 hover:text-blue-700">Clubs</a>
        </div>

        {/* Week grid */}
        <div className="grid grid-cols-5 gap-3 mb-8">
          {DAYS.slice(0, 5).map((day, i) => {
            const date = weekDates[i];
            const holiday = getHolidayForDate(date);
            const dayEvents = getEventsForDay(day);
            const isToday = date.toDateString() === new Date().toDateString();

            return (
              <div key={day} className={`rounded-xl border ${isToday ? "border-blue-400 bg-blue-50/30" : "border-gray-200 bg-white"}`}>
                <div className={`px-3 py-2 border-b ${isToday ? "border-blue-200" : "border-gray-100"}`}>
                  <p className="text-xs text-gray-400">{day}</p>
                  <p className={`text-lg font-semibold ${isToday ? "text-blue-600" : "text-gray-900"}`}>
                    {date.getDate()}
                  </p>
                </div>

                <div className="p-2 min-h-[120px]">
                  {holiday && (
                    <div className="bg-red-50 border-l-2 border-l-red-400 rounded px-2 py-1.5 mb-2">
                      <p className="text-xs font-medium text-red-700">{holiday.title}</p>
                      <p className="text-[10px] text-red-400">No school</p>
                    </div>
                  )}

                  {!holiday && dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className={`border-l-2 rounded px-2 py-1.5 mb-1.5 ${DAY_COLORS[event.event_type] || DAY_COLORS.other}`}
                    >
                      <p className="text-xs font-medium">{event.title}</p>
                      <p className="text-[10px] opacity-70">
                        {event.start_time}{event.end_time ? ` - ${event.end_time}` : ""}
                        {event.child_name ? ` · ${event.child_name}` : ""}
                      </p>
                    </div>
                  ))}

                  {!holiday && dayEvents.length === 0 && (
                    <p className="text-xs text-gray-300 text-center pt-4">No events</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Weekend (collapsed) */}
        <div className="grid grid-cols-2 gap-3 mb-8">
          {DAYS.slice(5).map((day, i) => {
            const date = weekDates[i + 5];
            const dayEvents = getEventsForDay(day);
            return (
              <div key={day} className="rounded-xl border border-gray-200 bg-white">
                <div className="px-3 py-2 border-b border-gray-100">
                  <p className="text-xs text-gray-400">{day} {date.getDate()}</p>
                </div>
                <div className="p-2 min-h-[60px]">
                  {dayEvents.map((event) => (
                    <div key={event.id} className={`border-l-2 rounded px-2 py-1 mb-1 ${DAY_COLORS[event.event_type] || DAY_COLORS.other}`}>
                      <p className="text-xs font-medium">{event.title}</p>
                      <p className="text-[10px] opacity-70">{event.start_time} · {event.child_name}</p>
                    </div>
                  ))}
                  {dayEvents.length === 0 && <p className="text-xs text-gray-300 text-center pt-2">Free</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add buttons */}
        <div className="flex gap-3 mb-6">
          <button onClick={() => setShowAddEvent(true)} className="flex-1 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 hover:text-gray-500 text-sm">+ Add event</button>
          <button onClick={() => setShowAddHoliday(true)} className="flex-1 py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:border-gray-400 hover:text-gray-500 text-sm">+ Add holiday</button>
        </div>

        {/* Add Event Form */}
        {showAddEvent && (
          <div className="bg-white rounded-xl p-6 mb-6 border-2 border-blue-200">
            <h3 className="font-semibold text-gray-900 mb-4">Add recurring event</h3>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={newEvent.title} onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })} placeholder="Event name" className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <select value={newEvent.day_of_week} onChange={(e) => setNewEvent({ ...newEvent, day_of_week: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={newEvent.event_type} onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="school">School</option>
                <option value="club">Club</option>
                <option value="sport">Sport</option>
                <option value="music">Music</option>
                <option value="other">Other</option>
              </select>
              <input type="time" value={newEvent.start_time} onChange={(e) => setNewEvent({ ...newEvent, start_time: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input type="time" value={newEvent.end_time} onChange={(e) => setNewEvent({ ...newEvent, end_time: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <select value={newEvent.child_name} onChange={(e) => setNewEvent({ ...newEvent, child_name: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="">All children</option>
                {childNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input type="text" value={newEvent.location} onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })} placeholder="Location (optional)" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addEvent} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Save</button>
              <button onClick={() => setShowAddEvent(false)} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {/* Add Holiday Form */}
        {showAddHoliday && (
          <div className="bg-white rounded-xl p-6 mb-6 border-2 border-red-200">
            <h3 className="font-semibold text-gray-900 mb-4">Add holiday / closure</h3>
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={newHoliday.title} onChange={(e) => setNewHoliday({ ...newHoliday, title: e.target.value })} placeholder="e.g. Half Term, Inset Day" className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start date</label>
                <input type="date" value={newHoliday.start_date} onChange={(e) => setNewHoliday({ ...newHoliday, start_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End date</label>
                <input type="date" value={newHoliday.end_date} onChange={(e) => setNewHoliday({ ...newHoliday, end_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <select value={newHoliday.holiday_type} onChange={(e) => setNewHoliday({ ...newHoliday, holiday_type: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="school">School holiday</option>
                <option value="bank_holiday">Bank holiday</option>
                <option value="inset_day">Inset day</option>
                <option value="family">Family holiday</option>
                <option value="other">Other</option>
              </select>
              <select value={newHoliday.applies_to} onChange={(e) => setNewHoliday({ ...newHoliday, applies_to: e.target.value })} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="all">All children</option>
                {childNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={addHoliday} className="flex-1 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600">Save</button>
              <button onClick={() => setShowAddHoliday(false)} className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {/* Holidays list */}
        {holidays.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Upcoming Holidays</h2>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {holidays.map((h) => (
                <div key={h.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{h.title}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(h.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      {h.end_date !== h.start_date && ` — ${new Date(h.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                      {" · "}{h.holiday_type} · {h.applies_to || "all"}
                    </p>
                  </div>
                  <button onClick={() => removeHoliday(h.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recurring events list */}
        {events.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Recurring Events</h2>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              {events.map((e) => (
                <div key={e.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{e.title}</p>
                    <p className="text-xs text-gray-400">
                      {e.day_of_week} {e.start_time}{e.end_time ? `-${e.end_time}` : ""}
                      {e.child_name ? ` · ${e.child_name}` : ""}
                      {e.location ? ` · ${e.location}` : ""}
                    </p>
                  </div>
                  <button onClick={() => removeEvent(e.id)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
