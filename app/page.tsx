"use client";

import { useRef, useState } from "react";

type Message = {
  role: "user" | "model";
  text: string;
  files?: { name: string; mimeType: string; data: string }[];
};

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gemini-3.7-flash");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send() {
    if (!prompt.trim() || !apiKey.trim() || busy) return;
    setBusy(true);

    const uploaded = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        mimeType: f.type || "application/octet-stream",
        data: await fileToBase64(f)
      }))
    );

    const next = [...messages, { role: "user" as const, text: prompt, files: uploaded }];
    setMessages(next);
    setPrompt("");
    setFiles([]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-gemini-api-key": apiKey },
      body: JSON.stringify({ model, messages: next })
    });

    if (!res.ok) {
      const err = await res.text();
      setMessages([...next, { role: "model", text: `ERROR: ${err}` }]);
      setBusy(false);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setBusy(false);
      return;
    }

    const decoder = new TextDecoder();
    let answer = "";
    setMessages([...next, { role: "model", text: "" }]);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      setMessages([...next, { role: "model", text: answer }]);
    }

    setBusy(false);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">Gemini Terminal</div>
          <div className="sub">Web interface • Vercel ready</div>
        </div>
        <div className="controls">
          <select value={model} onChange={e => setModel(e.target.value)}>
            <option>gemini-3.7-flash</option>
            <option>gemini-3.8-flash</option>
            <option>gemini-3.7-pro</option>
          </select>
          <button className="ghost" onClick={() => setMessages([])}>Clear</button>
        </div>
      </header>

      <section className="keybar">
        <span className="label">GOOGLE AI STUDIO API KEY</span>
        <input
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          type={showKey ? "text" : "password"}
          placeholder="Paste your Gemini API key (AQ....)"
          autoComplete="off"
        />
        <button className="ghost" onClick={() => setShowKey(!showKey)}>
          {showKey ? "Hide" : "Show"}
        </button>
        <span className="safe">Used only for requests from this browser session.</span>
      </section>

      <section className="terminal">
        {messages.length === 0 && (
          <div className="welcome">
            <div className="promptline"><span>$</span> Gemini Terminal UI</div>
            <p>Enter a prompt, attach files, and run it through Gemini.</p>
            <p className="dim">For production, prefer a Vercel environment variable instead of pasting a key.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div className="message" key={i}>
            <div className={m.role === "user" ? "tag user" : "tag model"}>
              {m.role === "user" ? "$ user" : "gemini"}
            </div>
            {m.files?.map(f => <div className="file" key={f.name}>📎 {f.name}</div>)}
            <pre>{m.text || (busy && i === messages.length - 1 ? "…" : "")}</pre>
          </div>
        ))}
      </section>

      <section className="composer">
        {files.length > 0 && (
          <div className="attachments">
            {files.map(f => <span key={f.name}>📎 {f.name}</span>)}
          </div>
        )}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Type a command/prompt… (Enter to run, Shift+Enter for newline)"
        />
        <div className="composerRow">
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={e => setFiles(Array.from(e.target.files || []))}
          />
          <button className="ghost" onClick={() => inputRef.current?.click()}>Attach files</button>
          <span className="hint">{apiKey ? "API key loaded" : "API key required"}</span>
          <button className="run" disabled={!apiKey || !prompt.trim() || busy} onClick={send}>
            {busy ? "Running…" : "Run  ↵"}
          </button>
        </div>
      </section>
    </main>
  );
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
