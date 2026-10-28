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
type StatisticsRange = "7天" | "30天" | "本月";
type StatisticsBucket = { label: string; title: string; value: number; taskCount: number; knownCount: number; missingCount: number };
type SyncState = "connecting" | "live" | "retrying" | "stale" | "offline";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 7 * 60 * 1000;

function isToday(unixSeconds:number,now:number){return new Date(unixSeconds*1000).toDateString()===new Date(now).toDateString()}
function startOfLocalWeek(now:number){const today=startOfLocalDay(new Date(now));const weekday=today.getDay()||7;return addLocalDays(today,1-weekday)}
function formatClock(unixSeconds:number){return new Date(unixSeconds*1000).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}
function formatRelative(unixSeconds:number,now:number){const minutes=Math.max(0,Math.floor((now-unixSeconds*1000)/60000));return minutes<1?"刚刚":minutes<60?`${minutes}分钟前`:minutes<1440?`${Math.floor(minutes/60)}小时前`:`${Math.floor(minutes/1440)}天前`}
function formatTokens(value:number|null){if(value===null)return "暂不可用";if(value>=1_000_000)return `约 ${(value/1_000_000).toFixed(2)}M`;if(value>=1_000)return `约 ${(value/1_000).toFixed(value>=100_000?0:1)}K`;return `约 ${value}`}
function formatTaskTokens(task:RecentTask){const value=task.tokenCount;if(value===null)return "暂不可用";const prefix=task.tokenSource==="account-estimate"?"约 ":"";if(value>=1_000_000)return `${prefix}${(value/1_000_000).toFixed(2)}M`;if(value>=1_000)return `${prefix}${(value/1_000).toFixed(value>=100_000?0:1)}K`;return `${prefix}${value}`}
function compactTokenValue(value:number){if(value>=1_000_000)return `${(value/1_000_000).toFixed(2)}M`;if(value>=1_000)return `${(value/1_000).toFixed(value>=100_000?0:1)}K`;return `${Math.round(value)}`}
function startOfLocalDay(value:Date){return new Date(value.getFullYear(),value.getMonth(),value.getDate())}
function addLocalDays(value:Date,days:number){const next=new Date(value);next.setDate(next.getDate()+days);return next}
function dateLabel(value:Date){return `${value.getMonth()+1}/${value.getDate()}`}
function statisticsRangeBounds(range:StatisticsRange,now:number){const today=startOfLocalDay(new Date(now));const end=addLocalDays(today,1);if(range==="7天")return{start:addLocalDays(today,-6),end};if(range==="30天")return{start:addLocalDays(today,-29),end};return{start:new Date(today.getFullYear(),today.getMonth(),1),end}}

function makeStatisticsBucket(label:string,from:Date,to:Date,tasks:RecentTask[]):StatisticsBucket{
  const fromSeconds=from.getTime()/1000;
  const toSeconds=to.getTime()/1000;
  const rangeTasks=tasks.filter(task=>task.updatedAt>=fromSeconds&&task.updatedAt<toSeconds);
  const known=rangeTasks.filter(task=>task.tokenCount!==null);
  const missingCount=rangeTasks.length-known.length;
  const value=known.reduce((sum,task)=>sum+(task.tokenCount??0),0);
  const dates=`${dateLabel(from)} 至 ${dateLabel(addLocalDays(to,-1))}`;
  const detail=rangeTasks.length===0?"没有读取到任务":known.length===0?`${rangeTasks.length} 条任务均缺少 Token 记录`:`${compactTokenValue(value)} Tokens${missingCount?`，另有 ${missingCount} 条缺少 Token`:""}`;
  return{label,title:`${dates}：${detail}`,value,taskCount:rangeTasks.length,knownCount:known.length,missingCount};
}

function statisticsBuckets(range:StatisticsRange,tasks:RecentTask[],now:number):StatisticsBucket[]{
  const today=startOfLocalDay(new Date(now));
  if(range==="7天"){
    const start=addLocalDays(today,-6);
    return Array.from({length:7},(_,index)=>{const from=addLocalDays(start,index);const to=addLocalDays(from,1);return makeStatisticsBucket(["日","一","二","三","四","五","六"][from.getDay()],from,to,tasks)});
  }
  if(range==="30天"){
    const start=addLocalDays(today,-29);
    return Array.from({length:6},(_,index)=>{const from=addLocalDays(start,index*5);const to=index===5?addLocalDays(today,1):addLocalDays(from,5);return makeStatisticsBucket(`${dateLabel(from)}–${dateLabel(addLocalDays(to,-1))}`,from,to,tasks)});
  }
  const monthStart=new Date(today.getFullYear(),today.getMonth(),1);
  const tomorrow=addLocalDays(today,1);
  const count=Math.ceil(today.getDate()/7);
  return Array.from({length:count},(_,index)=>{const from=addLocalDays(monthStart,index*7);const to=new Date(Math.min(addLocalDays(from,7).getTime(),tomorrow.getTime()));return makeStatisticsBucket(`${from.getDate()}–${addLocalDays(to,-1).getDate()}日`,from,to,tasks)});
}

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

function MiniWidget({ mode, usage, resetText, syncLabel, syncState, onToggle, onClose }: { mode: WindowMode; usage: RealUsage | null; resetText: string; syncLabel: string; syncState: SyncState; onToggle: () => void; onClose: () => void }) {
  return <header className="mini-widget" data-tauri-drag-region>
    <div className="app-mark" data-tauri-drag-region><img src={rabbitIcon} alt="Token Trace 奔跑兔子"/></div>
    <div className={`identity sync-${syncState}`} data-tauri-drag-region><b data-tauri-drag-region>Token Trace</b><span data-tauri-drag-region>{syncLabel}</span></div>
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

function Overview({ usage, resetText, weeklyResetText, tasks, syncState }: { usage: RealUsage | null; resetText: string; weeklyResetText: string; tasks:RecentTask[]; syncState:SyncState }) {
  const latest=tasks[0];
  const totalTokens=tasks.reduce((sum,task)=>sum+(task.tokenCount??0),0);
  return <div className="view-content">
    <div className="view-heading"><h1>使用概览</h1><span className={`mock-badge sync-${syncState}`}><i/>{syncState==="live"?"Codex 实时":syncState==="stale"?"数据已过期":syncState==="retrying"?"刷新失败":syncState==="connecting"?"正在连接":"未连接"}</span></div>
    <CompactUsage usage={usage} resetText={resetText} weeklyResetText={weeklyResetText}/>
    <div className="current-task"><span className="line-icon"><Icon name="clock"/></span><span><small>最近任务</small><strong>{latest?.title??"今天还没有 Codex 任务"}</strong><em>{latest?`${formatTaskTokens(latest)} Tokens · ${formatRelative(latest.updatedAt,Date.now())}`:"等待新任务"}</em></span></div>
    <div className="overview-stats"><article><small>今日任务</small><strong>{tasks.length}</strong><span>按任务逐条显示</span></article><article><small>今日任务 Token</small><strong>{formatTokens(totalTokens)}</strong><span>Codex 本地记录</span></article></div>
    <div className="activity-strip"><span>最近任务</span><div>{tasks.slice(0,6).map((task,index)=><i key={task.id} style={{height:`${Math.max(18,100-index*13)}%`}} title={`${task.title}：${formatTaskTokens(task)} Tokens`}/>)}</div><b>5分钟同步</b></div>
  </div>;
}

function Tasks({ tasks,now }: { tasks:RecentTask[];now:number }) {
  const [taskRange,setTaskRange]=useState<"today"|"week">("today");
  const today=new Date(now);
  const start=taskRange==="today"?startOfLocalDay(today):startOfLocalWeek(now);
  const end=addLocalDays(startOfLocalDay(today),1);
  const visibleTasks=tasks.filter(task=>task.updatedAt>=start.getTime()/1000&&task.updatedAt<end.getTime()/1000).sort((a,b)=>b.updatedAt-a.updatedAt);
  return <div className="view-content">
    <div className="task-toolbar"><div className="task-range"><button className={taskRange==="today"?"active":""} onClick={()=>setTaskRange("today")}>今天</button><button className={taskRange==="week"?"active":""} onClick={()=>setTaskRange("week")}>本周</button></div><b>{visibleTasks.length} 个任务</b></div>
    <div className="task-summary"><span>{taskRange==="today"?`${today.getMonth()+1}月${today.getDate()}日`:"本周任务"}</span><strong>{formatTokens(visibleTasks.reduce((sum,task)=>sum+(task.tokenCount??0),0))} Tokens</strong><em>每 5 分钟同步</em></div>
    {visibleTasks.length?<div className="task-list">{visibleTasks.slice(0,10).map((task,index)=><article className="task-row" key={task.id}><span className="task-index">{String(index+1).padStart(2,"0")}</span><p><strong>{task.title}</strong><small>{formatRelative(task.updatedAt,now)}更新 · {formatClock(task.updatedAt)}</small></p><span className="task-token"><b>{formatTaskTokens(task)}</b><small>Tokens · {task.tokenSource==="local-session"?"本地记录":task.tokenSource==="account-estimate"?"账号估算":"暂无记录"}</small></span></article>)}</div>:<div className="empty-state">{taskRange==="today"?"今天":"本周"}还没有 Codex 任务</div>}
  </div>;
}

function Statistics({tasks,now}:{tasks:RecentTask[];now:number}) {
  const [range, setRange] = useState<StatisticsRange>("7天");
  const buckets=useMemo(()=>statisticsBuckets(range,tasks,now),[range,tasks,now]);
  const total=buckets.reduce((sum,bucket)=>sum+bucket.value,0);
  const max=Math.max(...buckets.map(bucket=>bucket.value),1);
  const bounds=statisticsRangeBounds(range,now);
  const rangeTasks=tasks.filter(task=>task.updatedAt>=bounds.start.getTime()/1000&&task.updatedAt<bounds.end.getTime()/1000);
  const known=rangeTasks.filter(task=>task.tokenCount!==null);
  const localCount=known.filter(task=>task.tokenSource==="local-session").length;
  const estimatedCount=known.filter(task=>task.tokenSource==="account-estimate").length;
  const unavailableCount=rangeTasks.length-known.length;
  return <div className="view-content">
    <div className="view-heading"><h1>使用统计</h1><span>本机任务记录</span></div>
    <div className="range-tabs">{(["7天","30天","本月"] as StatisticsRange[]).map(item => <button key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)}>{item}</button>)}</div>
    <div className="stat-total"><span>{range}任务 Token</span><strong>{rangeTasks.length>0&&known.length===0?"--":compactTokenValue(total)}<small> Tokens</small></strong><em>{known.length}/{rangeTasks.length} 条有用量</em></div>
    <div className="bar-chart" style={{gridTemplateColumns:`repeat(${buckets.length},1fr)`}}>{buckets.map(bucket => <div key={bucket.label} title={bucket.title}><b>{bucket.taskCount>0&&bucket.knownCount===0?"--":compactTokenValue(bucket.value)}</b><i className={bucket.taskCount>0&&bucket.knownCount===0?"unavailable":""} style={{height:`${Math.max(8,bucket.value/max*54)}px`}}/><span>{bucket.label}</span></div>)}</div>
    <div className="statistics-source"><strong>数据来源</strong><span><i/>本地 Session 记录<b>{localCount} 条</b></span><span><i/>账号用量估算<b>{estimatedCount} 条</b></span><span><i/>暂无 Token 数据<b>{unavailableCount} 条</b></span><small>按任务最后更新时间归入对应日期</small></div>
  </div>;
}

function Settings({ theme, onTheme }: { theme: ThemeName; onTheme: (theme: ThemeName) => void }) {
  const [aiEnabled, setAiEnabled] = useState(false);
  const rows: { icon: IconName; title: string; detail: string; end: React.ReactNode; action?: () => void }[] = [
    { icon:"pin", title:"始终置顶", detail:"让组件保持在其他窗口上方", end:<em>已开启</em> },
    { icon:"sparkles", title:"AI 自动分类（可选）", detail:"关闭时不影响任何核心功能", end:<i className={`switch ${aiEnabled ? "on" : ""}`}/>, action:()=>setAiEnabled(value=>!value) },
    { icon:"shield", title:"数据与隐私", detail:"本地读取，不上传凭证", end:<Icon name="chevron" size={14}/> },
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
      if (!force && currentTime-lastAttemptAt.current<REFRESH_INTERVAL_MS) return;
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
    const heartbeat = window.setInterval(()=>void refreshUsage(true),REFRESH_INTERVAL_MS);
    const wakeRefresh=()=>void refreshUsage(true);
    const visibilityRefresh=()=>{if(document.visibilityState==="visible")void refreshUsage(true)};
    addEventListener("focus",wakeRefresh);
    addEventListener("pageshow",wakeRefresh);
    document.addEventListener("visibilitychange",visibilityRefresh);
    return()=>{cancelled=true;window.clearTimeout(initial);window.clearInterval(heartbeat);removeEventListener("focus",wakeRefresh);removeEventListener("pageshow",wakeRefresh);document.removeEventListener("visibilitychange",visibilityRefresh)};
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
  const lastSuccessClock=lastUpdatedAt?new Date(lastUpdatedAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"}):null;
  const isStale=lastUpdatedAt!==null&&now-lastUpdatedAt>STALE_AFTER_MS;
  const syncState:SyncState=!usage?(usageError?"offline":"connecting"):isStale?"stale":usageError?"retrying":"live";
  const syncLabel=syncState==="live"?`同步 ${lastSuccessClock}`:syncState==="retrying"?`刷新失败 · ${lastSuccessClock}`:syncState==="stale"?"数据已过期":syncState==="offline"?"连接失败":"正在连接 Codex";
  const footerLabel=syncState==="live"?(tasksAvailable?"额度与任务实时":"额度实时 · 任务不可用"):syncState==="retrying"?"刷新失败 · 显示上次数据":syncState==="stale"?"数据已过期 · 等待重试":syncState==="offline"?"Codex 未连接":"正在连接 Codex";
  const statusTitle=[lastSuccessClock?`上次成功同步 ${lastSuccessClock}`:null,usageError?`最近错误：${usageError}`:null].filter(Boolean).join("；");
  return <main className={`shell shell--${mode} theme-${theme}`}><MiniWidget mode={mode} usage={usage} resetText={resetText} syncLabel={syncLabel} syncState={syncState} onToggle={()=>void toggle()} onClose={()=>void close()}/>{mode==="expanded"&&<section className="panel"><PanelHeader view={view} onView={changeView}/>{view==="overview"?<Overview usage={usage} resetText={resetText} weeklyResetText={weeklyResetText} tasks={todayTasks} syncState={syncState}/>:view==="tasks"?<Tasks tasks={tasks} now={now}/>:view==="statistics"?<Statistics tasks={tasks} now={now}/>:<Settings theme={theme} onTheme={changeTheme}/>}<footer title={statusTitle}><span><i className={syncState==="live"?"live":syncState}/>{footerLabel}</span><b>v0.1</b></footer></section>}</main>;
}

export default App;
