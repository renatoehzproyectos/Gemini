"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type Msg = { id: string; role: "user" | "model"; text: string; files?: string[]; thoughts?: string[]; steps?: string[]; status?: string; time: number };
type Chat = { id: string; title: string; messages: Msg[]; envId: string; prevId: string; updated: number };
type Upload = { name: string; mimeType: string; data: string };
type OutputFile = { path: string; name: string; mime_type?: string; size_bytes?: string; type?: string };

const MODELS = [
  ["gemini-3.7-flash", "Gemini 3.7 Flash"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash"],
  ["gemini-3.5-flash", "Gemini 3.5 Flash"],
  ["gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite"],
] as const;

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-3.7-flash");
  const [prompt, setPrompt] = useState("");
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [settings, setSettings] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [background, setBackground] = useState(true);
  const [autoRun, setAutoRun] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState(250000);
  const [drag, setDrag] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [outputFiles, setOutputFiles] = useState<Record<string, OutputFile[]>>({});
  const [loadingOutputs, setLoadingOutputs] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const interactionRef = useRef("");

  const active = useMemo(() => chats.find(c => c.id === activeId) || null, [chats, activeId]);

  useEffect(() => {
    try {
      const savedKey = localStorage.getItem("gemini-max-api-key");
      const saved = localStorage.getItem("gemini-max-chats");
      const savedSettings = localStorage.getItem("gemini-max-settings");
      if (savedKey) setApiKey(savedKey);
      if (saved) { const parsed = JSON.parse(saved) as Chat[]; if (parsed.length) { setChats(parsed); setActiveId(parsed[0].id); } }
      if (savedSettings) { const s = JSON.parse(savedSettings); setModel(s.model || "gemini-3.7-flash"); setShowThinking(s.showThinking !== false); setBackground(!!s.background); setAutoRun(s.autoRun !== false); setSystemPrompt(s.systemPrompt || ""); setMaxTokens(Number(s.maxTokens) || 250000); }
    } catch {}
  }, []);

  useEffect(() => { if (apiKey) localStorage.setItem("gemini-max-api-key", apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem("gemini-max-settings", JSON.stringify({ model, showThinking, background, autoRun, systemPrompt, maxTokens })); }, [model, showThinking, background, autoRun, systemPrompt, maxTokens]);
  useEffect(() => { if (chats.length) localStorage.setItem("gemini-max-chats", JSON.stringify(chats)); else localStorage.removeItem("gemini-max-chats"); }, [chats]);

  function createChat() {
    const id = crypto.randomUUID();
    const chat: Chat = { id, title: "New conversation", messages: [], envId: "", prevId: "", updated: Date.now() };
    setChats(c => [chat, ...c]); setActiveId(id); setStatus("Ready");
  }
  function updateChat(id: string, patch: Partial<Chat>) { setChats(c => c.map(x => x.id === id ? { ...x, ...patch, updated: Date.now() } : x)); }
  function removeChat(id: string) { setChats(c => c.filter(x => x.id !== id)); if (id === activeId) { const next = chats.find(x => x.id !== id); setActiveId(next?.id || ""); } }
  function clearAll() { if (confirm("Delete all local conversation history?")) { setChats([]); setActiveId(""); } }
  async function stop() { const id = interactionRef.current; abortRef.current?.abort(); if (id) { try { await fetch("/api/interaction/cancel", { method: "POST", headers: { "Content-Type": "application/json", "x-gemini-api-key": apiKey }, body: JSON.stringify({ id }) }); } catch {} } setBusy(false); setStatus("Stopped"); }

  async function send() {
    if (!prompt.trim() || !apiKey.trim() || busy) return;
    let chat = active;
    if (!chat) {
      const id = crypto.randomUUID();
      chat = { id, title: "New conversation", messages: [], envId: "", prevId: "", updated: Date.now() };
      setChats(c => [chat!, ...c]);
      setActiveId(id);
    }
    setBusy(true); setStatus(background ? "Running in background…" : "Thinking…");
    const uploaded: Upload[] = await Promise.all(files.map(async f => ({ name: f.name, mimeType: f.type || "application/octet-stream", data: await fileToBase64(f) })));
    const text = prompt.trim();
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", text, files: uploaded.map(f => f.name), time: Date.now() };
    const modelMsg: Msg = { id: crypto.randomUUID(), role: "model", text: "", thoughts: [], steps: [], time: Date.now(), status: "running" };
    const title = chat.messages.length === 0 ? text.slice(0, 48) + (text.length > 48 ? "…" : "") : chat.title;
    updateChat(chat.id, { title, messages: [...chat.messages, userMsg, modelMsg] });
    setPrompt(""); setFiles([]);
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", "x-gemini-api-key": apiKey }, signal: controller.signal,
        body: JSON.stringify({ model, prompt: text, files: uploaded, environmentId: chat.envId || undefined, previousInteractionId: chat.prevId || undefined, maxTokens, background: true, autoRun, systemPrompt, thinkingSummaries: showThinking }) });
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body?.getReader(); if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("\u0000EVENT ")) continue;
          let ev: any; try { ev = JSON.parse(line.slice(7)); } catch { continue; }
          if (ev.kind === "meta") { interactionRef.current = ev.interactionId || ""; updateChat(chat.id, { prevId: ev.interactionId || chat.prevId, envId: ev.environmentId || chat.envId }); }
          if (ev.kind === "text") updateLast(chat.id, m => ({ ...m, text: m.text + (ev.text || ""), status: "running" }));
          if (ev.kind === "thought") updateLast(chat.id, m => ({ ...m, thoughts: [...(m.thoughts || []), ev.text || ""] }));
          if (ev.kind === "step") { setStatus(ev.label || "Working…"); updateLast(chat.id, m => ({ ...m, steps: [...(m.steps || []), ev.label || ev.type || "Agent step"] })); }
          if (ev.kind === "status") { if (ev.interactionId) interactionRef.current = ev.interactionId; setStatus(ev.status || "Working…"); updateLast(chat.id, m => ({ ...m, status: ev.status || "completed" })); if (ev.environmentId || ev.interactionId) updateChat(chat.id, { envId: ev.environmentId || chat.envId, prevId: ev.interactionId || chat.prevId }); }
          if (ev.kind === "error") updateLast(chat.id, m => ({ ...m, text: (m.text ? m.text + "\n\n" : "") + "Error: " + ev.message, status: "error" }));
        }
      }
      // A long agent run may end the SSE connection before the server finishes.
      // Recover the authoritative state from the stored Interaction instead of treating
      // a closed stream as a failure.
      const id = interactionRef.current;
      if (id) {
        let finalState: any = null;
        for (let attempt = 0; attempt < 90; attempt++) {
          try {
            const r = await fetch(`/api/interaction/status?id=${encodeURIComponent(id)}`, { headers: { "x-gemini-api-key": apiKey } });
            if (r.ok) {
              finalState = await r.json();
              if (["completed", "failed", "cancelled", "incomplete"].includes(finalState.status)) break;
            }
          } catch {}
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
        if (finalState) {
          if (finalState.environmentId || finalState.id) updateChat(chat.id, { envId: finalState.environmentId || chat.envId, prevId: finalState.id || chat.prevId });
          if (finalState.outputText) updateLast(chat.id, m => m.text ? m : ({ ...m, text: finalState.outputText }));
          if (finalState.status === "incomplete") {
            void loadOutputFiles(finalState.environmentId || chat.envId, modelMsg.id);
            updateLast(chat.id, m => ({ ...m, status: "incomplete" }));
            setStatus("Paused — send Continue to resume");
          } else if (finalState.status === "failed") {
            updateLast(chat.id, m => ({ ...m, status: "error", text: m.text + (finalState.error ? `\n\nError: ${finalState.error}` : "") }));
            setStatus("Failed");
          } else if (finalState.status === "cancelled") {
            updateLast(chat.id, m => ({ ...m, status: "cancelled" }));
            setStatus("Cancelled");
          } else {
            void loadOutputFiles(finalState.environmentId || chat.envId, modelMsg.id);
            updateLast(chat.id, m => ({ ...m, status: "completed" }));
            setStatus("Ready");
          }
        } else {
          updateLast(chat.id, m => ({ ...m, status: "incomplete" }));
          setStatus("Connection lost — send Continue to reconnect");
        }
      } else setStatus("Ready");
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        const id = interactionRef.current;
        if (id) {
          setStatus("Reconnecting to agent…");
          try {
            const r = await fetch(`/api/interaction/status?id=${encodeURIComponent(id)}`, { headers: { "x-gemini-api-key": apiKey } });
            const state: any = r.ok ? await r.json() : null;
            if (state) {
              if (state.environmentId || state.id) updateChat(chat.id, { envId: state.environmentId || chat.envId, prevId: state.id || chat.prevId });
              if (state.outputText) updateLast(chat.id, m => m.text ? m : ({ ...m, text: state.outputText }));
              if (state.status === "incomplete") { updateLast(chat.id, m => ({ ...m, status: "incomplete" })); setStatus("Paused — send Continue to resume"); }
              else if (state.status === "in_progress") { updateLast(chat.id, m => ({ ...m, status: "running" })); setStatus("Agent is still running in background"); }
              else if (state.status === "completed") { void loadOutputFiles(state.environmentId || chat.envId, modelMsg.id); updateLast(chat.id, m => ({ ...m, status: "completed" })); setStatus("Ready"); }
              else { updateLast(chat.id, m => ({ ...m, status: "error", text: m.text + (state.error ? `\n\nError: ${state.error}` : "\n\nConnection lost") })); setStatus("Error"); }
            } else { updateLast(chat.id, m => ({ ...m, status: "incomplete" })); setStatus("Connection lost — send Continue to reconnect"); }
          } catch { updateLast(chat.id, m => ({ ...m, status: "incomplete" })); setStatus("Connection lost — send Continue to reconnect"); }
        } else {
          updateLast(chat.id, m => ({ ...m, text: (m.text ? m.text + "\n\n" : "") + "Error: " + (e?.message || String(e)), status: "error" })); setStatus("Error");
        }
      }
    } finally { setBusy(false); abortRef.current = null; }
  }

  function updateLast(chatId: string, fn: (m: Msg) => Msg) { setChats(c => c.map(ch => ch.id === chatId ? { ...ch, messages: ch.messages.map((m, i, a) => i === a.length - 1 ? fn(m) : m), updated: Date.now() } : ch)); }
  function addFiles(list: FileList | File[]) { const incoming = Array.from(list); setFiles(prev => [...prev, ...incoming].slice(0, 20)); }
  async function loadOutputFiles(envId: string, messageId: string) {
    if (!envId) return;
    setLoadingOutputs(v => ({ ...v, [messageId]: true }));
    try {
      const res = await fetch(`/api/environment/files?environmentId=${encodeURIComponent(envId)}&path=workspace/outputs&recursive=true`, { headers: { "x-gemini-api-key": apiKey } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const files = (data.files || []).filter((f: OutputFile) => f.type === "file").map((f: OutputFile) => ({ ...f, name: cleanOutputName(f.name || f.path), mime_type: f.mime_type || mimeFromName(f.name || f.path) }));
      setOutputFiles(v => ({ ...v, [messageId]: files }));
    } catch (e: any) {
      setOutputFiles(v => ({ ...v, [messageId]: [] }));
      setStatus(`Could not load outputs: ${e?.message || "error"}`);
    } finally {
      setLoadingOutputs(v => ({ ...v, [messageId]: false }));
    }
  }
  async function downloadOutput(envId: string, file: OutputFile) {
    try {
      const res = await fetch(`/api/environment/file?environmentId=${encodeURIComponent(envId)}&path=${encodeURIComponent(file.path)}`, { headers: { "x-gemini-api-key": apiKey } });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = file.name || file.path.split("/").pop() || "download"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e: any) { setStatus(`Download failed: ${e?.message || "error"}`); }
  }
  function exportChat() { if (!active) return; downloadBlob(JSON.stringify(active, null, 2), `${slug(active.title)}.json`, "application/json"); }

  return <div className="app">
    <aside className={sidebar ? "sidebar" : "sidebar collapsed"}>
      <div className="sideTop"><button className="iconBtn" onClick={() => setSidebar(!sidebar)} aria-label="Toggle sidebar">☰</button>{sidebar && <span className="brandMini">Gemini</span>}</div>
      {sidebar && <>
        <button className="newChat" onClick={createChat}>＋ <span>New chat</span></button>
        <div className="chatList">{chats.map(c => <div className={c.id === activeId ? "chatItem active" : "chatItem"} key={c.id} onClick={() => setActiveId(c.id)}><div className="chatTitle">{c.title}</div><button className="more" onClick={e => { e.stopPropagation(); removeChat(c.id); }}>×</button></div>)}</div>
        <div className="sideBottom"><button onClick={() => setSettings(true)}>⚙ <span>Settings</span></button><button onClick={exportChat} disabled={!active}>⇩ <span>Export chat</span></button><button onClick={clearAll}>⌫ <span>Clear history</span></button></div>
      </>}
    </aside>

    <main className="main">
      <header className="header"><div><div className="eyebrow">GEMINI AGENT</div><div className="headerTitle">{active?.title || "What can I help you build?"}</div></div><div className="headerActions"><select value={model} onChange={e => setModel(e.target.value)}>{MODELS.map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select><button className="iconBtn" onClick={() => setSettings(true)}>⚙</button></div></header>

      <section className="conversation" onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
        {!active || active.messages.length === 0 ? <div className="hero"><div className="orb">✦</div><h1>Build with Gemini</h1><p>Code, research, analyze files, browse the web, run commands and transform entire projects from one conversation.</p><div className="suggestions"><button onClick={() => setPrompt("Inspect this project, find the biggest issues, and fix them. Run the tests and build afterwards.")}>Fix and improve a project</button><button onClick={() => setPrompt("Analyze this project architecture and propose the best implementation, then implement it and verify it.")}>Analyze & implement</button><button onClick={() => setPrompt("Research the latest information needed for this task, then implement the result in the project.")}>Research & build</button></div></div> : <div className="messages">{active.messages.map(m => <article className={m.role === "user" ? "msg userMsg" : "msg aiMsg"} key={m.id}>
          {m.role === "user" ? <div className="avatar userAvatar">You</div> : <div className="avatar aiAvatar">✦</div>}
          <div className="msgBody"><div className="msgHeader"><strong>{m.role === "user" ? "You" : "Gemini"}</strong>{m.status === "running" && <span className="live">Working</span>}</div>
            {m.files?.length ? <div className="chips">{m.files.map(f => <span className="chip" key={f}>📎 {f}</span>)}</div> : null}
            {m.role === "model" && m.thoughts?.length && showThinking ? <details className="thinking" open><summary>✦ Thinking summary</summary><div>{m.thoughts.join("\n")}</div></details> : null}
            {m.role === "model" && m.steps?.length ? <details className="steps"><summary>Tools & activity · {m.steps.length}</summary>{m.steps.map((s,i) => <div key={i}>✓ {s}</div>)}</details> : null}
            <div className="messageText">{m.text ? <MarkdownText text={m.text} /> : (m.status === "running" ? <span className="typing">● ● ●</span> : "")}</div>
            {m.role === "model" && active.envId && (m.status === "completed" || m.status === "incomplete") ? <div className="outputs">
              {!outputFiles[m.id]?.length && !loadingOutputs[m.id] ? <button className="outputBtn" onClick={() => loadOutputFiles(active.envId, m.id)} disabled={loadingOutputs[m.id]}>Show output files</button> : null}
              {loadingOutputs[m.id] ? <div className="outputLoading">Checking generated files…</div> : null}
              {outputFiles[m.id]?.length ? <div className="outputList">{outputFiles[m.id].map(f => <div className="outputFile" key={f.path}>
                <div className="outputMeta"><span className="outputName" title={f.path}>{f.name}</span><span className="outputType">{fileTypeLabel(f)}</span></div>
                <button className="downloadOutput" onClick={() => downloadOutput(active.envId, f)}>Download</button>
              </div>)}</div> : null}
            </div> : null}
          </div>
        </article>)}</div>}
        {drag && <div className="dropOverlay">Drop files or a project here</div>}
      </section>

      <section className="composerWrap"><div className="composer"><div className="composerTop">{files.map((f,i) => <span className="attachment" key={`${f.name}-${i}`}>📎 {f.name}<button onClick={() => setFiles(x => x.filter((_,j) => j !== i))}>×</button></span>)}</div><textarea value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Message Gemini…" rows={1} />
        <div className="composerBar"><div className="leftTools"><input ref={inputRef} hidden type="file" multiple onChange={e => { if (e.target.files) addFiles(e.target.files); e.currentTarget.value = ""; }} /><button className="toolBtn" onClick={() => inputRef.current?.click()}>＋</button><span className="toolLabel">Attach</span><button className={showThinking ? "toolBtn on" : "toolBtn"} onClick={() => setShowThinking(v => !v)} title="Show thinking summaries">✦</button><button className={background ? "toolBtn on" : "toolBtn"} onClick={() => setBackground(v => !v)} title="Background execution">◷</button></div><div className="sendArea"><span className="statusText">{status}</span>{busy ? <button className="stopBtn" onClick={stop}>■ Stop</button> : <button className="sendBtn" disabled={!apiKey || !prompt.trim()} onClick={send}>↑</button>}</div></div>
      </div><div className="disclaimer">Gemini can make mistakes. Review code and commands before using them in production.</div></section>
    </main>

    {settings && <div className="modalBackdrop" onMouseDown={e => { if (e.currentTarget === e.target) setSettings(false); }}><section className="settings"><div className="settingsHead"><div><div className="eyebrow">CONFIGURATION</div><h2>Settings</h2></div><button className="iconBtn" onClick={() => setSettings(false)}>×</button></div>
      <label>Gemini API key<input type={showKey ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="AIza…" autoComplete="off" /><small>Saved locally in this browser until you remove site data or change it. It is never written to the project.</small></label>
      <label>Agent model<select value={model} onChange={e => setModel(e.target.value)}>{MODELS.map(([v,l]) => <option value={v} key={v}>{l}</option>)}</select></label>
      <div className="settingGrid"><label className="toggle"><input type="checkbox" checked={showKey} onChange={e => setShowKey(e.target.checked)} /><span>Show API key</span></label><label className="toggle"><input type="checkbox" checked={showThinking} onChange={e => setShowThinking(e.target.checked)} /><span>Thinking summaries</span></label><label className="toggle"><input type="checkbox" checked={background} onChange={e => setBackground(e.target.checked)} /><span>Background tasks</span></label><label className="toggle"><input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} /><span>Auto test/build</span></label></div>
      <label>Maximum tokens<input type="number" min={1000} max={1000000} value={maxTokens} onChange={e => setMaxTokens(Number(e.target.value))} /></label>
      <label>Additional agent instructions<textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="Optional instructions for how Gemini should work…" /></label>
      <div className="capabilities"><strong>Agent capabilities</strong><span>✓ Filesystem</span><span>✓ Bash / Python / Node</span><span>✓ Package installation</span><span>✓ Tests & builds</span><span>✓ Google Search</span><span>✓ URL context</span><span>✓ Persistent sandbox</span><span>✓ Background execution</span></div>
      <div className="settingsFoot"><button className="danger" onClick={() => { setApiKey(""); localStorage.removeItem("gemini-max-api-key"); }}>Remove saved key</button><button className="primary" onClick={() => setSettings(false)}>Done</button></div>
    </section></div>}
  </div>;
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const code: string[] = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { code.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push(<pre className="mdCode" key={`code-${i}`}><code data-lang={lang}>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = Math.min(6, heading[1].length); const H: any = `h${level}`; blocks.push(<H className="mdHeading" key={`h-${i}`}>{inlineMarkdown(heading[2])}</H>); i++; continue; }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []; while (i < lines.length && /^[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*+]\s+/, "")); i++; }
      blocks.push(<ul className="mdList" key={`ul-${i}`}>{items.map((x,j)=><li key={j}>{inlineMarkdown(x)}</li>)}</ul>); continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []; while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
      blocks.push(<ol className="mdList" key={`ol-${i}`}>{items.map((x,j)=><li key={j}>{inlineMarkdown(x)}</li>)}</ol>); continue;
    }
    if (!line.trim()) { i++; continue; }
    const para: string[] = [line]; i++;
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("```") && !/^(#{1,6})\s+/.test(lines[i]) && !/^[-*+]\s+/.test(lines[i]) && !/^\d+\.\s+/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(<p className="mdParagraph" key={`p-${i}`}>{inlineMarkdown(para.join("\n"))}</p>);
  }
  return <div className="markdown">{blocks}</div>;
}

function inlineMarkdown(value: string): ReactNode[] {
  const parts = value.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|~~[^~]+~~)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code className="mdInlineCode" key={i}>{part.slice(1,-1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2,-2)}</strong>;
    if (part.startsWith("__") && part.endsWith("__")) return <strong key={i}>{part.slice(2,-2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={i}>{part.slice(2,-2)}</del>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={i}>{part.slice(1,-1)}</em>;
    if (part.startsWith("_") && part.endsWith("_")) return <em key={i}>{part.slice(1,-1)}</em>;
    return <span key={i}>{part}</span>;
  });
}

function cleanOutputName(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return normalized.replace(/^.*\/workspace\/outputs\/?/i, "").replace(/^.*\/outputs\/?/i, "") || normalized.split("/").pop() || "download";
}
function mimeFromName(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string,string> = { zip:"application/zip", pdf:"application/pdf", json:"application/json", txt:"text/plain", md:"text/markdown", html:"text/html", css:"text/css", js:"text/javascript", ts:"text/typescript", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", svg:"image/svg+xml", csv:"text/csv", mp3:"audio/mpeg", mp4:"video/mp4", webm:"video/webm", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  return map[ext] || "application/octet-stream";
}
function fileTypeLabel(file: OutputFile) {
  const mime = file.mime_type || mimeFromName(file.name || file.path);
  const ext = (file.name || file.path).split(".").pop()?.toUpperCase();
  const labels: Record<string,string> = { "application/zip":"ZIP", "application/pdf":"PDF", "application/json":"JSON", "text/markdown":"Markdown", "text/plain":"Text", "text/javascript":"JavaScript", "text/typescript":"TypeScript", "text/html":"HTML", "text/css":"CSS", "image/png":"PNG", "image/jpeg":"JPEG", "image/webp":"WebP", "image/svg+xml":"SVG", "text/csv":"CSV" };
  return labels[mime] || (ext ? `${ext} file` : "File");
}

function fileToBase64(file: File) { return new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] || ""); r.onerror = reject; r.readAsDataURL(file); }); }
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chat"; }
function downloadBlob(data: string, name: string, type: string) { const blob = new Blob([data], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
