// src/components/list/ListView.tsx
import { useState, useMemo, useCallback, useRef } from "react";
import { useAppData } from "../../context/AppDataContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import type { Member, Project, Task, ToDo } from "../../lib/localData/types";
import { Avatar } from "../auth/UserSelectScreen";
import { TaskEditModal } from "../task/TaskEditModal";

interface Props {
  currentUser: Member;
  selectedProject: Project | null;
  projects: Project[];
}

type GroupBy = "project" | "assignee" | "status";

// ソート優先度（レンダリングごとに再生成しないよう定数化）
const PRIO: Record<string, number> = { high: 0, mid: 1, low: 2, "": 3 };
type SortKey = "name" | "due_date" | "priority" | "estimated_hours";
type SortDir = "asc" | "desc";

const STATUS_LABELS: Record<Task["status"], string> = {
  todo: "ToDo", in_progress: "進行中", done: "完了",
};
const STATUS_COLORS: Record<Task["status"], { bg: string; color: string }> = {
  todo:        { bg: "var(--color-bg-tertiary)",  color: "var(--color-text-secondary)" },
  in_progress: { bg: "var(--color-bg-info)",      color: "var(--color-text-info)" },
  done:        { bg: "var(--color-bg-success)",   color: "var(--color-text-success)" },
};
const PRIORITY_LABELS: Record<string, string> = { high: "高", mid: "中", low: "低" };
const PRIORITY_COLORS: Record<string, { bg: string; color: string }> = {
  high: { bg: "var(--color-bg-danger)",  color: "var(--color-text-danger)"  },
  mid:  { bg: "var(--color-bg-warning)", color: "var(--color-text-warning)" },
  low:  { bg: "var(--color-bg-success)", color: "var(--color-text-success)" },
};

function todayStr(): string { return new Date().toISOString().split("T")[0]; }
function addDays(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function exportCSV(tasks: Task[], projects: Project[], members: Member[]) {
  const header = ["タスク名","ステータス","担当者","プロジェクト","優先度","期日","工数(h)","コメント"];
  const rows = tasks.map(t => {
    const pj = projects.find(p => p.id === t.project_id);
    const m  = members.find(mb => mb.id === t.assignee_member_id);
    return [
      t.name, STATUS_LABELS[t.status], m?.display_name ?? "",
      pj?.name ?? "", t.priority ? PRIORITY_LABELS[t.priority] : "",
      t.due_date ?? "", t.estimated_hours?.toString() ?? "",
      t.comment.replace(/,/g,"，").replace(/\n/g," "),
    ];
  });
  const csv = [header,...rows].map(r=>r.map(v=>`"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`tasks_${todayStr()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function renderComment(text: string): React.ReactNode {
  const pat = /https?:\/\/[^\s]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0, match;
  while ((match = pat.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0];
    parts.push(<a key={match.index} href={url} target="_blank" rel="noreferrer"
      style={{color:"var(--color-text-info)",textDecoration:"underline",wordBreak:"break-all"}}>{url}</a>);
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// ===== ビュー設定の永続化ヘルパー =====
const LIST_LS_KEY = "list_view_settings";
function lsGet<T>(field: string, fallback: T): T {
  try { return ((JSON.parse(localStorage.getItem(LIST_LS_KEY) ?? "{}") as Record<string, T>)[field] ?? fallback); }
  catch { return fallback; }
}
function lsSet(field: string, value: unknown) {
  try {
    const all = JSON.parse(localStorage.getItem(LIST_LS_KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(LIST_LS_KEY, JSON.stringify({ ...all, [field]: value }));
  } catch { /* ignore */ }
}

export function ListView({ currentUser, selectedProject, projects }: Props) {
  const { tasks: rawTasks, members: rawMembers, todos: rawTodos } = useAppData();
  const todos = useMemo(() => (rawTodos ?? []).filter((td: ToDo) => !td.is_deleted), [rawTodos]);
  const isMobile = useIsMobile();
  const allTasks = useMemo(() => rawTasks.filter(t => !t.is_deleted), [rawTasks]);
  const members  = useMemo(() => rawMembers.filter(m => !m.is_deleted), [rawMembers]);

  // 永続化対象の設定（groupBy / filterStatus / filterPriority / sort）
  const [groupBy, setGroupByState]           = useState<GroupBy>(() => lsGet("groupBy", "project"));
  const [filterStatus, setFilterStatusState] = useState<Task["status"]|"all">(() => lsGet("filterStatus", "all"));
  const [filterPriority, setFilterPriorityState] = useState<"all"|"high"|"mid"|"low">(() => lsGet("filterPriority", "all"));
  const [sortKey, setSortKeyState]           = useState<SortKey>(() => lsGet("sortKey", "due_date"));
  const [sortDir, setSortDirState]           = useState<SortDir>(() => lsGet("sortDir", "asc"));

  const setGroupBy = (v: GroupBy) => { setGroupByState(v); lsSet("groupBy", v); };
  const setFilterStatus = (v: Task["status"]|"all") => { setFilterStatusState(v); lsSet("filterStatus", v); };
  const setFilterPriority = (v: "all"|"high"|"mid"|"low") => { setFilterPriorityState(v); lsSet("filterPriority", v); };

  // 永続化しない一時フィルター
  const [filterMyOnly, setFilterMyOnly] = useState(false);
  const [filterThisWeek, setFilterThisWeek] = useState(false);
  const [searchText, setSearchText]     = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string|null>(null);
  const [editingTaskId,  setEditingTaskId]  = useState<string|null>(null);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      const newDir: SortDir = sortDir === "asc" ? "desc" : "asc";
      setSortDirState(newDir); lsSet("sortDir", newDir);
    } else {
      setSortKeyState(key); lsSet("sortKey", key);
      setSortDirState("asc"); lsSet("sortDir", "asc");
    }
  }, [sortKey, sortDir]);

  // 「今日」と「7日後」は初回マウント時に固定（日をまたぐ場合はページリロードで更新）
  const t0 = useRef(todayStr()).current;
  const t7 = useRef(addDays(7)).current;

  const filteredTasks = useMemo(() => {
    let tasks = allTasks;
    if (selectedProject) tasks = tasks.filter(t=>t.project_id===selectedProject.id);
    if (filterStatus!=="all") tasks = tasks.filter(t=>t.status===filterStatus);
    if (filterMyOnly) tasks = tasks.filter(t=>t.assignee_member_id===currentUser.id);
    if (filterThisWeek) tasks = tasks.filter(t=>t.due_date&&t.due_date>=t0&&t.due_date<=t7);
    if (filterPriority!=="all") tasks = tasks.filter(t=>t.priority===filterPriority);
    if (searchText.trim()) {
      const q=searchText.toLowerCase();
      tasks = tasks.filter(t=>t.name.toLowerCase().includes(q)||t.comment.toLowerCase().includes(q));
    }
    return [...tasks].sort((a,b)=>{
      let va:string|number="", vb:string|number="";
      if (sortKey==="name"){va=a.name;vb=b.name;}
      else if (sortKey==="due_date"){va=a.due_date??"9999";vb=b.due_date??"9999";}
      else if (sortKey==="priority"){va=PRIO[a.priority??""];vb=PRIO[b.priority??""];}
      else if (sortKey==="estimated_hours"){va=a.estimated_hours??999;vb=b.estimated_hours??999;}
      if(va<vb) return sortDir==="asc"?-1:1;
      if(va>vb) return sortDir==="asc"?1:-1;
      return 0;
    });
  }, [allTasks,selectedProject,filterStatus,filterMyOnly,filterThisWeek,filterPriority,searchText,sortKey,sortDir,currentUser.id,t0,t7]);

  const groups = useMemo(() => {
    if (groupBy==="project") {
      // プロジェクト紐づきタスク
      const map = new Map<string,Task[]>();
      projects.forEach(p=>map.set(p.id,[]));
      filteredTasks.forEach(t=>{const a=t.project_id ? map.get(t.project_id) : undefined;if(a)a.push(t);});
      const pjGroups = projects.filter(p=>(map.get(p.id)?.length??0)>0)
        .map(p=>({label:p.name,color:p.color_tag,tasks:map.get(p.id)??[]}));

      // project_id=null のタスクをToDo単位でグループ化
      const noPjTasks = filteredTasks.filter(t=>t.project_id==null);
      const todoMap = new Map<string,Task[]>();
      const noTodoTasks: Task[] = [];
      noPjTasks.forEach(t=>{
        const primaryTodoId = (t.todo_ids ?? [])[0];
        if (primaryTodoId) {
          if (!todoMap.has(primaryTodoId)) todoMap.set(primaryTodoId,[]);
          todoMap.get(primaryTodoId)!.push(t);
        } else {
          noTodoTasks.push(t);
        }
      });
      const todoGroups = [...todoMap.entries()].map(([todoId, tasks]) => {
        const td = todos.find(t=>t.id===todoId);
        return { label: td ? `[ToDo] ${td.title.split("\n")[0].slice(0,30)}` : "[ToDo]", color: "#6ee7b7", tasks };
      });
      const unassigned = noTodoTasks.length > 0
        ? [{ label: "プロジェクト未設定", color: "var(--color-text-tertiary)", tasks: noTodoTasks }]
        : [];

      return [...pjGroups, ...todoGroups, ...unassigned];
    }
    if (groupBy==="assignee") {
      const map = new Map<string,Task[]>();
      members.forEach(m=>map.set(m.id,[]));
      filteredTasks.forEach(t=>{const a=map.get(t.assignee_member_id);if(a)a.push(t);});
      return members.filter(m=>(map.get(m.id)?.length??0)>0)
        .map(m=>({label:m.display_name,color:m.color_bg,tasks:map.get(m.id)!}));
    }
    return (["in_progress","todo","done"] as const)
      .map(s=>({label:STATUS_LABELS[s],color:STATUS_COLORS[s].color,tasks:filteredTasks.filter(t=>t.status===s)}))
      .filter(g=>g.tasks.length>0);
  }, [filteredTasks,groupBy,projects,members,todos]);

  const selectedTask = selectedTaskId ? allTasks.find(t=>t.id===selectedTaskId)??null : null;

  const SortIcon = ({k}:{k:SortKey}) => sortKey===k
    ? <span style={{marginLeft:3,opacity:.7}}>{sortDir==="asc"?"↑":"↓"}</span>
    : <span style={{marginLeft:3,opacity:.2}}>↕</span>;

  const cols = [
    {key:"name",label:"タスク名",w:"auto"},
    {key:"status",label:"ステータス",w:"80px"},
    {key:"priority",label:"優先度",w:"60px"},
    {key:"due_date",label:"期日",w:"72px"},
    {key:"estimated_hours",label:"工数",w:"52px"},
    {key:"assignee",label:"担当者",w:"90px"},
  ];

  return (
    <div style={{display:"flex",height:"100%",overflow:"hidden"}}>
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* ヘッダーバー */}
        <div style={{
          padding:"7px 12px",borderBottom:"1px solid var(--color-border-primary)",
          background:"var(--color-bg-primary)",flexShrink:0,
          display:"flex",alignItems:"center",gap:"7px",flexWrap:"wrap",
        }}>
          {/* グループ */}
          <div style={{display:"flex",background:"var(--color-bg-tertiary)",borderRadius:"var(--radius-md)",padding:"2px"}}>
            {(["project","assignee","status"] as const).map(g=>(
              <button key={g} onClick={()=>setGroupBy(g)} style={{
                padding:"3px 9px",fontSize:"10px",borderRadius:"var(--radius-sm)",border:"none",cursor:"pointer",
                fontWeight:groupBy===g?"500":"400",
                background:groupBy===g?"var(--color-bg-primary)":"transparent",
                color:groupBy===g?"var(--color-text-primary)":"var(--color-text-tertiary)",
                boxShadow:groupBy===g?"var(--shadow-sm)":"none",
              }}>
                {g==="project"?"PJ別":g==="assignee"?"担当者別":"ステータス別"}
              </button>
            ))}
          </div>

          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value as Task["status"]|"all")}
            style={selStyle}>
            <option value="all">すべて</option>
            <option value="todo">ToDo</option>
            <option value="in_progress">進行中</option>
            <option value="done">完了</option>
          </select>

          <select value={filterPriority} onChange={e=>setFilterPriority(e.target.value as "all"|"high"|"mid"|"low")}
            style={selStyle}>
            <option value="all">優先度：すべて</option>
            <option value="high">高</option>
            <option value="mid">中</option>
            <option value="low">低</option>
          </select>

          <Chip active={filterMyOnly} onClick={()=>setFilterMyOnly(v=>!v)} label="自分担当"/>
          <Chip active={filterThisWeek} onClick={()=>setFilterThisWeek(v=>!v)} label="今週期限"/>

          <input value={searchText} onChange={e=>setSearchText(e.target.value)}
            placeholder="🔍 検索" style={{
              flex:1,minWidth:"100px",padding:"4px 8px",fontSize:"11px",
              border:"1px solid var(--color-border-primary)",borderRadius:"var(--radius-md)",
              background:"var(--color-bg-primary)",color:"var(--color-text-primary)",outline:"none",
            }}/>

          <span style={{fontSize:"11px",color:"var(--color-text-tertiary)",whiteSpace:"nowrap"}}>
            {filteredTasks.length}件
          </span>

          <button onClick={()=>exportCSV(filteredTasks,projects,members)} style={{
            padding:"4px 10px",fontSize:"10px",color:"var(--color-text-secondary)",
            border:"1px solid var(--color-border-primary)",borderRadius:"var(--radius-md)",
            cursor:"pointer",background:"transparent",whiteSpace:"nowrap",
          }}>↓ CSV</button>
        </div>

        {/* テーブル（PC）/ カード（モバイル） */}
        <div style={{flex:1,overflow:"auto"}}>
          {isMobile ? (
            /* モバイル：カードリスト */
            <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:"6px"}}>
              {groups.map(group=>(
                <div key={group.label}>
                  <div style={{display:"flex",alignItems:"center",gap:"6px",padding:"6px 4px 4px"}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:group.color,display:"inline-block"}}/>
                    <span style={{fontSize:"11px",fontWeight:"500",color:"var(--color-text-secondary)"}}>{group.label}</span>
                    <span style={{fontSize:"10px",color:"var(--color-text-tertiary)"}}>{group.tasks.length}件</span>
                  </div>
                  {group.tasks.map(task=>{
                    const m   = members.find(mb=>mb.id===task.assignee_member_id);
                    const pj  = projects.find(p=>p.id===task.project_id);
                    const td  = (task.todo_ids ?? [])[0] ? todos.find(t=>t.id===task.todo_ids[0]) : undefined;
                    const isDone    = task.status==="done";
                    const isOverdue = task.due_date&&task.due_date<t0&&!isDone;
                    return (
                      <div key={task.id} onClick={()=>setEditingTaskId(task.id)} style={{
                        background:"var(--color-bg-primary)",
                        border:"1px solid var(--color-border-primary)",
                        borderRadius:"var(--radius-lg)",
                        padding:"10px 12px",marginBottom:"4px",
                        cursor:"pointer",opacity:isDone?0.6:1,
                      }}>
                        <div style={{display:"flex",alignItems:"flex-start",gap:"8px",marginBottom:"6px"}}>
                          <div style={{flex:1,fontSize:"12px",fontWeight:"500",
                            color:"var(--color-text-primary)",lineHeight:1.4,
                            textDecoration:isDone?"line-through":"none"}}>
                            {task.name}
                          </div>
                          <span style={{fontSize:"9px",padding:"2px 6px",borderRadius:"3px",flexShrink:0,
                            background:STATUS_COLORS[task.status].bg,color:STATUS_COLORS[task.status].color}}>
                            {STATUS_LABELS[task.status]}
                          </span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                          {m&&<div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                            <Avatar member={m} size={14}/>
                            <span style={{fontSize:"10px",color:"var(--color-text-secondary)"}}>{m.short_name}</span>
                          </div>}
                          {task.due_date&&<span style={{fontSize:"10px",
                            color:isOverdue?"var(--color-text-danger)":"var(--color-text-tertiary)",
                            fontWeight:isOverdue?"500":"400"}}>
                            {task.due_date.slice(5).replace("-","/")}
                          </span>}
                          {task.priority&&<span style={{fontSize:"9px",padding:"1px 5px",borderRadius:"3px",
                            background:PRIORITY_COLORS[task.priority].bg,color:PRIORITY_COLORS[task.priority].color}}>
                            {PRIORITY_LABELS[task.priority]}
                          </span>}
                          {groupBy!=="project"&&pj&&<div style={{display:"flex",alignItems:"center",gap:"3px"}}>
                            <span style={{width:4,height:4,borderRadius:"50%",background:pj.color_tag,display:"inline-block"}}/>
                            <span style={{fontSize:"9px",color:"var(--color-text-tertiary)"}}>{pj.name.slice(0,12)}</span>
                          </div>}
                          {!pj&&td&&<div style={{display:"flex",alignItems:"center",gap:"3px"}}>
                            <span style={{fontSize:"9px",color:"#059669",fontWeight:"500"}}>ToDo</span>
                            <span style={{fontSize:"9px",color:"var(--color-text-tertiary)"}}>{td.title.split("\n")[0].slice(0,16)}</span>
                          </div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {filteredTasks.length===0&&(
                <div style={{padding:"36px",textAlign:"center",color:"var(--color-text-tertiary)",fontSize:"12px"}}>
                  条件に一致するタスクがありません
                </div>
              )}
            </div>
          ) : (
            /* PC：テーブル */
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"11px"}}>
              <thead style={{position:"sticky",top:0,zIndex:5}}>
                <tr style={{background:"var(--color-bg-secondary)"}}>
                  {cols.map(col=>(
                    <th key={col.key} style={{
                      padding:"6px 10px",textAlign:"left",
                      borderBottom:"1px solid var(--color-border-primary)",
                      fontWeight:"500",color:"var(--color-text-secondary)",
                      width:col.w,cursor:["status","assignee"].includes(col.key)?"default":"pointer",
                      userSelect:"none",whiteSpace:"nowrap",
                    }} onClick={()=>{if(!["status","assignee"].includes(col.key))handleSort(col.key as SortKey);}}>
                      {col.label}
                      {!["status","assignee"].includes(col.key)&&<SortIcon k={col.key as SortKey}/>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(group=>(
                  <React.Fragment key={group.label}>
                    <tr>
                      <td colSpan={6} style={{
                        padding:"7px 10px 4px",
                        background:"var(--color-bg-secondary)",
                        borderBottom:"1px solid var(--color-border-primary)",
                      }}>
                        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                          <span style={{width:7,height:7,borderRadius:"50%",background:group.color,display:"inline-block"}}/>
                          <span style={{fontSize:"11px",fontWeight:"500",color:"var(--color-text-secondary)"}}>{group.label}</span>
                          <span style={{fontSize:"10px",color:"var(--color-text-tertiary)"}}>{group.tasks.length}件</span>
                        </div>
                      </td>
                    </tr>
                    {group.tasks.map(task=>{
                      const m   = members.find(mb=>mb.id===task.assignee_member_id);
                      const pj  = projects.find(p=>p.id===task.project_id);
                      const td  = (task.todo_ids ?? [])[0] ? todos.find(t=>t.id===task.todo_ids[0]) : undefined;
                      const isDone    = task.status==="done";
                      const isOverdue = task.due_date&&task.due_date<t0&&!isDone;
                      const isSel     = selectedTaskId===task.id;
                      return (
                        <tr key={task.id} onClick={()=>setSelectedTaskId(isSel?null:task.id)} style={{
                          borderBottom:"1px solid var(--color-bg-tertiary)",
                          background:isSel?"var(--color-brand-light)":isDone?"var(--color-bg-secondary)":"var(--color-bg-primary)",
                          cursor:"pointer",opacity:isDone ? 0.6 : 1,transition:"background 0.1s",
                        }}>
                          <td style={{padding:"6px 10px",maxWidth:0}}>
                            <div style={{
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                              color:isSel?"var(--color-text-purple)":"var(--color-text-primary)",
                              textDecoration:isDone?"line-through":"none",
                            }}>{task.name}</div>
                            {groupBy!=="project"&&pj&&(
                              <div style={{display:"flex",alignItems:"center",gap:"3px",marginTop:"1px"}}>
                                <span style={{width:4,height:4,borderRadius:"50%",background:pj.color_tag,display:"inline-block"}}/>
                                <span style={{fontSize:"9px",color:"var(--color-text-tertiary)"}}>{pj.name.slice(0,14)}</span>
                              </div>
                            )}
                            {!pj&&td&&(
                              <div style={{display:"flex",alignItems:"center",gap:"3px",marginTop:"1px"}}>
                                <span style={{fontSize:"9px",color:"#059669",fontWeight:"500"}}>ToDo</span>
                                <span style={{fontSize:"9px",color:"var(--color-text-tertiary)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"120px"}}>
                                  {td.title.split("\n")[0].slice(0,20)}
                                </span>
                              </div>
                            )}
                          </td>
                          <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}>
                            <span style={{fontSize:"9px",padding:"2px 6px",borderRadius:"3px",
                              background:STATUS_COLORS[task.status].bg,color:STATUS_COLORS[task.status].color}}>
                              {STATUS_LABELS[task.status]}
                            </span>
                          </td>
                          <td style={{padding:"6px 10px"}}>
                            {task.priority&&(
                              <span style={{fontSize:"9px",padding:"2px 5px",borderRadius:"3px",
                                background:PRIORITY_COLORS[task.priority].bg,color:PRIORITY_COLORS[task.priority].color}}>
                                {PRIORITY_LABELS[task.priority]}
                              </span>
                            )}
                          </td>
                          <td style={{padding:"6px 10px",whiteSpace:"nowrap",
                            color:isOverdue?"var(--color-text-danger)":"var(--color-text-secondary)",
                            fontWeight:isOverdue?"500":"400"}}>
                            {task.due_date?task.due_date.slice(5).replace("-","/"):"—"}
                          </td>
                          <td style={{padding:"6px 10px",color:"var(--color-text-tertiary)",textAlign:"right"}}>
                            {task.estimated_hours!=null?`${task.estimated_hours}h`:"—"}
                          </td>
                          <td style={{padding:"6px 10px"}}>
                            {m&&<div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                              <Avatar member={m} size={16}/>
                              <span style={{color:"var(--color-text-secondary)",fontSize:"10px"}}>{m.short_name}</span>
                            </div>}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
                {filteredTasks.length===0&&(
                  <tr><td colSpan={6} style={{padding:"36px",textAlign:"center",color:"var(--color-text-tertiary)",fontSize:"12px"}}>
                    条件に一致するタスクがありません
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* サイドパネル（PCのみ） */}
      {selectedTask&&!isMobile&&(()=>{
        const m  = members.find(mb=>mb.id===selectedTask.assignee_member_id);
        const pj = projects.find(p=>p.id===selectedTask.project_id);
        const sideTd = (selectedTask.todo_ids ?? [])[0] ? todos.find(t=>t.id===selectedTask.todo_ids[0]) : undefined;
        const isOverdue = selectedTask.due_date&&selectedTask.due_date<t0&&selectedTask.status!=="done";
        return (
          <div style={{
            width:"264px",flexShrink:0,
            borderLeft:"1px solid var(--color-border-primary)",
            background:"var(--color-bg-primary)",
            display:"flex",flexDirection:"column",overflow:"hidden",
          }}>
            <div style={{padding:"9px 12px",borderBottom:"1px solid var(--color-border-primary)",
              display:"flex",alignItems:"center",gap:"6px"}}>
              <span style={{flex:1,fontSize:"11px",fontWeight:"500",color:"var(--color-text-primary)",
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {selectedTask.name}
              </span>
              <button onClick={()=>setSelectedTaskId(null)} style={{
                background:"none",border:"none",cursor:"pointer",fontSize:"14px",
                color:"var(--color-text-tertiary)",flexShrink:0,
              }}>✕</button>            </div>
            {/* 編集ボタン */}
            <div style={{padding:"0 12px 8px",flexShrink:0}}>
              <button onClick={()=>setEditingTaskId(selectedTask.id)} style={{
                width:"100%",padding:"5px",fontSize:"11px",
                background:"var(--color-bg-info)",color:"var(--color-text-info)",
                border:"1px solid var(--color-border-info)",
                borderRadius:"var(--radius-md)",cursor:"pointer",fontWeight:"500",
              }}>✏ 詳細を編集</button>
            </div>
            <div style={{flex:1,overflow:"auto",padding:"0 12px 8px"}}>
              {pj&&<DR label="PJ">
                <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:pj.color_tag,display:"inline-block"}}/>
                  <span style={{fontSize:"11px",color:"var(--color-text-secondary)"}}>{pj.name}</span>
                </div>
              </DR>}
              {sideTd&&<DR label="ToDo">
                <span style={{fontSize:"11px",color:"#059669",lineHeight:1.4}}>{sideTd.title}</span>
              </DR>}
              <DR label="状態">
                <span style={{fontSize:"9px",padding:"2px 6px",borderRadius:"3px",
                  background:STATUS_COLORS[selectedTask.status].bg,color:STATUS_COLORS[selectedTask.status].color}}>
                  {STATUS_LABELS[selectedTask.status]}
                </span>
              </DR>
              <DR label="担当">
                {m?<div style={{display:"flex",alignItems:"center",gap:"5px"}}>
                  <Avatar member={m} size={18}/>
                  <span style={{fontSize:"11px",color:"var(--color-text-secondary)"}}>{m.display_name}</span>
                </div>:<span style={{color:"var(--color-text-tertiary)",fontSize:"11px"}}>未担当</span>}
              </DR>
              <DR label="期日">
                <span style={{fontSize:"11px",
                  color:isOverdue?"var(--color-text-danger)":"var(--color-text-secondary)",
                  fontWeight:isOverdue?"500":"400"}}>
                  {selectedTask.due_date??"未設定"}{isOverdue?" ⚠":""}
                </span>
              </DR>
              {selectedTask.priority&&<DR label="優先度">
                <span style={{fontSize:"9px",padding:"2px 6px",borderRadius:"3px",
                  background:PRIORITY_COLORS[selectedTask.priority].bg,color:PRIORITY_COLORS[selectedTask.priority].color}}>
                  {PRIORITY_LABELS[selectedTask.priority]}
                </span>
              </DR>}
              {selectedTask.estimated_hours!=null&&<DR label="工数">
                <span style={{fontSize:"11px",color:"var(--color-text-secondary)"}}>{selectedTask.estimated_hours}h</span>
              </DR>}
              {selectedTask.comment&&(
                <div style={{marginTop:"10px"}}>
                  <div style={{fontSize:"10px",fontWeight:"500",color:"var(--color-text-tertiary)",
                    marginBottom:"4px",textTransform:"uppercase",letterSpacing:"0.05em"}}>コメント</div>
                  <div style={{fontSize:"11px",color:"var(--color-text-secondary)",lineHeight:1.6,
                    whiteSpace:"pre-wrap",background:"var(--color-bg-secondary)",
                    padding:"7px 9px",borderRadius:"var(--radius-md)",
                    border:"1px solid var(--color-border-primary)"}}>
                    {renderComment(selectedTask.comment)}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* タスク詳細・編集モーダル */}
      {editingTaskId && (
        <TaskEditModal
          taskId={editingTaskId}
          currentUser={currentUser}
          onClose={() => setEditingTaskId(null)}
          onUpdated={() => setEditingTaskId(null)}
          onDeleted={id => {
            setEditingTaskId(null);
            setSelectedTaskId(null);
          }}
        />
      )}
    </div>
  );
}

import React from "react";

function Chip({active,onClick,label}:{active:boolean;onClick:()=>void;label:string}) {
  return (
    <button onClick={onClick} style={{
      padding:"3px 10px",fontSize:"10px",borderRadius:"var(--radius-full)",cursor:"pointer",
      fontWeight:active?"500":"400",
      background:active?"var(--color-brand-light)":"transparent",
      color:active?"var(--color-text-purple)":"var(--color-text-tertiary)",
      border:active?"1px solid var(--color-brand-border)":"1px solid var(--color-border-primary)",
      transition:"all 0.1s",
    }}>{label}</button>
  );
}

function DR({label,children}:{label:string;children:React.ReactNode}) {
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:"8px",
      padding:"5px 0",borderBottom:"1px solid var(--color-bg-tertiary)"}}>
      <span style={{fontSize:"10px",color:"var(--color-text-tertiary)",width:"44px",flexShrink:0,paddingTop:"2px"}}>
        {label}
      </span>
      <div style={{flex:1}}>{children}</div>
    </div>
  );
}

const selStyle: React.CSSProperties = {
  padding:"3px 7px",fontSize:"10px",
  border:"1px solid var(--color-border-primary)",borderRadius:"var(--radius-md)",
  background:"var(--color-bg-primary)",color:"var(--color-text-secondary)",
  cursor:"pointer",outline:"none",
};
