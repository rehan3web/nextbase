import React, { useEffect, useRef, useState } from "react";
import { Sun, Moon, Terminal as TerminalIcon, Sparkles, Settings, AlertTriangle, Loader2, Check, X, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { DesktopSidebar, MobileSidebarTrigger } from "@/components/AppSidebar";
import { useTheme } from "@/hooks/use-theme";
import {
  useGetCommandSuggestions,
  useGetTerminalSettings,
  saveTerminalSettings,
  deleteTerminalSettings,
  generateAiCommand,
  execCommand,
  clearTerminalHistory,
  generateClientCommandId,
} from "@/api/client";
import { getSocket } from "@/api/socket";
import { useQueryClient } from "@tanstack/react-query";

type LogLine = { stream: "stdout" | "stderr" | "system" | "input"; text: string; timestamp: number };

export default function TerminalPage() {
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();
  const { data: suggestionsData } = useGetCommandSuggestions();
  const { data: settings, refetch: refetchSettings } = useGetTerminalSettings();

  const [command, setCommand] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiUnsafe, setAiUnsafe] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  const [pendingExec, setPendingExec] = useState<string | null>(null);
  const [confirmReason, setConfirmReason] = useState<string>("");
  const [confirmInput, setConfirmInput] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState("");
  const [settingsModel, setSettingsModel] = useState("");

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const socket = getSocket();
    // Filter all events by the active command id so concurrent or stale
    // commands cannot cross-contaminate state.
    const onStart = (e: { id: string; command: string }) => {
      if (e.id !== activeIdRef.current) return;
      setLogs(prev => [...prev, { stream: "input", text: `$ ${e.command}`, timestamp: Date.now() }]);
    };
    const onOutput = (e: { id: string; chunk: string; stream: "stdout" | "stderr" }) => {
      if (e.id !== activeIdRef.current) return;
      setLogs(prev => [...prev, { stream: e.stream, text: e.chunk, timestamp: Date.now() }]);
    };
    const onEnd = (e: { id: string; exitCode: number; durationMs: number }) => {
      if (e.id !== activeIdRef.current) return;
      setLogs(prev => [...prev, { stream: "system", text: `[exit ${e.exitCode} · ${e.durationMs}ms]`, timestamp: Date.now() }]);
      setRunning(false);
      activeIdRef.current = null;
    };
    socket.on("terminal-start", onStart);
    socket.on("terminal-output", onOutput);
    socket.on("terminal-end", onEnd);
    return () => {
      socket.off("terminal-start", onStart);
      socket.off("terminal-output", onOutput);
      socket.off("terminal-end", onEnd);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs.length]);

  async function runCommand(cmd: string, confirm?: string) {
    if (!cmd.trim()) return;
    setRunning(true);
    // Pre-generate the id and set it on the ref BEFORE making the HTTP
    // request, so any terminal-start/output events that race ahead of the
    // HTTP response are not dropped by the id-gating filter.
    const clientId = generateClientCommandId();
    activeIdRef.current = clientId;
    try {
      const r = await execCommand(cmd, confirm, clientId);
      if (r.requiresConfirmation) {
        setPendingExec(cmd);
        setConfirmReason(r.reason || "Dangerous command detected");
        activeIdRef.current = null;
        setRunning(false);
        return;
      }
    } catch (err: any) {
      setLogs(prev => [...prev, { stream: "stderr", text: `[error: ${err.message}]`, timestamp: Date.now() }]);
      activeIdRef.current = null;
      setRunning(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || running) return;
    setCommand("");
    runCommand(cmd);
  }

  async function handleConfirmedRun() {
    if (!pendingExec) return;
    const cmd = pendingExec;
    setPendingExec(null);
    setConfirmInput("");
    await runCommand(cmd, "I CONFIRM");
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiSuggestion(null);
    setAiUnsafe(null);
    try {
      const r = await generateAiCommand(aiPrompt.trim());
      if (!r.safe) {
        setAiUnsafe(r.reason || "AI generated a potentially unsafe command");
      }
      setAiSuggestion(r.command);
    } catch (err: any) {
      toast.error(err.message || "AI request failed");
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSaveSettings() {
    try {
      await saveTerminalSettings(settingsKey, settingsModel || undefined);
      toast.success("NVIDIA API key saved");
      setSettingsOpen(false);
      setSettingsKey("");
      setSettingsModel("");
      refetchSettings();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    }
  }

  async function handleClearKey() {
    await deleteTerminalSettings();
    toast.success("NVIDIA API key removed");
    refetchSettings();
  }

  async function handleClearHistory() {
    await clearTerminalHistory();
    setLogs([]);
    qc.invalidateQueries({ queryKey: ["terminal-history"] });
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <DesktopSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="px-4 h-18 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MobileSidebarTrigger />
              <div className="hidden lg:flex items-center gap-3">
                <div className="p-1 rounded bg-primary/10 border border-primary/20 shrink-0">
                  <TerminalIcon className="w-4 h-4 text-primary" />
                </div>
                <span className="font-medium text-sm tracking-tight text-foreground">AI Terminal</span>
                {settings && (
                  <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-full px-2 py-0 ${settings.configured ? 'text-primary bg-primary/10 border-primary/20' : 'text-muted-foreground bg-muted/50'}`}>
                    {settings.configured ? "AI Ready" : "AI Not Configured"}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 rounded-full text-xs" onClick={() => setSettingsOpen(true)}>
                <Settings className="w-3.5 h-3.5 mr-2" />Terminal Settings
              </Button>
              <Button variant="ghost" size="icon" className="w-8 h-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60" onClick={toggle}>
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-8 space-y-6 pb-24 max-w-6xl w-full mx-auto">
          <div className="flex flex-col gap-2 mb-4">
            <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-foreground leading-none">AI Terminal</h1>
            <p className="text-muted-foreground text-sm max-w-xl leading-relaxed">
              Run shell commands, ask the NVIDIA LLM to translate natural language into commands, with built-in safety guards.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Terminal */}
              <Card className="bg-background border-border shadow-none rounded-xl overflow-hidden">
                <CardHeader className="p-4 pb-3 border-b border-border/50 flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium tracking-tight">Terminal</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">Live execution streamed over WebSocket</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={handleClearHistory}>
                    <Trash2 className="w-3 h-3 mr-1" />Clear
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <div ref={logRef} className="bg-black/95 dark:bg-black text-green-400 font-mono text-xs p-4 h-[420px] overflow-y-auto whitespace-pre-wrap">
                    {logs.length === 0 ? (
                      <span className="text-muted-foreground">Welcome to the Nextbase AI Terminal. Type a command below or use AI to generate one.</span>
                    ) : (
                      logs.map((line, i) => (
                        <div key={i} className={
                          line.stream === "input" ? "text-cyan-400 font-semibold" :
                          line.stream === "stderr" ? "text-red-400" :
                          line.stream === "system" ? "text-yellow-500" :
                          "text-green-400"
                        }>
                          {line.text}
                        </div>
                      ))
                    )}
                  </div>
                  <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3 border-t border-border bg-background">
                    <span className="text-xs text-muted-foreground font-mono">$</span>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="Type a shell command..."
                      className="font-mono text-xs"
                      disabled={running}
                      autoFocus
                    />
                    <Button type="submit" size="sm" className="h-9" disabled={running || !command.trim()}>
                      {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Run"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Suggestions */}
              <Card className="bg-background border-border shadow-none rounded-xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium tracking-tight">Command Suggestions</CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">Click any command to insert it into the prompt</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <ScrollArea className="h-[180px] pr-3">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                      {(suggestionsData?.suggestions || []).map((s) => (
                        <button
                          key={s.cmd}
                          onClick={() => setCommand(c => c ? `${c} ${s.cmd}` : s.cmd)}
                          className="flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-muted/60 transition-colors group"
                        >
                          <span className="font-mono text-xs text-primary">{s.cmd}</span>
                          <span className="text-[10px] text-muted-foreground truncate">{s.desc}</span>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* AI panel */}
            <div className="space-y-6">
              <Card className="bg-background border-border shadow-none rounded-xl">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium tracking-tight flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    AI Assistant
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground">Describe a task — NVIDIA LLM will produce a shell command.</CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-2 space-y-3">
                  {!settings?.configured && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                      NVIDIA API key not configured. Open <button className="underline font-medium" onClick={() => setSettingsOpen(true)}>Terminal Settings</button> to add one.
                    </div>
                  )}
                  <Textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. show me the 5 largest files in the current directory"
                    className="text-xs h-20"
                    disabled={!settings?.configured || aiLoading}
                  />
                  <Button onClick={handleAiGenerate} className="w-full h-9" disabled={!settings?.configured || aiLoading || !aiPrompt.trim()}>
                    {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
                    Generate Command
                  </Button>
                  {aiSuggestion && (
                    <div className="space-y-2">
                      {aiUnsafe && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>{aiUnsafe}</span>
                        </div>
                      )}
                      <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all">
                        {aiSuggestion}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setCommand(aiSuggestion)}>
                          <Check className="w-3.5 h-3.5 mr-1" />Insert
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setAiSuggestion(null); setAiUnsafe(null); }}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {settings?.configured && (
                <Card className="bg-background border-border shadow-none rounded-xl">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Model</span>
                      <span className="font-mono text-xs">{settings.model}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">API Key</span>
                      <span className="font-mono text-xs">{settings.apiKeyMasked}</span>
                    </div>
                    <Button variant="outline" size="sm" className="w-full h-8 text-xs mt-2" onClick={handleClearKey}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" />Remove API Key
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={!!pendingExec} onOpenChange={(o) => { if (!o) { setPendingExec(null); setConfirmInput(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Dangerous Command Detected
            </DialogTitle>
            <DialogDescription>{confirmReason}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all">
              {pendingExec}
            </div>
            <p className="text-xs text-muted-foreground">Type <span className="font-mono font-semibold text-foreground">I CONFIRM</span> to allow execution.</p>
            <Input value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} placeholder="I CONFIRM" className="font-mono" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setPendingExec(null); setConfirmInput(""); }}>Cancel</Button>
            <Button variant="destructive" disabled={confirmInput !== "I CONFIRM"} onClick={handleConfirmedRun}>Run Command</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Terminal Settings</DialogTitle>
            <DialogDescription>Configure the NVIDIA LLM API for AI command generation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">NVIDIA API Key</label>
              <Input type="password" value={settingsKey} onChange={(e) => setSettingsKey(e.target.value)} placeholder="nvapi-…" className="font-mono text-xs" />
              <p className="text-[10px] text-muted-foreground">Get your key from <a className="underline" href="https://build.nvidia.com/" target="_blank" rel="noreferrer">build.nvidia.com</a>.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Model (optional)</label>
              <Input value={settingsModel} onChange={(e) => setSettingsModel(e.target.value)} placeholder="openai/gpt-oss-120b" className="font-mono text-xs" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings} disabled={!settingsKey.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
