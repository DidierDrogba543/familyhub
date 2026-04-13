"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";

interface GraphData {
  schools: { school_name: string; staff: { name: string; role: string }[]; payment_systems: { name: string }[] }[];
  clubs: { club_name: string; school_name: string | null; day_of_week: string | null; provider: string | null; is_external: boolean }[];
  children: { name: string; school_name: string; activities: { activity_name: string; day_of_week: string | null }[] }[];
  family: { parents: { name: string }[]; emergency_contacts: { name: string }[] } | null;
  logins: { provider_name: string; category: string }[];
}

const nodeColors: Record<string, { bg: string; border: string; text: string }> = {
  family: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  child: { bg: "#ede9fe", border: "#8b5cf6", text: "#5b21b6" },
  school: { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  club: { bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  staff: { bg: "#f3f4f6", border: "#9ca3af", text: "#374151" },
  provider: { bg: "#fce7f3", border: "#ec4899", text: "#9d174d" },
  parent: { bg: "#fff7ed", border: "#f97316", text: "#9a3412" },
  login: { bg: "#f0fdf4", border: "#22c55e", text: "#166534" },
};

function makeNode(id: string, label: string, type: string, x: number, y: number, subtitle?: string): Node {
  const color = nodeColors[type] || nodeColors.staff;
  return {
    id,
    position: { x, y },
    data: {
      label: (
        <div style={{ textAlign: "center", padding: "4px 8px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: color.text }}>{label}</div>
          {subtitle && <div style={{ fontSize: 9, color: color.text, opacity: 0.7, marginTop: 2 }}>{subtitle}</div>}
        </div>
      ),
    },
    style: {
      background: color.bg,
      border: `2px solid ${color.border}`,
      borderRadius: 12,
      padding: 4,
      minWidth: 100,
    },
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
  };
}

function makeEdge(source: string, target: string, label?: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    label,
    labelStyle: { fontSize: 9, fill: "#9ca3af" },
    style: { stroke: "#d1d5db", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "#d1d5db" },
    type: "smoothstep",
  };
}

export default function OntologyGraph({ data }: { data: GraphData }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const centerX = 400;
    let y = 0;

    // Family node at the top
    nodes.push(makeNode("family", "Cotton Family", "family", centerX - 60, y));

    // Parents
    const parents = data.family?.parents || [];
    parents.forEach((p, i) => {
      const x = centerX - 200 + i * 200;
      nodes.push(makeNode(`parent-${i}`, p.name, "parent", x, y + 80));
      edges.push(makeEdge("family", `parent-${i}`, "parent"));
    });

    // Children row
    y = 200;
    const childSpacing = 280;
    const childStartX = centerX - ((data.children.length - 1) * childSpacing) / 2;

    data.children.forEach((child, ci) => {
      const cx = childStartX + ci * childSpacing;
      const childId = `child-${ci}`;
      nodes.push(makeNode(childId, child.name, "child", cx - 50, y, child.school_name));
      edges.push(makeEdge("family", childId, "child"));

      // Child's activities (clubs)
      const actY = y + 100;
      const actSpacing = 120;
      const actStartX = cx - ((child.activities.length - 1) * actSpacing) / 2;

      child.activities.forEach((act, ai) => {
        const actId = `act-${ci}-${ai}`;
        const ax = actStartX + ai * actSpacing;
        // Check if it's a known club
        const isClub = data.clubs.some((c) => c.club_name === act.activity_name);
        nodes.push(makeNode(actId, act.activity_name, isClub ? "club" : "club", ax - 40, actY, act.day_of_week || undefined));
        edges.push(makeEdge(childId, actId, "attends"));
      });
    });

    // Schools
    y = 480;
    data.schools.forEach((school, si) => {
      const schoolId = `school-${si}`;
      const sx = centerX - 60;
      nodes.push(makeNode(schoolId, school.school_name, "school", sx, y, `${(school.staff || []).length} staff`));

      // Connect children to school
      data.children.forEach((child, ci) => {
        if (child.school_name === school.school_name || child.school_name?.includes(school.school_name)) {
          edges.push(makeEdge(`child-${ci}`, schoolId, "attends"));
        }
      });

      // Key staff (leadership only to avoid clutter)
      const leadership = (school.staff || []).filter((s) =>
        s.role.toLowerCase().includes("head") || s.role.toLowerCase().includes("senco") || s.role.toLowerCase().includes("business")
      ).slice(0, 5);

      leadership.forEach((staff, sti) => {
        const staffId = `staff-${si}-${sti}`;
        const stx = sx - 200 + sti * 120;
        nodes.push(makeNode(staffId, staff.name, "staff", stx, y + 90, staff.role.split("(")[0].trim()));
        edges.push(makeEdge(schoolId, staffId, "staff"));
      });

      // Payment systems
      (school.payment_systems || []).forEach((ps, pi) => {
        const psId = `payment-${si}-${pi}`;
        nodes.push(makeNode(psId, ps.name, "login", sx + 300 + pi * 130, y, "payment"));
        edges.push(makeEdge(schoolId, psId, "uses"));
      });
    });

    // External providers (logins)
    if (data.logins.length > 0) {
      y = 650;
      const loginStartX = centerX - ((data.logins.length - 1) * 150) / 2;
      data.logins.forEach((login, li) => {
        const loginId = `login-${li}`;
        nodes.push(makeNode(loginId, login.provider_name, "login", loginStartX + li * 150 - 50, y, login.category));
        edges.push(makeEdge("family", loginId, "account"));
      });
    }

    return { nodes, edges };
  }, [data]);

  return (
    <div style={{ width: "100%", height: 700 }} className="bg-white rounded-xl border border-gray-200">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#f1f5f9" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
