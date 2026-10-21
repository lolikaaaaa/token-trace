import { useEffect, useMemo, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import rabbitIcon from "./assets/token-trace-rabbit.png";
import "./App.css";

type WindowMode = "mini" | "expanded";
type PanelView = "overview" | "tasks" | "statistics" | "settings";
type IconName = "sparkles" | "clock" | "folder" | "chart" | "pin" | "palette" | "shield" | "chevron";
type ThemeName = "teal" | "violet" | "sky";

const WINDOW_SIZE = { mini: new LogicalSize(382, 68), expanded: new LogicalSize(430, 468) };
type UsageWindow = { usedPercent: number; remainingPercent: number; windowDurationMins: number; resetsAt: number };
type RealUsage = { primary: UsageWindow; secondary: UsageWindow | null; planType: string | null; source: string };
type RecentTask = { id: string; title: string; createdAt: number; updatedAt: number; tokenCount: number | null; tokenSource: "local-session" | "account-estimate" | null };
type DashboardSnapshot = { usage: RealUsage; tasks: RecentTask[]; tasksAvailable: boolean };

const CHART_VALUES = [6.2, 9.4, 7.1, 11.8, 8.6, 14.2, 12.9];

function isToday(unixSeconds:number,now:number){return new Date(unixSeconds*1000).toDateString()===new Date(now).toDateString()}
function formatClock(unixSeconds:number){return new Date(unixSeconds*1000).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}
function formatRelative(unixSeconds:number,now:number){const minutes=Math.max(0,Math.floor((now-unixSeconds*1000)/60000));return minutes<1?"刚刚":minutes<60?`${minutes}分钟前`:minutes<1440?`${Math.floor(minutes/60)}小时前`:`${Math.floor(minutes/1440)}天前`}
function formatTokens(value:number|null){if(value===null)return "暂不可用";if(value>=1_000_000)return `约 ${(value/1_000_000).toFixed(2)}M`;if(value>=1_000)return `约 ${(value/1_000).toFixed(value>=100_000?0:1)}K`;return `约 ${value}`}
function formatTaskTokens(task:RecentTask){const value=task.tokenCount;if(value===null)return "暂不可用";const prefix=task.tokenSource==="account-estimate"?"约 ":"";if(value>=1_000_000)return `${prefix}${(value/1_000_000).toFixed(2)}M`;if(value>=1_000)return `${prefix}${(value/1_000).toFixed(value>=100_000?0:1)}K`;return `${prefix}${value}`}

function formatRemaining(unixSeconds: number | undefined, now: number) {
  if (!unixSeconds) return "未连接";
  const minutes = Math.max(0, Math.ceil((unixSeconds * 1000 - now) / 60000));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}小时${mins.toString().padStart(2, "0")}分` : `${mins}分钟`;
}

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    sparkles: <><path d="m12 3 1.3 4.2L17.5 9l-4.2 1.8L12 15l-1.3-4.2L6.5 9l4.2-1.8L12 3Z"/><path d="m18.5 15 .7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></>,
    folder: <path d="M3.5 7.5h6l2-2h9v13h-17v-11Z"/>,
    chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3"/></>,
    pin: <><path d="m9 4 6 0-.8 5 3 3H6.8l3-3L9 4Z"/><path d="M12 12v8"/></>,
    palette: <><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-3-4-5-9-5Z"/><path d="M7 9h.01M9 6h.01M14 6h.01"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.5 2.8 7.8 7 10 4.2-2.2 7-5.5 7-10V6l-7-3Z"/><path d="M9.5 12 11 13.5l3.5-4"/></>,
    chevron: <path d="m9 6 6 6-6 6"/>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function UsageLine({ label, value }: { label: string; value: number | null }) {
  return <div className="usage-line"><span>{label}</span><div className="micro-track"><i style={{ width: `${value ?? 0}%` }} /></div><strong>{value === null ? "--" : `${Math.round(value)}%`}</strong></div>;
}

function MiniWidget({ mode, usage, resetText, lastUpdatedText, onToggle, onClose }: { mode: WindowMode; usage: RealUsage | null; resetText: string; lastUpdatedText: string; onToggle: () => void; onClose: () => void }) {
  return <header className="mini-widget" data-tauri-drag-region>
    <div className="app-mark" data-tauri-drag-region><img src={rabbitIcon} alt="Token Trace 奔跑兔子"/></div>
    <div className="identity" data-tauri-drag-region><b data-tauri-drag-region>Token Trace</b><span data-tauri-drag-region>{usage ? lastUpdatedText : "等待连接 Codex"}</span></div>
    <div className="usage-cluster" aria-label="剩余用量"><UsageLine label="5h" value={usage?.primary.remainingPercent ?? null}/><UsageLine label="7d" value={usage?.secondary?.remainingPercent ?? null}/></div>
    <div className="countdown"><span>RESET</span><strong>{resetText}</strong></div>
    <div className="window-actions"><button className="icon-button toggle-button" aria-label="展开或收起" onClick={onToggle}>{mode === "mini" ? "⌄" : "⌃"}</button><button className="icon-button close-button" aria-label="关闭" onClick={onClose}>×</button></div>
  </header>;
}

function PanelHeader({ view, onView }: { view: PanelView; onView: (view: PanelView) => void }) {
  const items: [PanelView, string][] = [["overview", "概览"], ["tasks", "任务"], ["statistics", "统计"], ["settings", "设置"]];
  return <nav className="panel-tabs">{items.map(([id, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => onView(id)}>{label}</button>)}</nav>;
}

function CompactUsage({ usage, resetText, weeklyResetText }: { usage: RealUsage | null; resetText: string; weeklyResetText: string }) {
  const primary = usage ? Math.round(usage.primary.remainingPercent) : null;
  const secondary = usage?.secondary ? Math.round(usage.secondary.remainingPercent) : null;
  return <div className="compact-usage">
    <div><span>5小时剩余</span><strong>{primary === null ? "--" : `${primary}%`}</strong><div className="usage-bar"><i style={{width:`${primary ?? 0}%`}}/></div><small><Icon name="clock" size={12}/>{resetText}{usage ? "后恢复" : ""}</small></div>
    <div><span>每周剩余</span><strong>{secondary === null ? "--" : `${secondary}%`}</strong><div className="usage-bar"><i style={{width:`${secondary ?? 0}%`}}/></div><small><Icon name="clock" size={12}/>{weeklyResetText}{usage?.secondary ? "后恢复" : ""}</small></div>
  </div>;
}

function Overview({ usage, resetText, weeklyResetText, tasks }: { usage: RealUsage | null; resetText: string; weeklyResetText: string; tasks:RecentTask[] }) {
  const latest=tasks[0];
  const totalTokens=tasks.reduce((sum,task)=>sum+(task.tokenCount??0),0);
  return <div className="view-content">
    <div className="view-heading"><h1>使用概览</h1><span className="mock-badge"><i/>{usage ? "Codex 实时" : "未连接"}</span></div>
    <CompactUsage usage={usage} resetText={resetText} weeklyResetText={weeklyResetText}/>
    <div className="current-task"><span className="line-icon"><Icon name="clock"/></span><span><small>最近任务</small><strong>{latest?.title??"今天还没有 Codex 任务"}</strong><em>{latest?`${formatTaskTokens(latest)} Tokens · ${formatRelative(latest.updatedAt,Date.now())}`:"等待新任务"}</em></span></div>
    <div className="overview-stats"><article><small>今日任务</small><strong>{tasks.length}</strong><span>按任务逐条显示</span></article><article><small>今日任务 Token</small><strong>{formatTokens(totalTokens)}</strong><span>Codex 本地记录</span></article></div>
    <div className="activity-strip"><span>最近任务</span><div>{tasks.slice(0,6).map((task,index)=><i key={task.id} style={{height:`${Math.max(18,100-index*13)}%`}} title={`${task.title}：${formatTaskTokens(task)} Tokens`}/>)}</div><b>5分钟同步</b></div>
  </div>;
}

function Tasks({ tasks,now }: { tasks:RecentTask[];now:number }) {
  const today=new Date(now);
  return <div className="view-content">
    <div className="task-toolbar"><span>今天 · {today.getMonth()+1}月{today.getDate()}日</span><b>{tasks.length} 个任务</b></div>
    <div className="task-summary"><span>任务列表</span><strong>{formatTokens(tasks.reduce((sum,task)=>sum+(task.tokenCount??0),0))} Tokens</strong><em>每 5 分钟同步</em></div>
    {tasks.length?<div className="task-list">{tasks.slice(0,10).map((task,index)=><article className="task-row" key={task.id}><span className="task-index">{String(index+1).padStart(2,"0")}</span><p><strong>{task.title}</strong><small>{formatRelative(task.updatedAt,now)}更新 · {formatClock(task.updatedAt)}</small></p><span className="task-token"><b>{formatTaskTokens(task)}</b><small>Tokens · {task.tokenSource==="local-session"?"本地记录":task.tokenSource==="account-estimate"?"账号估算":"暂无记录"}</small></span></article>)}</div>:<div className="empty-state">今天还没有 Codex 任务</div>}
  </div>;
}

function Statistics() {
  const [range, setRange] = useState("7天");
  return <div className="view-content">
    <div className="view-heading"><h1>使用统计</h1><span>模拟数据</span></div>
    <div className="range-tabs">{["7天","30天","本月"].map(item => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
    <div className="stat-total"><span>总使用量</span><strong>{range === "7天" ? "70.2K" : range === "30天" ? "312K" : "268K"}<small> Tokens</small></strong><em>较上期 +18%</em></div>
    <div className="bar-chart">{CHART_VALUES.map((value,index) => <div key={index} title={`${["周一","周二","周三","周四","周五","周六","周日"][index]}：${value}K Tokens`}><b>{value}K</b><i style={{height:`${value/14.2*54}px`}}/><span>{["一","二","三","四","五","六","日"][index]}</span></div>)}</div>
    <div className="distribution"><div className="donut"/><div>{[["编程","42%",1],["研究","28%",.72],["文档","18%",.48],["其他","12%",.26]].map(([name,value,opacity]) => <span key={String(name)}><i style={{opacity:Number(opacity)}}/>{name}<b>{value}</b></span>)}</div></div>
  </div>;
}

function Settings({ theme, onTheme }: { theme: ThemeName; onTheme: (theme: ThemeName) => void }) {
  const [aiEnabled, setAiEnabled] = useState(false);
  const rows: { icon: IconName; title: string; detail: string; end: React.ReactNode; action?: () => void }[] = [
    { icon:"pin", title:"始终置顶", detail:"让组件保持在其他窗口上方", end:<em>已开启</em> },
    { icon:"sparkles", title:"AI 自动分类（可选）", detail:"关闭时不影响任何核心功能", end:<i className={`switch ${aiEnabled ? "on" : ""}`}/>, action:()=>setAiEnabled(value=>!value) },
    { icon:"shield", title:"数据与隐私", detail:"本地 Mock 数据，不上传", end:<Icon name="chevron" size={14}/> },
  ];
  return <div className="view-content settings-view"><div className="view-heading"><h1>组件设置</h1><span>Local-first</span></div><div className="theme-block"><div><Icon name="palette"/><span><strong>外观与主题</strong><small>选择后立即应用</small></span></div><div className="theme-options"><button className={theme==="teal"?"selected":""} onClick={()=>onTheme("teal")}><i className="swatch teal"/>深青</button><button className={theme==="violet"?"selected":""} onClick={()=>onTheme("violet")}><i className="swatch violet"/>浅紫</button><button className={theme==="sky"?"selected":""} onClick={()=>onTheme("sky")}><i className="swatch sky"/>浅蓝</button></div></div><div className="settings-list">{rows.map(row => <button key={row.title} onClick={row.action}><span className="line-icon"><Icon name={row.icon}/></span><p><strong>{row.title}</strong><small>{row.detail}</small></p>{row.end}</button>)}</div><div className="privacy-note"><Icon name="shield" size={14}/>无需账户 · 不接服务器 · 数据保留在本机</div></div>;
}

function App() {
  const pollingStarted = useRef(false);
  const requestInFlight = useRef(false);
  const hasSuccessfulUsage = useRef(false);
  const lastAttemptAt = useRef(0);
  const [mode,setMode] = useState<WindowMode>("mini");
  const [view,setView] = useState<PanelView>("overview");
  const [theme,setTheme] = useState<ThemeName>(() => (localStorage.getItem("token-trace-theme") as ThemeName) || "teal");
  const [usage,setUsage] = useState<RealUsage|null>(null);
  const [tasks,setTasks] = useState<RecentTask[]>([]);
  const [tasksAvailable,setTasksAvailable] = useState(false);
  const [usageError,setUsageError] = useState<string|null>(null);
  const [lastUpdatedAt,setLastUpdatedAt] = useState<number|null>(null);
  const [now,setNow] = useState(Date.now());
  const resetText = formatRemaining(usage?.primary.resetsAt,now);
  const weeklyResetText = formatRemaining(usage?.secondary?.resetsAt,now);
  const todayTasks=useMemo(()=>tasks.filter(task=>isToday(task.updatedAt,now)).sort((a,b)=>b.updatedAt-a.updatedAt),[tasks,now]);
  useEffect(()=>{
    if (pollingStarted.current) return;
    pollingStarted.current = true;
    let cancelled = false;
    const refreshUsage = async (force=false) => {
      if (requestInFlight.current) return;
      const currentTime=Date.now();
      if (!force && currentTime-lastAttemptAt.current<5*60*1000) return;
      lastAttemptAt.current=currentTime;
      requestInFlight.current = true;
      try {
        const rawResponse: unknown = await Promise.race([
          invoke<DashboardSnapshot>("get_dashboard_snapshot"),
          new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("Usage refresh timed out")),20_000)),
        ]);
        if (!rawResponse || typeof rawResponse !== "object") throw new TypeError("response is not an object");
        const response = rawResponse as DashboardSnapshot;
        if (!response.usage?.primary || typeof response.usage.primary.usedPercent !== "number" || typeof response.usage.primary.remainingPercent !== "number" || typeof response.usage.primary.resetsAt !== "number") {
          throw new TypeError("primary usage fields are missing or are not numbers");
        }
        if (!response.usage.secondary || typeof response.usage.secondary.usedPercent !== "number" || typeof response.usage.secondary.remainingPercent !== "number" || typeof response.usage.secondary.resetsAt !== "number") {
          throw new TypeError("secondary usage fields are missing or are not numbers");
        }
        if (!Array.isArray(response.tasks)) throw new TypeError("task list is missing");
        if (cancelled) return;
        setUsage(response.usage);
        setTasks(response.tasks);
        setTasksAvailable(response.tasksAvailable);
        setUsageError(null);
        setLastUpdatedAt(Date.now());
        hasSuccessfulUsage.current = true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          if (!hasSuccessfulUsage.current) setUsage(null);
          setUsageError(errorMessage);
        }
      } finally {
        requestInFlight.current = false;
      }
    };
    const initial = window.setTimeout(()=>void refreshUsage(true),500);
    const heartbeat = window.setInterval(()=>void refreshUsage(),30_000);
    const wakeRefresh=()=>void refreshUsage();
    addEventListener("focus",wakeRefresh);
    addEventListener("pageshow",wakeRefresh);
    document.addEventListener("visibilitychange",wakeRefresh);
    return()=>{cancelled=true;window.clearTimeout(initial);window.clearInterval(heartbeat);removeEventListener("focus",wakeRefresh);removeEventListener("pageshow",wakeRefresh);document.removeEventListener("visibilitychange",wakeRefresh)};
  },[]);
  useEffect(()=>{
    const clock=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(clock);
  },[]);
  const close=async()=>{try{await getCurrentWindow().close()}catch{}};
  const toggle=async()=>{if(mode==="mini"){try{await getCurrentWindow().setSize(WINDOW_SIZE.expanded)}catch{}setMode("expanded")}else{setMode("mini");setTimeout(async()=>{try{await getCurrentWindow().setSize(WINDOW_SIZE.mini)}catch{}},160)}};
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.key==="Escape"&&mode==="expanded")void toggle()};addEventListener("keydown",key);return()=>removeEventListener("keydown",key)},[mode]);
  const changeView=(next:PanelView)=>setView(next);
  const changeTheme=(next:ThemeName)=>{setTheme(next);localStorage.setItem("token-trace-theme",next)};
  const lastUpdatedText=lastUpdatedAt?`同步 ${new Date(lastUpdatedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}`:"账号实时用量";
  return <main className={`shell shell--${mode} theme-${theme}`}><MiniWidget mode={mode} usage={usage} resetText={resetText} lastUpdatedText={lastUpdatedText} onToggle={()=>void toggle()} onClose={()=>void close()}/>{mode==="expanded"&&<section className="panel"><PanelHeader view={view} onView={changeView}/>{view==="overview"?<Overview usage={usage} resetText={resetText} weeklyResetText={weeklyResetText} tasks={todayTasks}/>:view==="tasks"?<Tasks tasks={todayTasks} now={now}/>:view==="statistics"?<Statistics/>:<Settings theme={theme} onTheme={changeTheme}/>}<footer title={usageError ?? `上次${lastUpdatedText}`}><span><i className={usage?"live":"offline"}/>{usage ? tasksAvailable?"额度与任务实时":"额度实时 · 任务不可用" : "Codex 未连接"}</span><b>v0.1</b></footer></section>}</main>;
}

export default App;
