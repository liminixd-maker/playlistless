import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HelpCircle,
  BarChart3,
  Play,
  Pause,
  X as XIcon,
  SkipForward,
  Share2,
  ArrowRight,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "YT-Guess-Less — Adivina la canción" },
      { name: "description", content: "Clon de Songless usando playlists de YouTube como fuente de audio." },
      { property: "og:title", content: "YT-Guess-Less" },
      { property: "og:description", content: "Adivina la canción usando tu playlist de YouTube." },
    ],
  }),
  component: Game,
});

const STEPS = [1, 2, 4, 7, 11, 16];
const MAX = 16;
const LS_KEY = "ytguessless.config";
const LS_STATS = "ytguessless.stats";
const LS_ROUND = "ytguessless.round";

type Track = { id: string; title: string };
type Attempt = { type: "guess" | "skip"; correct: boolean; text?: string };

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

function loadYTApi(): Promise<void> {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const existing = document.getElementById("yt-iframe-api");
    if (!existing) {
      const s = document.createElement("script");
      s.id = "yt-iframe-api";
      s.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(s);
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
  });
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Game() {
  const [config, setConfig] = useState<{ apiKey: string; playlistId: string } | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [current, setCurrent] = useState<Track | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [finished, setFinished] = useState<null | "win" | "lose">(null);

  const [query, setQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const [showHelp, setShowHelp] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const playerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const stopAtRef = useRef<number>(STEPS[0]);
  const startOffsetRef = useRef<number | null>(null);

  // Load config
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        setConfig(JSON.parse(raw));
      } catch {}
    }
  }, []);

  // Fetch playlist
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    (async () => {
      setLoadingTracks(true);
      setLoadError(null);
      try {
        const all: Track[] = [];
        let pageToken = "";
        do {
          const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
          url.searchParams.set("part", "snippet,contentDetails");
          url.searchParams.set("maxResults", "50");
          url.searchParams.set("playlistId", config.playlistId);
          url.searchParams.set("key", config.apiKey);
          if (pageToken) url.searchParams.set("pageToken", pageToken);
          const r = await fetch(url.toString());
          if (!r.ok) throw new Error("Error " + r.status);
          const data = await r.json();
          for (const it of data.items || []) {
            const id = it.contentDetails?.videoId;
            const title = it.snippet?.title;
            if (id && title && title !== "Deleted video" && title !== "Private video") {
              all.push({ id, title });
            }
          }
          pageToken = data.nextPageToken || "";
        } while (pageToken);
        if (cancelled) return;
        if (!all.length) throw new Error("Playlist vacía");
        setTracks(all);
        pickRandom(all);
      } catch (e: any) {
        if (!cancelled) setLoadError(e.message || "Error cargando playlist");
      } finally {
        if (!cancelled) setLoadingTracks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  function pickRandom(list: Track[]) {
    const t = list[Math.floor(Math.random() * list.length)];
    setCurrent(t);
    setAttempts([]);
    setFinished(null);
    setQuery("");
    setProgress(0);
    startOffsetRef.current = null;
  }

  // Init YT player when track changes
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    (async () => {
      await loadYTApi();
      if (cancelled) return;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {}
        playerRef.current = null;
      }
      playerRef.current = new window.YT.Player("yt-hidden-player", {
        videoId: current.id,
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: (e: any) => {
            e.target.setVolume(80);
          },
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              tick();
            } else {
              setIsPlaying(false);
              if (rafRef.current) cancelAnimationFrame(rafRef.current);
            }
          },
        },
      });
    })();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [current]);

  function tick() {
    if (!playerRef.current) return;
    const t = playerRef.current.getCurrentTime?.() || 0;
    const offset = startOffsetRef.current ?? 0;
    setProgress(Math.max(0, t - offset));
    if (t >= stopAtRef.current) {
      try {
        playerRef.current.pauseVideo();
        playerRef.current.seekTo(offset, true);
      } catch {}
      setProgress(stopAtRef.current - offset);
      setIsPlaying(false);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  const attemptIndex = attempts.length;
  const currentLimit = STEPS[Math.min(attemptIndex, STEPS.length - 1)];

  function handlePlayPause() {
    if (!playerRef.current || finished) return;
    if (isPlaying) {
      playerRef.current.pauseVideo();
    } else {
      if (startOffsetRef.current == null) {
        let dur = 0;
        try {
          dur = playerRef.current.getDuration?.() || 0;
        } catch {}
        startOffsetRef.current =
          dur > 0 ? Math.random() * (dur * 0.5) : Math.random() * 60;
      }
      const offset = startOffsetRef.current;
      stopAtRef.current = offset + currentLimit;
      try {
        playerRef.current.seekTo(offset, true);
        playerRef.current.playVideo();
      } catch {}
    }
  }

  function recordStats(won: boolean, tries: number) {
    let stats = { played: 0, wins: 0, dist: [0, 0, 0, 0, 0, 0], streak: 0, maxStreak: 0 };
    try {
      const raw = localStorage.getItem(LS_STATS);
      if (raw) stats = { ...stats, ...JSON.parse(raw) };
    } catch {}
    stats.played++;
    if (won) {
      stats.wins++;
      stats.dist[tries - 1]++;
      stats.streak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    } else {
      stats.streak = 0;
    }
    localStorage.setItem(LS_STATS, JSON.stringify(stats));
  }

  function finish(won: boolean, finalAttempts: Attempt[]) {
    setFinished(won ? "win" : "lose");
    setIsPlaying(false);
    if (playerRef.current) {
      try {
        playerRef.current.pauseVideo();
      } catch {}
    }
    const triesUsed = finalAttempts.filter((a) => a.correct).length
      ? finalAttempts.findIndex((a) => a.correct) + 1
      : 6;
    recordStats(won, triesUsed);
    // Persist round result for share
    localStorage.setItem(
      LS_ROUND,
      JSON.stringify({ won, attempts: finalAttempts, title: current?.title, id: current?.id })
    );
  }

  function submitGuess() {
    if (!query.trim() || !current || finished) return;
    const correct = normalize(query) === normalize(current.title);
    const next: Attempt[] = [...attempts, { type: "guess", correct, text: query.trim() }];
    setAttempts(next);
    setQuery("");
    setShowSuggest(false);
    if (correct) {
      finish(true, next);
    } else if (next.length >= 6) {
      finish(false, next);
    }
  }

  function skip() {
    if (!current || finished) return;
    const next: Attempt[] = [...attempts, { type: "skip", correct: false }];
    setAttempts(next);
    setQuery("");
    if (next.length >= 6) finish(false, next);
  }

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = normalize(query);
    return tracks
      .filter((t) => normalize(t.title).includes(q))
      .slice(0, 8);
  }, [query, tracks]);

  function shareText() {
    const sq = attempts
      .map((a) => (a.correct ? "🟩" : a.type === "skip" ? "⬛" : "🟥"))
      .concat(Array(6 - attempts.length).fill("⬜"))
      .join("");
    return `YT-Guessless ${finished === "win" ? attempts.length + "/6" : "X/6"}\n${sq}`;
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareText());
      setToast("¡Resultado copiado!");
      setTimeout(() => setToast(null), 1800);
    } catch {}
  }

  // ---- Config screen ----
  if (!config) return <ConfigScreen onSave={(c) => {
    localStorage.setItem(LS_KEY, JSON.stringify(c));
    setConfig(c);
  }} />;

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex flex-col font-sans">
      {/* Hidden YT player */}
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        <div id="yt-hidden-player" />
      </div>

      {/* Header */}
      <header className="relative px-4 py-4 border-b border-white/10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <button onClick={() => setShowHelp(true)} className="p-2 text-slate-300 hover:text-white transition" aria-label="Ayuda">
            <HelpCircle size={22} />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">YT-GUESS-LESS</h1>
          <button onClick={() => setShowStats(true)} className="p-2 text-slate-300 hover:text-white transition" aria-label="Estadísticas">
            <BarChart3 size={22} />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
        {loadingTracks && <p className="text-center text-slate-400">Cargando playlist…</p>}
        {loadError && (
          <div className="text-center space-y-3">
            <p className="text-red-400">Error: {loadError}</p>
            <button
              onClick={() => {
                localStorage.removeItem(LS_KEY);
                setConfig(null);
              }}
              className="text-sm underline text-slate-300"
            >
              Reconfigurar API Key / Playlist
            </button>
          </div>
        )}

        {/* Attempt bars */}
        <div className="flex flex-col gap-2">
          {STEPS.map((sec, i) => {
            const widthPct = (sec / MAX) * 100;
            const a = attempts[i];
            const isCurrent = i === attemptIndex && !finished;
            let bg = "bg-slate-800/60 border-slate-700";
            let content: React.ReactNode = null;
            if (a) {
              if (a.correct) {
                bg = "bg-green-600/80 border-green-500";
                content = <span className="text-xs font-semibold truncate px-2">{a.text}</span>;
              } else if (a.type === "skip") {
                bg = "bg-slate-600/80 border-slate-500";
                content = (
                  <span className="flex items-center gap-1 text-xs font-semibold px-2">
                    <SkipForward size={12} /> SKIP
                  </span>
                );
              } else {
                bg = "bg-red-600/80 border-red-500";
                content = (
                  <span className="flex items-center gap-1 text-xs font-semibold truncate px-2">
                    <XIcon size={12} /> {a.text}
                  </span>
                );
              }
            }
            return (
              <div key={i} className="relative h-10 w-full bg-slate-900/40 rounded border border-slate-800/60">
                <div
                  className={`absolute inset-y-0 left-0 rounded border ${bg} ${isCurrent ? "ring-1 ring-white/30" : ""} flex items-center`}
                  style={{ width: `${widthPct}%` }}
                >
                  {content}
                </div>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">{sec}s</span>
              </div>
            );
          })}
        </div>

        {/* Timeline */}
        <div className="space-y-3">
          <div className="relative h-2 w-full bg-slate-800 rounded-full overflow-hidden">
            {/* segment markers */}
            {STEPS.slice(0, -1).map((s, i) => (
              <div key={i} className="absolute top-0 bottom-0 w-px bg-slate-700" style={{ left: `${(s / MAX) * 100}%` }} />
            ))}
            <div
              className="absolute top-0 bottom-0 left-0 bg-green-500 transition-[width] duration-100"
              style={{ width: `${Math.min((progress / MAX) * 100, 100)}%` }}
            />
            <div
              className="absolute top-0 bottom-0 left-0 bg-white/10"
              style={{ width: `${(currentLimit / MAX) * 100}%` }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 tabular-nums w-20">
              {fmt(progress)} / {fmt(currentLimit)}
            </span>
            <button
              onClick={handlePlayPause}
              disabled={!current || !!finished}
              className="h-14 w-14 rounded-full bg-white text-slate-900 flex items-center justify-center hover:scale-105 transition disabled:opacity-40 disabled:hover:scale-100"
            >
              {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="ml-0.5" />}
            </button>
            <span className="w-20 text-right text-xs text-slate-500">{fmt(MAX)}</span>
          </div>
        </div>

        {/* Search */}
        {!finished && (
          <div className="mt-2 space-y-3">
            <div className="relative">
              {showSuggest && suggestions.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shadow-2xl max-h-64 overflow-y-auto z-10">
                  {suggestions.map((s, i) => (
                    <button
                      key={s.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setQuery(s.title);
                        setShowSuggest(false);
                      }}
                      className={`w-full text-left px-4 py-2 text-sm truncate ${i === highlight ? "bg-slate-800" : "hover:bg-slate-800"}`}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowSuggest(true);
                  setHighlight(0);
                }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlight((h) => Math.max(h - 1, 0));
                  } else if (e.key === "Enter") {
                    if (showSuggest && suggestions[highlight]) {
                      setQuery(suggestions[highlight].title);
                      setShowSuggest(false);
                    } else {
                      submitGuess();
                    }
                  } else if (e.key === "Escape") {
                    setShowSuggest(false);
                  }
                }}
                placeholder="¿Conoces esta canción? Busca el título…"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-slate-500 placeholder:text-slate-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={skip}
                className="flex-1 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold transition"
              >
                SALTAR (+{attemptIndex < 5 ? STEPS[attemptIndex + 1] - STEPS[attemptIndex] : 0}s)
              </button>
              <button
                onClick={submitGuess}
                disabled={!query.trim()}
                className="flex-1 py-3 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-sm font-semibold transition"
              >
                ENVIAR
              </button>
            </div>
          </div>
        )}

        {/* Result */}
        {finished && current && (
          <div className="mt-4 text-center bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
            <img
              src={`https://i.ytimg.com/vi/${current.id}/hqdefault.jpg`}
              alt={current.title}
              className="mx-auto rounded-lg w-64 max-w-full shadow-xl"
            />
            <div>
              <p className={`text-sm uppercase font-semibold tracking-wider ${finished === "win" ? "text-green-400" : "text-red-400"}`}>
                {finished === "win" ? "¡Has acertado!" : "Fin del juego"}
              </p>
              <p className="text-lg font-semibold mt-1">{current.title}</p>
            </div>
            <pre className="text-2xl tracking-widest">{shareText().split("\n")[1]}</pre>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                onClick={copyShare}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold flex items-center justify-center gap-2"
              >
                <Share2 size={16} /> Compartir resultado
              </button>
              <button
                onClick={() => pickRandom(tracks)}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-sm font-semibold flex items-center justify-center gap-2"
              >
                Siguiente canción <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-medium shadow-lg">
          {toast}
        </div>
      )}

      {showHelp && <Modal onClose={() => setShowHelp(false)} title="Cómo jugar">
        <ul className="text-sm space-y-2 text-slate-300">
          <li>• Escucha el fragmento y adivina el título de la canción.</li>
          <li>• Tienes 6 intentos. Cada intento desbloquea más segundos: 1, 2, 4, 7, 11, 16.</li>
          <li>• Puedes SALTAR un intento para escuchar más sin gastar una adivinanza correcta.</li>
          <li>• El audio se carga desde tu playlist de YouTube.</li>
        </ul>
      </Modal>}

      {showStats && <StatsModal onClose={() => setShowStats(false)} />}
    </div>
  );
}

function ConfigScreen({ onSave }: { onSave: (c: { apiKey: string; playlistId: string }) => void }) {
  const [apiKey, setApiKey] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [err, setErr] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let pid = playlistId.trim();
    // accept full URL
    const m = pid.match(/[?&]list=([^&]+)/);
    if (m) pid = m[1];
    if (!apiKey.trim() || !pid) {
      setErr("Ambos campos son obligatorios.");
      return;
    }
    onSave({ apiKey: apiKey.trim(), playlistId: pid });
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 flex items-center justify-center px-4 font-sans">
      <form onSubmit={handleSubmit} className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-2xl p-8 space-y-6 shadow-2xl">
        <div className="text-center">
          <h1 className="text-2xl font-bold">YT-GUESS-LESS</h1>
          <p className="text-sm text-slate-400 mt-2">Configura tu fuente de música para empezar</p>
        </div>
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-slate-400">YouTube API Key</label>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            placeholder="AIza…"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-slate-400">Playlist ID o URL</label>
          <input
            value={playlistId}
            onChange={(e) => setPlaylistId(e.target.value)}
            placeholder="PLxxxxxxxx o URL completa"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500"
          />
        </div>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <button type="submit" className="w-full py-3 rounded-lg bg-green-600 hover:bg-green-500 font-semibold text-sm transition">
          Empezar a jugar
        </button>
        <p className="text-[11px] text-slate-500 text-center leading-relaxed">
          Tus credenciales se guardan solo en tu navegador (localStorage).
        </p>
      </form>
    </div>
  );
}

function Modal({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><XIcon size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatsModal({ onClose }: { onClose: () => void }) {
  const stats = useMemo(() => {
    try {
      const raw = localStorage.getItem(LS_STATS);
      if (raw) return JSON.parse(raw);
    } catch {}
    return { played: 0, wins: 0, dist: [0, 0, 0, 0, 0, 0], streak: 0, maxStreak: 0 };
  }, []);
  const maxDist = Math.max(1, ...stats.dist);
  return (
    <Modal title="Estadísticas" onClose={onClose}>
      <div className="grid grid-cols-4 gap-2 text-center mb-4">
        <Stat label="Jugadas" v={stats.played} />
        <Stat label="% Aciertos" v={stats.played ? Math.round((stats.wins / stats.played) * 100) : 0} />
        <Stat label="Racha" v={stats.streak} />
        <Stat label="Máx." v={stats.maxStreak} />
      </div>
      <div className="space-y-1">
        {stats.dist.map((c: number, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-4 text-slate-400">{i + 1}</span>
            <div className="flex-1 bg-slate-800 rounded">
              <div className="bg-green-600 rounded text-right px-2 py-0.5 text-white" style={{ width: `${(c / maxDist) * 100}%`, minWidth: c ? "20px" : "0" }}>
                {c || ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Stat({ label, v }: { label: string; v: number | string }) {
  return (
    <div>
      <div className="text-2xl font-bold">{v}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}
