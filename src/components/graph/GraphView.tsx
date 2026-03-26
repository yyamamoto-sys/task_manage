// src/components/graph/GraphView.tsx
//
// 【設計意図】
// OKR・KR・TF・ToDo・Task・Projectの関係性をObsidian風のグラフで可視化する。
// D3.jsを使わず、Canvas + カスタム物理シミュレーションで実装。
// ラボ機能（プロトタイプ）として位置づけ。

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useAppData } from "../../context/AppDataContext";

interface Props {
  onClose: () => void;
}

// ノードタイプ定義
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
}

interface GEdge {
  source: string;
  target: string;
}

const NODE_CONFIG: Record<NodeType, { color: string; radius: number; shortLabel: string }> = {
  objective: { color: "#F59E0B", radius: 20, shortLabel: "O"    },
  kr:        { color: "#3B82F6", radius: 14, shortLabel: "KR"   },
  tf:        { color: "#8B5CF6", radius: 11, shortLabel: "TF"   },
  todo:      { color: "#10B981", radius: 9,  shortLabel: "ToDo" },
  project:   { color: "#EF4444", radius: 11, shortLabel: "PJ"   },
  task:      { color: "#6B7280", radius: 6,  shortLabel: ""     },
};

const EDGE_COLOR: Record<string, string> = {
  "objective-kr":  "#3B82F6",
  "kr-tf":         "#8B5CF6",
  "tf-todo":       "#10B981",
  "todo-task":     "#9CA3AF",
  "project-task":  "#EF4444",
  "tf-project":    "#F97316",
};

export function GraphView({ onClose }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const stateRef   = useRef<{
    nodes: GNode[];
    edges: GEdge[];
    transform: { x: number; y: number; scale: number };
    drag: { nodeId: string | null; startX: number; startY: number; nodeOrigX: number; nodeOrigY: number } | null;
    pan: { startX: number; startY: number; origX: number; origY: number } | null;
    hovered: string | null;
    alpha: number;
    animId: number;
  }>();

  const {
    objective, keyResults: rawKrs, taskForces: rawTfs,
    todos: rawTodos, tasks: rawTasks, projects: rawProjects,
    projectTaskForces,
  } = useAppData();

  // グラフデータ構築
  const { nodes, edges } = useMemo(() => {
    const krs      = rawKrs.filter(k => !k.is_deleted);
    const tfs      = rawTfs.filter(t => !t.is_deleted);
    const todos    = rawTodos.filter(t => !t.is_deleted);
    const tasks    = rawTasks.filter(t => !t.is_deleted);
    const projects = rawProjects.filter(p => !p.is_deleted);

    const nodes: GNode[] = [];
    const edges: GEdge[] = [];
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const rand = (r: number) => (Math.random() - 0.5) * r;

    // Objective
    if (objective) {
      nodes.push({ id: objective.id, label: objective.title, type: "objective",
        x: cx + rand(30), y: cy + rand(30), vx: 0, vy: 0, pinned: false });
    }

    // KR
    krs.forEach(kr => {
      nodes.push({ id: kr.id, label: kr.title, type: "kr",
        x: cx + rand(120), y: cy + rand(120), vx: 0, vy: 0, pinned: false });
      if (objective) edges.push({ source: objective.id, target: kr.id });
    });

    // TF
    tfs.forEach(tf => {
      nodes.push({ id: tf.id, label: `${tf.tf_number} ${tf.name}`, type: "tf",
        x: cx + rand(180), y: cy + rand(180), vx: 0, vy: 0, pinned: false });
      edges.push({ source: tf.kr_id, target: tf.id });
    });

    // ToDo
    todos.forEach(todo => {
      nodes.push({ id: todo.id, label: todo.title.slice(0, 40), type: "todo",
        x: cx + rand(240), y: cy + rand(240), vx: 0, vy: 0, pinned: false });
      edges.push({ source: todo.tf_id, target: todo.id });
    });

    // Project
    projects.forEach(pj => {
      nodes.push({ id: pj.id, label: pj.name, type: "project",
        x: cx + rand(200), y: cy + rand(200), vx: 0, vy: 0, pinned: false });
    });

    // TF ↔ Project
    projectTaskForces.forEach(ptf => {
      const hasTF = tfs.find(t => t.id === ptf.tf_id);
      const hasPJ = projects.find(p => p.id === ptf.project_id);
      if (hasTF && hasPJ) edges.push({ source: ptf.tf_id, target: ptf.project_id });
    });

    // Task
    tasks.forEach(task => {
      nodes.push({ id: task.id, label: task.name, type: "task",
        x: cx + rand(300), y: cy + rand(300), vx: 0, vy: 0, pinned: false });
      if (task.todo_id)    edges.push({ source: task.todo_id,    target: task.id });
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
    const bg   = dark ? "#111827" : "#F9FAFB";
    const edgeBase = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
    const labelColor = dark ? "#E5E7EB" : "#111827";
    const tooltipBg = dark ? "#1F2937" : "#FFFFFF";
    const tooltipBorder = dark ? "#374151" : "#E5E7EB";

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(s.transform.x, s.transform.y);
    ctx.scale(s.transform.scale, s.transform.scale);

    const nodeMap = new Map(s.nodes.map(n => [n.id, n]));

    // エッジ描画
    s.edges.forEach(e => {
      const src = nodeMap.get(e.source);
      const tgt = nodeMap.get(e.target);
      if (!src || !tgt) return;
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

    // ノード描画
    s.nodes.forEach(n => {
      const cfg = NODE_CONFIG[n.type];
      const isHovered = s.hovered === n.id;

      // 外縁グロー（ホバー時）
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, cfg.radius + 5, 0, Math.PI * 2);
        ctx.fillStyle = cfg.color + "33";
        ctx.fill();
      }

      // 本体
      ctx.beginPath();
      ctx.arc(n.x, n.y, cfg.radius, 0, Math.PI * 2);
      ctx.fillStyle = cfg.color;
      ctx.globalAlpha = isHovered ? 1 : 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = dark ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1.5 / s.transform.scale;
      ctx.stroke();

      // ラベル（Taskは小さくて省略、ホバー時はtooltipで表示）
      if (n.type !== "task" || isHovered) {
        const fontSize = Math.max(9, cfg.radius * 0.9);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = "#FFFFFF";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        if (cfg.shortLabel && n.type !== "task") {
          ctx.fillText(cfg.shortLabel, n.x, n.y);
        }
      }

      // ノード名ラベル（大きいノードのみ常時表示）
      if (n.type === "objective" || n.type === "project" || isHovered) {
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

    // ホバーツールチップ（全テキスト表示）
    if (s.hovered) {
      const n = nodeMap.get(s.hovered);
      if (n && (n.type === "task" || n.type === "todo" || n.type === "kr" || n.type === "tf")) {
        // ワールド座標でテキストボックスを描画
      }
    }

    ctx.restore();

    // ツールチップはスクリーン座標で
    if (s.hovered) {
      const n = nodeMap.get(s.hovered);
      if (n) {
        const sx = n.x * s.transform.scale + s.transform.x;
        const sy = n.y * s.transform.scale + s.transform.y;
        const cfg = NODE_CONFIG[n.type];
        const padding = 6;
        const maxChars = 40;
        const text = n.label.length > maxChars ? n.label.slice(0, maxChars) + "…" : n.label;
        ctx.font = "11px sans-serif";
        const tw = ctx.measureText(text).width;
        const bx = Math.min(sx + cfg.radius * s.transform.scale + 6, canvas.width - tw - padding * 2 - 4);
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
  }, []);

  // 物理シミュレーション 1ステップ
  const tick = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.alpha < 0.001) return;

    const nodeMap = new Map(s.nodes.map(n => [n.id, n]));
    const cx = canvasRef.current ? canvasRef.current.width / 2 : 500;
    const cy = canvasRef.current ? canvasRef.current.height / 2 : 400;

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
      n.vx += (cx - n.x) * 0.005 * s.alpha;
      n.vy += (cy - n.y) * 0.005 * s.alpha;
    });

    // 位置更新
    s.nodes.forEach(n => {
      if (n.pinned) return;
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x  += n.vx;
      n.y  += n.vy;
    });

    s.alpha *= 0.992;
  }, []);

  // アニメーションループ
  const loop = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    tick();
    draw();
    s.animId = requestAnimationFrame(loop);
  }, [tick, draw]);

  // Canvas サイズ調整
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    // transformを1:1に補正（DPR分）
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
      const cfg = NODE_CONFIG[n.type];
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d <= cfg.radius + 4 && d < bestD) { best = n; bestD = d; }
    }
    return best;
  };

  // イベントハンドラ
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w  = toWorld(sx, sy);
    const hit = hitTest(w.x, w.y);
    if (hit) {
      s.drag = { nodeId: hit.id, startX: sx, startY: sy, nodeOrigX: hit.x, nodeOrigY: hit.y };
      hit.pinned = true;
    } else {
      s.pan = { startX: sx, startY: sy, origX: s.transform.x, origY: s.transform.y };
    }
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = stateRef.current!;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (s.drag) {
      const n = s.nodes.find(n => n.id === s.drag!.nodeId);
      if (n) {
        const dx = (sx - s.drag.startX) / s.transform.scale;
        const dy = (sy - s.drag.startY) / s.transform.scale;
        n.x = s.drag.nodeOrigX + dx;
        n.y = s.drag.nodeOrigY + dy;
        n.vx = 0; n.vy = 0;
        s.alpha = Math.max(s.alpha, 0.3);
      }
    } else if (s.pan) {
      s.transform.x = s.pan.origX + (sx - s.pan.startX);
      s.transform.y = s.pan.origY + (sy - s.pan.startY);
    } else {
      const w = toWorld(sx, sy);
      const hit = hitTest(w.x, w.y);
      s.hovered = hit?.id ?? null;
    }
  }, []);

  const onMouseUp = useCallback(() => {
    const s = stateRef.current!;
    if (s.drag) {
      const n = s.nodes.find(n => n.id === s.drag!.nodeId);
      if (n) n.pinned = false;
      s.drag = null;
    }
    s.pan = null;
  }, []);

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
  }, []);

  const onMouseLeave = useCallback(() => {
    const s = stateRef.current;
    if (s) { s.hovered = null; s.drag = null; s.pan = null; }
  }, []);

  // 初期化
  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    stateRef.current = {
      nodes: nodes.map(n => ({ ...n })),
      edges,
      transform: { x: w / 2, y: h / 2, scale: 1 },
      drag: null, pan: null, hovered: null,
      alpha: 1, animId: 0,
    };
    resize();
    stateRef.current.animId = requestAnimationFrame(loop);
    window.addEventListener("resize", resize);
    return () => {
      if (stateRef.current) cancelAnimationFrame(stateRef.current.animId);
      window.removeEventListener("resize", resize);
    };
  }, [nodes, edges, loop, resize]);

  // ESCキーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const dark = isDark();
  const textColor = dark ? "#E5E7EB" : "#374151";
  const panelBg   = dark ? "rgba(17,24,39,0.95)" : "rgba(255,255,255,0.95)";
  const border    = dark ? "#374151" : "#E5E7EB";

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

      {/* 凡例 */}
      <div style={{
        position: "absolute", bottom: 20, left: 20,
        padding: "10px 14px",
        background: panelBg,
        border: `1px solid ${border}`,
        borderRadius: "8px",
        display: "flex", flexDirection: "column", gap: "5px",
        backdropFilter: "blur(8px)",
      }}>
        {(Object.entries(NODE_CONFIG) as [NodeType, typeof NODE_CONFIG[NodeType]][]).map(([type, cfg]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <div style={{
              width: cfg.radius * 1.4, height: cfg.radius * 1.4,
              borderRadius: "50%", background: cfg.color, flexShrink: 0,
            }} />
            <span style={{ fontSize: "11px", color: textColor, textTransform: "capitalize" }}>
              {type === "objective" ? "Objective" : type === "kr" ? "Key Result"
                : type === "tf" ? "Task Force" : type === "todo" ? "ToDo"
                : type === "project" ? "Project" : "Task"}
            </span>
          </div>
        ))}
        <div style={{ fontSize: "10px", color: dark ? "#6B7280" : "#9CA3AF", marginTop: "4px", borderTop: `1px solid ${border}`, paddingTop: "5px" }}>
          スクロール: ズーム　ドラッグ: 移動
        </div>
      </div>

      {/* 閉じるボタン */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 16,
          padding: "6px 16px", fontSize: "12px",
          background: panelBg,
          border: `1px solid ${border}`,
          borderRadius: "6px", cursor: "pointer",
          color: textColor,
          backdropFilter: "blur(8px)",
        }}
      >
        ✕ 閉じる
      </button>

      {/* タイトル */}
      <div style={{
        position: "absolute", top: 16, left: "50%",
        transform: "translateX(-50%)",
        padding: "5px 16px",
        background: panelBg,
        border: `1px solid ${border}`,
        borderRadius: "6px",
        fontSize: "12px", fontWeight: "600",
        color: textColor,
        backdropFilter: "blur(8px)",
        pointerEvents: "none",
      }}>
        関係グラフ
      </div>
    </div>
  );
}
