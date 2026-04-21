// src/components/graph/GraphView.tsx
//
// 【設計意図】
// OKR・KR・TF・ToDo・Task・Projectの関係性をObsidian風のグラフで可視化する。
// D3.jsを使わず、Canvas + カスタム物理シミュレーションで実装。
// ラボ機能（プロトタイプ）として位置づけ。

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";
import type { Member } from "../../lib/localData/types";

interface Props {
  onClose: () => void;
  currentUser: Member;
  onOpenTask: (taskId: string) => void;
}

type NodeType = "objective" | "kr" | "tf" | "todo" | "project" | "task";

interface GNode {
  id: string;
  label: string;
  type: NodeType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean;
  // task固有フィールド（typeが"task"の時のみ使用）
  taskStatus?: "todo" | "in_progress" | "done";
  taskDueDate?: string | null;
  taskAssigneeIds?: string[];
}

interface GEdge {
  source: string;
  target: string;
}

const NODE_CONFIG: Record<NodeType, { radius: number; shortLabel: string; baseColor: string }> = {
  objective: { radius: 20, shortLabel: "O",    baseColor: "#F59E0B" },
  kr:        { radius: 14, shortLabel: "KR",   baseColor: "#3B82F6" },
  tf:        { radius: 11, shortLabel: "TF",   baseColor: "#8B5CF6" },
  todo:      { radius: 9,  shortLabel: "ToDo", baseColor: "#10B981" },
  project:   { radius: 11, shortLabel: "PJ",   baseColor: "#EF4444" },
  task:      { radius: 7,  shortLabel: "",     baseColor: "#6B7280" },
};

const EDGE_COLOR: Record<string, string> = {
  "objective-kr":  "#3B82F6",
  "kr-tf":         "#8B5CF6",
  "tf-todo":       "#10B981",
  "todo-task":     "#9CA3AF",
  "project-task":  "#EF4444",
  "tf-project":    "#F97316",
};

const STATUS_LABEL: Record<string, string> = {
  todo: "未着手", in_progress: "進行中", done: "完了",
};

function getNodeColor(node: GNode, todayStr: string): string {
  if (node.type !== "task") return NODE_CONFIG[node.type].baseColor;
  if (node.taskStatus === "done") return "#9CA3AF";
  if (node.taskDueDate && node.taskDueDate < todayStr) return "#EF4444"; // 期限超過
  if (node.taskStatus === "in_progress") return "#3B82F6";
  return "#6B7280"; // todo
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function GraphView({ onClose, currentUser: _currentUser, onOpenTask }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef<{
    nodes: GNode[];
    edges: GEdge[];
    transform: { x: number; y: number; scale: number };
    drag: { nodeId: string | null; startX: number; startY: number; nodeOrigX: number; nodeOrigY: number; moved: boolean } | null;
    pan: { startX: number; startY: number; origX: number; origY: number } | null;
    hovered: string | null;
    alpha: number;
    animId: number;
    hiddenTypes: Set<NodeType>;
    clickStart: { x: number; y: number } | null;
  }>();

  const {
    objective, keyResults: rawKrs, taskForces: rawTfs,
    todos: rawTodos, tasks: rawTasks, projects: rawProjects,
    projectTaskForces, members,
  } = useAppData();

  // メンバーマップ（id→表示名）
  const memberMap = useMemo(
    () => new Map(members.map(m => [m.id, m])),
    [members]
  );

  // グラフデータ構築
  const { nodes, edges } = useMemo(() => {
    const krs      = rawKrs.filter(k => !k.is_deleted);
    const tfs      = rawTfs.filter(t => !t.is_deleted);
    const todos    = rawTodos.filter(t => !t.is_deleted);
    const tasks    = rawTasks.filter(t => !t.is_deleted);
    const projects = rawProjects.filter(p => !p.is_deleted);

    const nodes: GNode[] = [];
    const edges: GEdge[] = [];
    const rand = (r: number) => (Math.random() - 0.5) * r;

    if (objective) {
      nodes.push({ id: objective.id, label: objective.title, type: "objective",
        x: rand(30), y: rand(30), vx: 0, vy: 0, pinned: false });
    }

    krs.forEach(kr => {
      nodes.push({ id: kr.id, label: kr.title, type: "kr",
        x: rand(120), y: rand(120), vx: 0, vy: 0, pinned: false });
      if (objective) edges.push({ source: objective.id, target: kr.id });
    });

    tfs.forEach(tf => {
      nodes.push({ id: tf.id, label: `${tf.tf_number} ${tf.name}`, type: "tf",
        x: rand(180), y: rand(180), vx: 0, vy: 0, pinned: false });
      edges.push({ source: tf.kr_id, target: tf.id });
    });

    todos.forEach(todo => {
      nodes.push({ id: todo.id, label: (todo.name ?? todo.title).slice(0, 40), type: "todo",
        x: rand(240), y: rand(240), vx: 0, vy: 0, pinned: false });
      edges.push({ source: todo.tf_id, target: todo.id });
    });

    projects.forEach(pj => {
      nodes.push({ id: pj.id, label: pj.name, type: "project",
        x: rand(200), y: rand(200), vx: 0, vy: 0, pinned: false });
    });

    projectTaskForces.forEach(ptf => {
      const hasTF = tfs.find(t => t.id === ptf.tf_id);
      const hasPJ = projects.find(p => p.id === ptf.project_id);
      if (hasTF && hasPJ) edges.push({ source: ptf.tf_id, target: ptf.project_id });
    });

    tasks.forEach(task => {
      nodes.push({
        id: task.id, label: task.name, type: "task",
        x: rand(300), y: rand(300), vx: 0, vy: 0, pinned: false,
        taskStatus: task.status,
        taskDueDate: task.due_date,
        taskAssigneeIds: task.assignee_member_ids ?? (task.assignee_member_id ? [task.assignee_member_id] : []),
      });
      (task.todo_ids ?? []).forEach(id => edges.push({ source: id, target: task.id }));
      if (task.project_id) edges.push({ source: task.project_id, target: task.id });
    });

    return { nodes, edges };
  }, [objective, rawKrs, rawTfs, rawTodos, rawTasks, rawProjects, projectTaskForces]);

  // テーマ判定
  const isDark = () => document.documentElement.hasAttribute("data-theme");

  // Canvas描画
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const s = stateRef.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dark = isDark();
    const bg           = dark ? "#111827" : "#F9FAFB";
    const edgeBase     = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
    const labelColor   = dark ? "#E5E7EB" : "#111827";
    const tooltipBg    = dark ? "#1F2937" : "#FFFFFF";
    const tooltipBorder = dark ? "#374151" : "#E5E7EB";
    const today        = todayStr();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(s.transform.x, s.transform.y);
    ctx.scale(s.transform.scale, s.transform.scale);

    const nodeMap = new Map(s.nodes.map(n => [n.id, n]));

    // エッジ描画（非表示タイプは除外）
    s.edges.forEach(e => {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
      if (!src || !tgt) return;
      if (s.hiddenTypes.has(src.type) || s.hiddenTypes.has(tgt.type)) return;
      const key = `${src.type}-${tgt.type}`;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.strokeStyle = EDGE_COLOR[key] ?? edgeBase;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.2 / s.transform.scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // ノード描画（非表示タイプは除外）
    s.nodes.forEach(n => {
      if (s.hiddenTypes.has(n.type)) return;
      const cfg = NODE_CONFIG[n.type];
      const isHovered = s.hovered === n.id;
      const color = getNodeColor(n, today);
      const isClickable = n.type === "task";

      // 外縁グロー（ホバー時）
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, cfg.radius + (isClickable ? 7 : 5), 0, Math.PI * 2);
        ctx.fillStyle = color + "33";
        ctx.fill();
      }

      // 本体
      ctx.beginPath();
      ctx.arc(n.x, n.y, cfg.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = isHovered ? 1 : (n.taskStatus === "done" ? 0.55 : 0.85);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = isHovered && isClickable
        ? "rgba(255,255,255,0.9)"
        : dark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)";
      ctx.lineWidth = (isHovered && isClickable ? 2.5 : 1.5) / s.transform.scale;
      ctx.stroke();

      // ショートラベル（タスク以外）
      if (cfg.shortLabel && n.type !== "task") {
        const fontSize = Math.max(9, cfg.radius * 0.9);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = "#FFFFFF";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(cfg.shortLabel, n.x, n.y);
      }

      // ノード名ラベル（Objective・Project は常時表示、その他はhover時でtask以外）
      if (n.type === "objective" || n.type === "project" || (isHovered && n.type !== "task")) {
        const fontSize = Math.max(8, Math.min(11, cfg.radius * 0.75));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = labelColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const maxLen = 20;
        const label = n.label.length > maxLen ? n.label.slice(0, maxLen) + "…" : n.label;
        ctx.fillText(label, n.x, n.y + cfg.radius + 3);
      }
    });

    ctx.restore();

    // ツールチップ（スクリーン座標）
    if (s.hovered) {
      const n = nodeMap.get(s.hovered);
      if (n && !s.hiddenTypes.has(n.type)) {
        const sx = n.x * s.transform.scale + s.transform.x;
        const sy = n.y * s.transform.scale + s.transform.y;
        const cfg = NODE_CONFIG[n.type];

        if (n.type === "task") {
          // タスク：リッチツールチップ（名前・担当者・ステータス・期日）
          const lines: { text: string; bold?: boolean; color?: string }[] = [];
          const maxNameLen = 36;
          lines.push({
            text: n.label.length > maxNameLen ? n.label.slice(0, maxNameLen) + "…" : n.label,
            bold: true,
          });

          const assigneeNames = (n.taskAssigneeIds ?? [])
            .map(id => memberMap.get(id)?.short_name ?? "—")
            .join(", ");
          if (assigneeNames) lines.push({ text: `担当: ${assigneeNames}` });

          const statusText = STATUS_LABEL[n.taskStatus ?? "todo"];
          const isOverdue = n.taskDueDate && n.taskDueDate < today && n.taskStatus !== "done";
          lines.push({
            text: `状態: ${statusText}`,
            color: n.taskStatus === "done" ? "#9CA3AF"
              : n.taskStatus === "in_progress" ? "#3B82F6" : undefined,
          });

          if (n.taskDueDate) {
            lines.push({
              text: `期日: ${n.taskDueDate}${isOverdue ? " ⚠ 超過" : ""}`,
              color: isOverdue ? "#EF4444" : undefined,
            });
          }

          lines.push({ text: "クリックで編集", color: dark ? "#6B7280" : "#9CA3AF" });

          const padding = 8;
          const lineH = 17;
          const boxH = lines.length * lineH + padding * 2;

          ctx.font = "11px sans-serif";
          const maxW = Math.max(...lines.map(l => ctx.measureText(l.text).width));
          const boxW = maxW + padding * 2;

          let bx = sx + cfg.radius * s.transform.scale + 8;
          let by = sy - boxH / 2;
          if (bx + boxW > canvas.clientWidth - 4) bx = sx - cfg.radius * s.transform.scale - boxW - 8;
          if (by < 4) by = 4;
          if (by + boxH > canvas.clientHeight - 4) by = canvas.clientHeight - boxH - 4;

          ctx.fillStyle = tooltipBg;
          ctx.strokeStyle = tooltipBorder;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(bx, by, boxW, boxH, 6);
          ctx.fill();
          ctx.stroke();

          lines.forEach((line, i) => {
            ctx.font = line.bold ? "bold 11px sans-serif" : "11px sans-serif";
            ctx.fillStyle = line.color ?? labelColor;
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(line.text, bx + padding, by + padding + i * lineH);
          });
        } else {
          // 非タスク：シンプルツールチップ（名前のみ）
          const maxChars = 40;
          const text = n.label.length > maxChars ? n.label.slice(0, maxChars) + "…" : n.label;
          ctx.font = "11px sans-serif";
          const tw = ctx.measureText(text).width;
          const padding = 6;
          const bx = Math.min(sx + cfg.radius * s.transform.scale + 6, canvas.clientWidth - tw - padding * 2 - 4);
          const by = sy - 12;
          ctx.fillStyle = tooltipBg;
          ctx.strokeStyle = tooltipBorder;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(bx, by, tw + padding * 2, 22, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = labelColor;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(text, bx + padding, by + 11);
        }
      }
    }
  }, [memberMap]);

  // 物理シミュレーション 1ステップ
  const tick = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.alpha < 0.001) return;

    const nodeMap = new Map(s.nodes.map(n => [n.id, n]));

    // 反発力（全ペア）
    for (let i = 0; i < s.nodes.length; i++) {
      const a = s.nodes[i];
      if (a.pinned) continue;
      for (let j = i + 1; j < s.nodes.length; j++) {
        const b = s.nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const repulse = 1800 * s.alpha / (d * d);
        const fx = (dx / d) * repulse;
        const fy = (dy / d) * repulse;
        a.vx += fx; a.vy += fy;
        if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
      }
    }

    // バネ力（エッジ）
    const REST: Record<string, number> = {
      "objective-kr": 120, "kr-tf": 90, "tf-todo": 70,
      "todo-task": 55, "project-task": 55, "tf-project": 100,
    };
    s.edges.forEach(e => {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
      if (!src || !tgt) return;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const d  = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const key = `${src.type}-${tgt.type}`;
      const rest = REST[key] ?? 80;
      const k    = 0.04 * s.alpha;
      const f    = (d - rest) * k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!src.pinned) { src.vx += fx; src.vy += fy; }
      if (!tgt.pinned) { tgt.vx -= fx; tgt.vy -= fy; }
    });

    // 中心引力
    s.nodes.forEach(n => {
      if (n.pinned) return;
      n.vx += (0 - n.x) * 0.005 * s.alpha;
      n.vy += (0 - n.y) * 0.005 * s.alpha;
    });

    // 位置更新
    s.nodes.forEach(n => {
      if (n.pinned) return;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x  += n.vx; n.y  += n.vy;
    });

    s.alpha *= 0.992;
  }, []);

  // アニメーションループ（収束後は停止してCPU節約）
  const loopRef = useRef<() => void>(() => {});
  const loop = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    tick();
    draw();
    // 物理が収束 かつ インタラクションなし → 停止
    if (s.alpha > 0.001 || s.hovered !== null || s.drag !== null) {
      s.animId = requestAnimationFrame(loopRef.current);
    } else {
      s.animId = 0;
    }
  }, [tick, draw]);
  loopRef.current = loop;

  // 停止中にインタラクションが発生したらループ再開
  const resumeLoop = useCallback(() => {
    const s = stateRef.current;
    if (s && s.animId === 0) {
      s.animId = requestAnimationFrame(loopRef.current);
    }
  }, []);

  // Canvas サイズ調整
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    if (stateRef.current) {
      stateRef.current.transform.x = canvas.clientWidth  / 2;
      stateRef.current.transform.y = canvas.clientHeight / 2;
    }
  }, []);

  // ワールド座標変換
  const toWorld = (sx: number, sy: number) => {
    const s = stateRef.current!;
    return {
      x: (sx - s.transform.x) / s.transform.scale,
      y: (sy - s.transform.y) / s.transform.scale,
    };
  };

  // ノード検出
  const hitTest = (wx: number, wy: number): GNode | null => {
    const s = stateRef.current!;
    let best: GNode | null = null;
    let bestD = Infinity;
    for (const n of s.nodes) {
      if (s.hiddenTypes.has(n.type)) continue;
      const cfg = NODE_CONFIG[n.type];
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d <= cfg.radius + 4 && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  // fitToView（中央・等倍にリセット）
  const fitToView = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!s || !canvas) return;
    s.transform.x = canvas.clientWidth  / 2;
    s.transform.y = canvas.clientHeight / 2;
    s.transform.scale = 1;
    resumeLoop();
  }, [resumeLoop]);

  // イベントハンドラ
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w  = toWorld(sx, sy);
    const hit = hitTest(w.x, w.y);
    s.clickStart = { x: sx, y: sy };
    if (hit) {
      s.drag = { nodeId: hit.id, startX: sx, startY: sy, nodeOrigX: hit.x, nodeOrigY: hit.y, moved: false };
      hit.pinned = true;
    } else {
      s.pan = { startX: sx, startY: sy, origX: s.transform.x, origY: s.transform.y };
    }
    resumeLoop();
  }, [resumeLoop]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (s.drag) {
      const dx = sx - s.drag.startX;
      const dy = sy - s.drag.startY;
      if (Math.hypot(dx, dy) > 4) s.drag.moved = true;
      const n = s.nodes.find(n => n.id === s.drag!.nodeId);
      if (n) {
        n.x = s.drag.nodeOrigX + dx / s.transform.scale;
        n.y = s.drag.nodeOrigY + dy / s.transform.scale;
        n.vx = 0; n.vy = 0;
        s.alpha = Math.max(s.alpha, 0.3);
      }
    } else if (s.pan) {
      s.transform.x = s.pan.origX + (sx - s.pan.startX);
      s.transform.y = s.pan.origY + (sy - s.pan.startY);
    } else {
      const w = toWorld(sx, sy);
      const hit = hitTest(w.x, w.y);
      const prevHovered = s.hovered;
      s.hovered = hit?.id ?? null;
      if (s.hovered !== prevHovered) resumeLoop();
    }
  }, [resumeLoop]);

  const onMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current!;

    // クリック判定（ドラッグなし かつ mousedown位置からほぼ動いていない）
    if (s.clickStart && s.drag && !s.drag.moved) {
      const dx = e.clientX - canvasRef.current!.getBoundingClientRect().left - s.clickStart.x;
      const dy = e.clientY - canvasRef.current!.getBoundingClientRect().top  - s.clickStart.y;
      if (Math.hypot(dx, dy) < 5) {
        const n = s.nodes.find(n => n.id === s.drag!.nodeId);
        if (n?.type === "task") {
          onOpenTask(n.id);
        }
      }
    }

    if (s.drag) {
      const n = s.nodes.find(n => n.id === s.drag!.nodeId);
      if (n) n.pinned = false;
      s.drag = null;
    }
    s.pan = null;
    s.clickStart = null;
  }, [onOpenTask]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const s = stateRef.current!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(4, Math.max(0.2, s.transform.scale * factor));
    s.transform.x = sx - (sx - s.transform.x) * (newScale / s.transform.scale);
    s.transform.y = sy - (sy - s.transform.y) * (newScale / s.transform.scale);
    s.transform.scale = newScale;
    resumeLoop();
  }, [resumeLoop]);

  const onMouseLeave = useCallback(() => {
    const s = stateRef.current;
    if (s) { s.hovered = null; s.drag = null; s.pan = null; s.clickStart = null; }
  }, []);

  // 初期化
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    stateRef.current = {
      nodes: nodes.map(n => ({ ...n })),
      edges,
      transform: { x: w / 2, y: h / 2, scale: 1 },
      drag: null, pan: null, hovered: null, clickStart: null,
      alpha: 1, animId: 0,
      hiddenTypes: new Set<NodeType>(),
    };
    resize();
    stateRef.current.animId = requestAnimationFrame(loopRef.current);
    window.addEventListener("resize", resize);
    return () => {
      if (stateRef.current) cancelAnimationFrame(stateRef.current.animId);
      window.removeEventListener("resize", resize);
    };
  }, [nodes, edges, resize]);

  // ESCキーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const dark = isDark();
  const textColor  = dark ? "#E5E7EB" : "#374151";
  const panelBg    = dark ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.95)";
  const border     = dark ? "#374151" : "#E5E7EB";
  const mutedColor = dark ? "#6B7280" : "#9CA3AF";

  // 凡例クリック：タイプ表示切替
  const toggleType = (type: NodeType) => {
    const s = stateRef.current;
    if (!s) return;
    if (s.hiddenTypes.has(type)) {
      s.hiddenTypes.delete(type);
    } else {
      s.hiddenTypes.add(type);
    }
    resumeLoop();
    // React stateを使わずCanvasで再描画するため forceUpdate 相当として draw を呼ぶ
    draw();
  };

  const today = todayStr();

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: dark ? "#111827" : "#F9FAFB" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onWheel={onWheel}
      />

      {/* 凡例（クリックで表示切替） */}
      <div style={{
        position: "absolute", bottom: 20, left: 20,
        padding: "10px 14px",
        background: panelBg,
        border: `1px solid ${border}`,
        borderRadius: "8px",
        display: "flex", flexDirection: "column", gap: "4px",
        backdropFilter: "blur(8px)",
        userSelect: "none",
      }}>
        <div style={{ fontSize: "10px", color: mutedColor, marginBottom: "2px", fontWeight: 600 }}>
          凡例（クリックで絞込）
        </div>
        {(Object.entries(NODE_CONFIG) as [NodeType, typeof NODE_CONFIG[NodeType]][]).map(([type, cfg]) => {
          const label = type === "objective" ? "Objective" : type === "kr" ? "Key Result"
            : type === "tf" ? "Task Force" : type === "todo" ? "ToDo"
            : type === "project" ? "Project" : "Task";
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              style={{
                display: "flex", alignItems: "center", gap: "7px",
                background: "transparent", border: "none", cursor: "pointer",
                padding: "2px 0", borderRadius: "4px",
                opacity: stateRef.current?.hiddenTypes.has(type) ? 0.35 : 1,
                transition: "opacity 0.15s",
              }}
            >
              <div style={{
                width: cfg.radius * 1.4, height: cfg.radius * 1.4,
                borderRadius: "50%", background: cfg.baseColor, flexShrink: 0,
              }} />
              <span style={{ fontSize: "11px", color: textColor }}>{label}</span>
            </button>
          );
        })}

        {/* タスクステータス凡例 */}
        <div style={{ borderTop: `1px solid ${border}`, marginTop: "4px", paddingTop: "6px", display: "flex", flexDirection: "column", gap: "3px" }}>
          <div style={{ fontSize: "10px", color: mutedColor, marginBottom: "1px", fontWeight: 600 }}>タスク状態</div>
          {[
            { color: "#6B7280", label: "未着手" },
            { color: "#3B82F6", label: "進行中" },
            { color: "#EF4444", label: "期限超過" },
            { color: "#9CA3AF", label: "完了（薄表示）" },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontSize: "10px", color: mutedColor }}>{label}</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: "10px", color: mutedColor, marginTop: "4px", borderTop: `1px solid ${border}`, paddingTop: "5px" }}>
          スクロール: ズーム　ドラッグ: 移動<br />
          タスク粒クリック: 編集
        </div>
      </div>

      {/* 右上コントロール */}
      <div style={{ position: "absolute", top: 16, right: 16, display: "flex", gap: "8px" }}>
        {/* 今日の日付インジケーター */}
        <div style={{
          padding: "5px 12px", fontSize: "11px",
          background: panelBg, border: `1px solid ${border}`,
          borderRadius: "6px", color: mutedColor,
          backdropFilter: "blur(8px)", display: "flex", alignItems: "center",
        }}>
          {today}
        </div>

        {/* fitToView */}
        <button
          onClick={fitToView}
          title="表示をリセット"
          style={{
            padding: "5px 12px", fontSize: "12px",
            background: panelBg, border: `1px solid ${border}`,
            borderRadius: "6px", cursor: "pointer", color: textColor,
            backdropFilter: "blur(8px)",
          }}
        >
          ⊙ リセット
        </button>

        {/* 閉じる */}
        <button
          onClick={onClose}
          style={{
            padding: "5px 16px", fontSize: "12px",
            background: panelBg, border: `1px solid ${border}`,
            borderRadius: "6px", cursor: "pointer", color: textColor,
            backdropFilter: "blur(8px)",
          }}
        >
          ✕ 閉じる
        </button>
      </div>

      {/* タイトル */}
      <div style={{
        position: "absolute", top: 16, left: "50%",
        transform: "translateX(-50%)",
        padding: "5px 16px",
        background: panelBg, border: `1px solid ${border}`,
        borderRadius: "6px", fontSize: "12px", fontWeight: "600",
        color: textColor, backdropFilter: "blur(8px)",
        pointerEvents: "none",
      }}>
        関係グラフ
      </div>

      {/* ノード数サマリー */}
      <div style={{
        position: "absolute", bottom: 20, right: 20,
        padding: "8px 12px",
        background: panelBg, border: `1px solid ${border}`,
        borderRadius: "8px", backdropFilter: "blur(8px)",
        fontSize: "10px", color: mutedColor, lineHeight: "1.6",
      }}>
        {[
          { type: "objective" as NodeType, label: "O" },
          { type: "kr"        as NodeType, label: "KR" },
          { type: "tf"        as NodeType, label: "TF" },
          { type: "todo"      as NodeType, label: "ToDo" },
          { type: "project"   as NodeType, label: "PJ" },
          { type: "task"      as NodeType, label: "Task" },
        ].map(({ type, label }) => {
          const count = nodes.filter(n => n.type === type).length;
          if (count === 0) return null;
          const overdue = type === "task"
            ? nodes.filter(n => n.type === "task" && n.taskDueDate && n.taskDueDate < today && n.taskStatus !== "done").length
            : 0;
          return (
            <div key={type}>
              {label}: {count}{overdue > 0 ? ` (⚠ ${overdue}超過)` : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}
