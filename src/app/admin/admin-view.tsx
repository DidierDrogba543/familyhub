"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface DbOperation {
  op: "update" | "update_json" | "dismiss_item";
  table?: string;
  match?: Record<string, string>;
  set?: Record<string, unknown>;
  field?: string;
  append?: unknown;
  item_ids?: string[];
}

interface Suggestion {
  type: "LINK" | "MISSING" | "MERGE" | "DISMISS" | "ENRICH" | "VERIFY";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  action: string;
  entity_type: string;
  entity_name: string;
  db_operation?: DbOperation;
}

const typeConfig: Record<string, { icon: string; color: string; bg: string }> = {
  LINK: { icon: "🔗", color: "text-purple-700", bg: "bg-purple-50 border-purple-200" },
  MISSING: { icon: "⚠️", color: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
  MERGE: { icon: "🔀", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  DISMISS: { icon: "🗑️", color: "text-gray-700", bg: "bg-gray-50 border-gray-200" },
  ENRICH: { icon: "✨", color: "text-green-700", bg: "bg-green-50 border-green-200" },
  VERIFY: { icon: "❓", color: "text-red-700", bg: "bg-red-50 border-red-200" },
};

const priorityBadge: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-gray-100 text-gray-500",
};

type SuggestionStatus = "pending" | "applying" | "applied" | "dismissed" | "editing" | "error";

export default function AdminView() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [statuses, setStatuses] = useState<SuggestionStatus[]>([]);
  const [editValues, setEditValues] = useState<Record<number, Record<string, string>>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [householdId, setHouseholdId] = useState("");
  const [lastRun, setLastRun] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/"; return; }
      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (household) setHouseholdId(household.id);
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = async () => {
    if (!householdId) return;
    setLoading(true);
    setSuggestions([]);
    setStatuses([]);
    setEditValues({});
    setErrors({});

    try {
      const res = await fetch("/api/admin/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId }),
      });
      const data = await res.json();
      const s = data.suggestions || [];
      setSuggestions(s);
      setStatuses(s.map(() => "pending" as SuggestionStatus));
      setLastRun(new Date().toLocaleTimeString("en-GB"));
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const applySuggestion = async (index: number, editedOperation?: DbOperation) => {
    const s = suggestions[index];
    const operation = editedOperation || s.db_operation;

    if (!operation) {
      setStatuses((prev) => { const n = [...prev]; n[index] = "applied"; return n; });
      return;
    }

    setStatuses((prev) => { const n = [...prev]; n[index] = "applying"; return n; });

    try {
      const res = await fetch("/api/admin/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdId,
          operation,
          suggestion: { title: s.title, type: s.type, action: s.action },
        }),
      });
      const result = await res.json();

      if (result.success) {
        setStatuses((prev) => { const n = [...prev]; n[index] = "applied"; return n; });
      } else {
        setErrors((prev) => ({ ...prev, [index]: result.error || "Unknown error" }));
        setStatuses((prev) => { const n = [...prev]; n[index] = "error"; return n; });
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, [index]: String(err) }));
      setStatuses((prev) => { const n = [...prev]; n[index] = "error"; return n; });
    }
  };

  const dismissSuggestion = (index: number) => {
    setStatuses((prev) => { const n = [...prev]; n[index] = "dismissed"; return n; });
  };

  const startEditing = (index: number) => {
    const s = suggestions[index];
    const op = s.db_operation;
    if (!op) return;

    // Pre-populate edit form with the operation values
    const values: Record<string, string> = {};
    if (op.op === "update" && op.set) {
      for (const [k, v] of Object.entries(op.set)) {
        values[k] = String(v ?? "");
      }
    } else if (op.op === "update_json" && op.append) {
      if (typeof op.append === "object" && op.append !== null) {
        for (const [k, v] of Object.entries(op.append as Record<string, unknown>)) {
          values[k] = String(v ?? "");
        }
      }
    }
    setEditValues((prev) => ({ ...prev, [index]: values }));
    setStatuses((prev) => { const n = [...prev]; n[index] = "editing"; return n; });
  };

  const saveEdit = (index: number) => {
    const s = suggestions[index];
    const op = s.db_operation;
    if (!op) return;

    const values = editValues[index] || {};

    // Rebuild the operation with edited values
    let editedOp: DbOperation;
    if (op.op === "update") {
      const editedSet: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        editedSet[k] = v;
      }
      editedOp = { ...op, set: editedSet };
    } else if (op.op === "update_json") {
      const editedAppend: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        editedAppend[k] = v;
      }
      editedOp = { ...op, append: editedAppend };
    } else {
      editedOp = op;
    }

    applySuggestion(index, editedOp);
  };

  const cancelEdit = (index: number) => {
    setStatuses((prev) => { const n = [...prev]; n[index] = "pending"; return n; });
  };

  const pendingCount = statuses.filter((s) => s === "pending").length;
  const appliedCount = statuses.filter((s) => s === "applied").length;
  const dismissedCount = statuses.filter((s) => s === "dismissed").length;
  const highCount = suggestions.filter((s, i) => s.priority === "high" && statuses[i] === "pending").length;

  // Group pending by type
  const grouped: Record<string, { suggestion: Suggestion; index: number }[]> = {};
  suggestions.forEach((s, i) => {
    if (statuses[i] !== "pending" && statuses[i] !== "editing" && statuses[i] !== "applying" && statuses[i] !== "error") return;
    if (!grouped[s.type]) grouped[s.type] = [];
    grouped[s.type].push({ suggestion: s, index: i });
  });

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
            <p className="text-sm text-gray-400">AI suggestions with write-back</p>
          </div>
          <div className="flex gap-2 text-sm">
            <a href="/dashboard" className="text-blue-600 hover:text-blue-700">Dashboard</a>
            <span className="text-gray-300">|</span>
            <a href="/knowledge" className="text-blue-600 hover:text-blue-700">Knowledge</a>
          </div>
        </div>

        {/* Run Analysis */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">Knowledge Analysis</p>
              <p className="text-sm text-gray-400 mt-1">
                AI reviews your knowledge base and suggests changes you can approve, edit, or dismiss.
                {lastRun && ` Last run: ${lastRun}`}
              </p>
            </div>
            <button onClick={runAnalysis} disabled={loading || !householdId}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50">
              {loading ? "Analyzing..." : "Run Analysis"}
            </button>
          </div>
        </div>

        {/* Stats */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-gray-900">{pendingCount}</p>
              <p className="text-xs text-gray-400">Pending</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-red-600">{highCount}</p>
              <p className="text-xs text-gray-400">High Priority</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-green-600">{appliedCount}</p>
              <p className="text-xs text-gray-400">Applied</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-gray-400">{dismissedCount}</p>
              <p className="text-xs text-gray-400">Dismissed</p>
            </div>
          </div>
        )}

        {/* Suggestions */}
        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{typeConfig[type]?.icon || "📋"}</span>
              <h2 className={`text-sm font-semibold uppercase tracking-wide ${typeConfig[type]?.color || "text-gray-500"}`}>
                {type} ({items.length})
              </h2>
            </div>

            <div className="space-y-3">
              {items.map(({ suggestion: s, index }) => (
                <div key={index} className={`rounded-xl p-5 border ${typeConfig[s.type]?.bg || "bg-white border-gray-200"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{s.title}</p>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${priorityBadge[s.priority]}`}>{s.priority}</span>
                        {statuses[index] === "applying" && <span className="text-xs text-blue-500 animate-pulse">Applying...</span>}
                        {statuses[index] === "error" && <span className="text-xs text-red-500">Error</span>}
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed">{s.description}</p>

                      {/* Action description */}
                      <div className="mt-3 bg-white/60 rounded-lg p-3 border border-gray-200/50">
                        <p className="text-xs text-gray-400 mb-1">Suggested action:</p>
                        <p className="text-sm text-gray-700">{s.action}</p>
                      </div>

                      {/* DB Operation preview */}
                      {s.db_operation && statuses[index] !== "editing" && (
                        <div className="mt-2 bg-gray-900 rounded-lg p-3 text-xs font-mono text-green-400 overflow-x-auto">
                          <span className="text-gray-500">{s.db_operation.op}</span> {s.db_operation.table || ""}
                          {s.db_operation.set && (
                            <span> SET {Object.entries(s.db_operation.set).map(([k, v]) => `${k}="${v}"`).join(", ")}</span>
                          )}
                          {s.db_operation.append && (
                            <span> APPEND {JSON.stringify(s.db_operation.append)}</span>
                          )}
                          {s.db_operation.item_ids && (
                            <span> IDS [{s.db_operation.item_ids.length} items]</span>
                          )}
                        </div>
                      )}

                      {/* Edit form */}
                      {statuses[index] === "editing" && editValues[index] && (
                        <div className="mt-3 bg-white rounded-lg p-4 border-2 border-blue-300 space-y-2">
                          <p className="text-xs font-semibold text-blue-600 mb-2">Edit values before applying:</p>
                          {Object.entries(editValues[index]).map(([key, val]) => (
                            <div key={key} className="flex items-center gap-2">
                              <label className="text-xs text-gray-500 w-32 shrink-0">{key}</label>
                              <input
                                type="text"
                                value={val}
                                onChange={(e) => setEditValues((prev) => ({
                                  ...prev,
                                  [index]: { ...prev[index], [key]: e.target.value },
                                }))}
                                className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                              />
                            </div>
                          ))}
                          <div className="flex gap-2 mt-3">
                            <button onClick={() => saveEdit(index)} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Apply Changes</button>
                            <button onClick={() => cancelEdit(index)} className="px-4 py-2 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                          </div>
                        </div>
                      )}

                      {/* Error message */}
                      {statuses[index] === "error" && errors[index] && (
                        <p className="mt-2 text-xs text-red-500 bg-red-50 rounded-lg p-2">{errors[index]}</p>
                      )}

                      <div className="flex gap-2 mt-2">
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{s.entity_type}</span>
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{s.entity_name}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    {(statuses[index] === "pending" || statuses[index] === "error") && (
                      <div className="flex flex-col gap-2 shrink-0">
                        <button onClick={() => applySuggestion(index)}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                          Apply
                        </button>
                        {s.db_operation && (s.db_operation.op === "update" || s.db_operation.op === "update_json") && (
                          <button onClick={() => startEditing(index)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                            Edit
                          </button>
                        )}
                        <button onClick={() => dismissSuggestion(index)}
                          className="px-4 py-2 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50">
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Applied items */}
        {appliedCount > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-green-600 uppercase tracking-wide mb-3">Applied ({appliedCount})</h2>
            <div className="space-y-2">
              {suggestions.map((s, i) => statuses[i] === "applied" ? (
                <div key={i} className="bg-green-50 rounded-xl p-4 border border-green-200">
                  <div className="flex items-center gap-2">
                    <span className="text-green-600">✓</span>
                    <p className="text-sm font-medium text-green-800">{s.title}</p>
                    <span className="text-xs text-green-500 ml-auto">Written to database</span>
                  </div>
                </div>
              ) : null)}
            </div>
          </div>
        )}

        {/* Dismissed items */}
        {dismissedCount > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Dismissed ({dismissedCount})</h2>
            <div className="space-y-1">
              {suggestions.map((s, i) => statuses[i] === "dismissed" ? (
                <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-200 opacity-50">
                  <p className="text-xs text-gray-500">{s.title}</p>
                </div>
              ) : null)}
            </div>
          </div>
        )}

        {/* Empty / Loading states */}
        {!loading && suggestions.length === 0 && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <p className="text-4xl mb-4">🧠</p>
            <p className="text-gray-400 text-lg mb-2">Ready to analyze</p>
            <p className="text-sm text-gray-300">Click "Run Analysis" to get AI suggestions for your knowledge base.</p>
          </div>
        )}
        {loading && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
            <p className="text-4xl mb-4 animate-pulse">🧠</p>
            <p className="text-gray-400 text-lg mb-2">Analyzing...</p>
            <p className="text-sm text-gray-300">Reviewing schools, clubs, children, family data, and extracted items.</p>
          </div>
        )}
      </div>
    </div>
  );
}
