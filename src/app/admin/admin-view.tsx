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

interface SavedSuggestion {
  id: string;
  type: string;
  priority: string;
  title: string;
  description: string;
  action: string;
  entity_type: string;
  entity_name: string;
  db_operation: DbOperation | null;
  status: "pending" | "applied" | "dismissed";
  run_id: string;
  created_at: string;
  applied_at: string | null;
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

export default function AdminView() {
  const [suggestions, setSuggestions] = useState<SavedSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [householdId, setHouseholdId] = useState("");
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showCompleted, setShowCompleted] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/"; return; }
      const { data: household } = await supabase.from("households").select("id").eq("owner_user_id", user.id).single();
      if (!household) return;
      setHouseholdId(household.id);
      await loadSuggestions(household.id);
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSuggestions = async (hid: string) => {
    const { data } = await supabase
      .from("admin_suggestions")
      .select("*")
      .eq("household_id", hid)
      .order("created_at", { ascending: false })
      .limit(100);
    setSuggestions(data ?? []);
    setLoading(false);
  };

  const runAnalysis = async () => {
    if (!householdId) return;
    setAnalyzing(true);
    try {
      await fetch("/api/admin/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId }),
      });
      await loadSuggestions(householdId);
    } catch (err) {
      console.error("Analysis failed:", err);
    } finally {
      setAnalyzing(false);
    }
  };

  const applySuggestion = async (s: SavedSuggestion, editedOperation?: DbOperation) => {
    const operation = editedOperation || s.db_operation;
    setApplyingIds((prev) => new Set([...prev, s.id]));
    setErrors((prev) => { const n = { ...prev }; delete n[s.id]; return n; });

    try {
      const res = await fetch("/api/admin/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdId,
          operation,
          suggestion: { title: s.title, type: s.type, action: s.action },
          suggestionId: s.id,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setSuggestions((prev) => prev.map((x) => x.id === s.id ? { ...x, status: "applied", applied_at: new Date().toISOString() } : x));
      } else {
        setErrors((prev) => ({ ...prev, [s.id]: result.error || "Unknown error" }));
      }
    } catch (err) {
      setErrors((prev) => ({ ...prev, [s.id]: String(err) }));
    } finally {
      setApplyingIds((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
      setEditingId(null);
    }
  };

  const dismissSuggestion = async (s: SavedSuggestion) => {
    try {
      await fetch("/api/admin/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionId: s.id }),
      });
      setSuggestions((prev) => prev.map((x) => x.id === s.id ? { ...x, status: "dismissed" } : x));
    } catch (err) {
      console.error("Dismiss failed:", err);
    }
  };

  const startEditing = (s: SavedSuggestion) => {
    const op = s.db_operation;
    if (!op) return;
    const values: Record<string, string> = {};
    if (op.op === "update" && op.set) {
      for (const [k, v] of Object.entries(op.set)) values[k] = String(v ?? "");
    } else if (op.op === "update_json" && op.append && typeof op.append === "object") {
      for (const [k, v] of Object.entries(op.append as Record<string, unknown>)) values[k] = String(v ?? "");
    }
    setEditValues(values);
    setEditingId(s.id);
  };

  const saveEdit = (s: SavedSuggestion) => {
    const op = s.db_operation;
    if (!op) return;
    let editedOp: DbOperation;
    if (op.op === "update") {
      editedOp = { ...op, set: { ...editValues } };
    } else if (op.op === "update_json") {
      editedOp = { ...op, append: { ...editValues } };
    } else {
      editedOp = op;
    }
    applySuggestion(s, editedOp);
  };

  const pending = suggestions.filter((s) => s.status === "pending");
  const applied = suggestions.filter((s) => s.status === "applied");
  const dismissed = suggestions.filter((s) => s.status === "dismissed");

  // Group pending by type
  const grouped: Record<string, SavedSuggestion[]> = {};
  pending.forEach((s) => {
    if (!grouped[s.type]) grouped[s.type] = [];
    grouped[s.type].push(s);
  });

  // Group by run for history
  const runs = [...new Set(suggestions.map((s) => s.run_id))];
  const latestRun = runs[0];
  const latestRunDate = suggestions.find((s) => s.run_id === latestRun)?.created_at;

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;

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
                {latestRunDate ? `Last run: ${new Date(latestRunDate).toLocaleString("en-GB")}` : "No analysis run yet"}
                {runs.length > 1 && ` · ${runs.length} runs total`}
              </p>
            </div>
            <button onClick={runAnalysis} disabled={analyzing || !householdId}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50">
              {analyzing ? "Analyzing..." : "Run Analysis"}
            </button>
          </div>
        </div>

        {/* Stats */}
        {suggestions.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-amber-600">{pending.length}</p>
              <p className="text-xs text-gray-400">Pending</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-green-600">{applied.length}</p>
              <p className="text-xs text-gray-400">Applied</p>
            </div>
            <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
              <p className="text-2xl font-bold text-gray-400">{dismissed.length}</p>
              <p className="text-xs text-gray-400">Dismissed</p>
            </div>
          </div>
        )}

        {/* Pending Suggestions grouped by type */}
        {Object.entries(grouped).map(([type, items]) => (
          <div key={type} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{typeConfig[type]?.icon || "📋"}</span>
              <h2 className={`text-sm font-semibold uppercase tracking-wide ${typeConfig[type]?.color || "text-gray-500"}`}>
                {type} ({items.length})
              </h2>
            </div>
            <div className="space-y-3">
              {items.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  isApplying={applyingIds.has(s.id)}
                  isEditing={editingId === s.id}
                  editValues={editingId === s.id ? editValues : undefined}
                  error={errors[s.id]}
                  onApply={() => applySuggestion(s)}
                  onEdit={() => startEditing(s)}
                  onSaveEdit={() => saveEdit(s)}
                  onCancelEdit={() => setEditingId(null)}
                  onDismiss={() => dismissSuggestion(s)}
                  onEditChange={(k, v) => setEditValues((prev) => ({ ...prev, [k]: v }))}
                />
              ))}
            </div>
          </div>
        ))}

        {pending.length === 0 && !analyzing && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center mb-6">
            <p className="text-4xl mb-4">🧠</p>
            <p className="text-gray-400 text-lg mb-2">{suggestions.length > 0 ? "All caught up" : "Ready to analyze"}</p>
            <p className="text-sm text-gray-300">{suggestions.length > 0 ? "No pending suggestions. Run analysis to check for new ones." : "Click \"Run Analysis\" to get AI suggestions."}</p>
          </div>
        )}

        {analyzing && (
          <div className="bg-white rounded-xl p-12 border border-gray-200 text-center mb-6">
            <p className="text-4xl mb-4 animate-pulse">🧠</p>
            <p className="text-gray-400 text-lg">Analyzing...</p>
          </div>
        )}

        {/* Completed (toggle) */}
        {(applied.length > 0 || dismissed.length > 0) && (
          <div>
            <button onClick={() => setShowCompleted(!showCompleted)}
              className="text-sm text-gray-400 hover:text-gray-600 mb-3">
              {showCompleted ? "Hide" : "Show"} completed ({applied.length} applied, {dismissed.length} dismissed)
            </button>

            {showCompleted && (
              <div className="space-y-2">
                {applied.map((s) => (
                  <div key={s.id} className="bg-green-50 rounded-xl p-4 border border-green-200">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600">✓</span>
                      <p className="text-sm font-medium text-green-800">{s.title}</p>
                      <span className="text-xs text-green-500 ml-auto">{s.applied_at ? new Date(s.applied_at).toLocaleString("en-GB") : "Applied"}</span>
                    </div>
                    <p className="text-xs text-green-600 mt-1">{s.action}</p>
                  </div>
                ))}
                {dismissed.map((s) => (
                  <div key={s.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200 opacity-50">
                    <p className="text-xs text-gray-500">{s.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion: s, isApplying, isEditing, editValues, error, onApply, onEdit, onSaveEdit, onCancelEdit, onDismiss, onEditChange }: {
  suggestion: SavedSuggestion;
  isApplying: boolean;
  isEditing: boolean;
  editValues?: Record<string, string>;
  error?: string;
  onApply: () => void;
  onEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDismiss: () => void;
  onEditChange: (key: string, value: string) => void;
}) {
  return (
    <div className={`rounded-xl p-5 border ${typeConfig[s.type]?.bg || "bg-white border-gray-200"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-semibold text-gray-900">{s.title}</p>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${priorityBadge[s.priority] || priorityBadge.low}`}>{s.priority}</span>
            {isApplying && <span className="text-xs text-blue-500 animate-pulse">Applying...</span>}
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{s.description}</p>

          <div className="mt-3 bg-white/60 rounded-lg p-3 border border-gray-200/50">
            <p className="text-xs text-gray-400 mb-1">Suggested action:</p>
            <p className="text-sm text-gray-700">{s.action}</p>
          </div>

          {s.db_operation && !isEditing && (
            <div className="mt-2 bg-gray-900 rounded-lg p-3 text-xs font-mono text-green-400 overflow-x-auto">
              <span className="text-gray-500">{s.db_operation.op}</span> {s.db_operation.table || ""}
              {s.db_operation.set && <span> SET {Object.entries(s.db_operation.set).map(([k, v]) => `${k}="${v}"`).join(", ")}</span>}
              {s.db_operation.append && <span> APPEND {JSON.stringify(s.db_operation.append)}</span>}
              {s.db_operation.item_ids && <span> IDS [{s.db_operation.item_ids.length} items]</span>}
            </div>
          )}

          {isEditing && editValues && (
            <div className="mt-3 bg-white rounded-lg p-4 border-2 border-blue-300 space-y-2">
              <p className="text-xs font-semibold text-blue-600 mb-2">Edit values before applying:</p>
              {Object.entries(editValues).map(([key, val]) => (
                <div key={key} className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 w-32 shrink-0">{key}</label>
                  <input type="text" value={val} onChange={(e) => onEditChange(key, e.target.value)}
                    className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <button onClick={onSaveEdit} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Apply Changes</button>
                <button onClick={onCancelEdit} className="px-4 py-2 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-xs text-red-500 bg-red-50 rounded-lg p-2">{error}</p>}

          <div className="flex gap-2 mt-2">
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{s.entity_type}</span>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{s.entity_name}</span>
            <span className="text-[10px] text-gray-300 ml-auto">{new Date(s.created_at).toLocaleDateString("en-GB")}</span>
          </div>
        </div>

        {!isEditing && (
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={onApply} disabled={isApplying}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              Apply
            </button>
            {s.db_operation && (s.db_operation.op === "update" || s.db_operation.op === "update_json") && (
              <button onClick={onEdit}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                Edit
              </button>
            )}
            <button onClick={onDismiss}
              className="px-4 py-2 border border-gray-300 text-gray-500 rounded-lg text-sm hover:bg-gray-50">
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
