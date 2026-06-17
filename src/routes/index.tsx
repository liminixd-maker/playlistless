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
  ListMusic,
  Settings as SettingsIcon,
  Volume2,
  VolumeX,
  RotateCcw,
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

const STEPS_CLASSIC = [1, 2, 10, 19, 29, 60];
const STEPS_FX = [60, 60, 60];
const LS_KEY = "ytguessless.config";
const LS_STATS = "ytguessless.stats";
const LS_ROUND = "ytguessless.round";
const LS_SETTINGS = "ytguessless.settings";
const LS_MODE = "ytguessless.mode";

type Mode = "classic" | "fx";

type FxEffect = {
  id: string;
  name: string;
  rate: number; // YT supports 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2
  emoji: string;
};

const FX_EFFECTS: FxEffect[] = [
  { id: "nightcore", name: "Nightcore", rate: 1.5, emoji: "⚡" },
  { id: "speedup", name: "Speed Up", rate: 1.25, emoji: "🚀" },
  { id: "chipmunk", name: "Chipmunk", rate: 1.75, emoji: "🐿️" },
  { id: "slowed", name: "Slowed", rate: 0.75, emoji: "🌙" },
  { id: "screwed", name: "Chopped & Screwed", rate: 0.5, emoji: "🍫" },
  { id: "vaporwave", name: "Vaporwave", rate: 0.25, emoji: "🌴" },
];

type Settings = {
  volume: number;
  muted: boolean;
  bgColor: string;
  accentColor: string;
  hintEnabled: boolean;
  hintFirstLetter: boolean;
  hintSecondLetter: boolean;
  hintChannel: boolean;
  hintWordCount: boolean;
  hintTitleLength: boolean;
  hintAlbum: boolean;
  autoplayNext: boolean;
  reduceMotion: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  volume: 80,
  muted: false,
  bgColor: "#0f172a",
  accentColor: "#22c55e",
  hintEnabled: true,
  hintFirstLetter: true,
  hintSecondLetter: true,
  hintChannel: true,
  hintWordCount: true,
  hintTitleLength: true,
  hintAlbum: true,
  autoplayNext: false,
  reduceMotion: false,
};

const BG_PRESETS = [
  { name: "Slate", value: "#0f172a" },
  { name: "Negro", value: "#000000" },
  { name: "Zinc", value: "#18181b" },
  { name: "Indigo", value: "#1e1b4b" },
  { name: "Esmeralda", value: "#022c22" },
  { name: "Vino", value: "#2a0a14" },
];

const ACCENT_PRESETS = [
  "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#f59e0b", "#ef4444",
];

type Track = { id: string; title: string; channel?: string };
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
  const [revealStart, setRevealStart] = useState<number>(0);

  const [query, setQuery] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const [showHelp, setShowHelp] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showChangePlaylist, setShowChangePlaylist] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("classic");
  const [currentEffect, setCurrentEffect] = useState<FxEffect | null>(null);
  const [albumByTrack, setAlbumByTrack] = useState<Record<string, string | null>>({});

  const STEPS = mode === "fx" ? STEPS_FX : STEPS_CLASSIC;
  const MAX = STEPS[STEPS.length - 1];
  const maxAttempts = STEPS.length;

  const playerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const stopAtRef = useRef<number>(STEPS[0]);
  const startOffsetRef = useRef<number | null>(null);

  // Load config + settings
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        setConfig(JSON.parse(raw));
      } catch {}
    }
    const rawS = localStorage.getItem(LS_SETTINGS);
    if (rawS) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(rawS) });
      } catch {}
    }
    const rawM = localStorage.getItem(LS_MODE);
    if (rawM === "classic" || rawM === "fx") setMode(rawM);
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_MODE, mode);
  }, [mode]);

  // Best-effort album lookup via iTunes Search API (CORS-friendly, no key)
  useEffect(() => {
    if (!current) return;
    if (current.id in albumByTrack) return;
    let cancelled = false;
    (async () => {
      try {
        const cleanTitle = current.title
          .replace(/\(.*?\)|\[.*?\]/g, " ")
          .replace(/\b(official|video|audio|music|lyric|lyrics|hd|hq|mv|m\/v|visualizer|live|remaster(ed)?|4k)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        const term = encodeURIComponent(`${current.channel || ""} ${cleanTitle}`.trim());
        const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
        if (!r.ok) throw new Error("itunes");
        const data = await r.json();
        const album: string | null = data?.results?.[0]?.collectionName || null;
        if (!cancelled) setAlbumByTrack((m) => ({ ...m, [current.id]: album }));
      } catch {
        if (!cancelled) setAlbumByTrack((m) => ({ ...m, [current.id]: null }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current]);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    if (playerRef.current) {
      try {
        playerRef.current.setVolume(settings.muted ? 0 : settings.volume);
      } catch {}
    }
  }, [settings]);

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
              const channel = (it.snippet?.videoOwnerChannelTitle || it.snippet?.channelTitle || "").replace(/\s*-\s*Topic\s*$/i, "").trim();
              all.push({ id, title, channel });
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
    if (mode === "fx") {
      setCurrentEffect(FX_EFFECTS[Math.floor(Math.random() * FX_EFFECTS.length)]);
    } else {
      setCurrentEffect(null);
    }
  }

  // Re-pick when switching mode (so effect/limits apply cleanly)
  useEffect(() => {
    if (tracks.length) pickRandom(tracks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
            e.target.setVolume(settings.muted ? 0 : settings.volume);
            try {
              e.target.setPlaybackRate(currentEffect ? currentEffect.rate : 1);
            } catch {}
            if (settings.autoplayNext) {
              setTimeout(() => handlePlayPause(), 200);
            }
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
        playerRef.current.setPlaybackRate(currentEffect ? currentEffect.rate : 1);
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
    const offset = Math.max(0, Math.floor(startOffsetRef.current ?? 0));
    setRevealStart(offset);
    if (playerRef.current) {
      try {
        playerRef.current.pauseVideo();
        playerRef.current.destroy();
      } catch {}
      playerRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const triesUsed = finalAttempts.filter((a) => a.correct).length
      ? finalAttempts.findIndex((a) => a.correct) + 1
      : maxAttempts;
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
    } else if (next.length >= maxAttempts) {
      finish(false, next);
    }
  }

  function skip() {
    if (!current || finished) return;
    const next: Attempt[] = [...attempts, { type: "skip", correct: false }];
    setAttempts(next);
    setQuery("");
    if (next.length >= maxAttempts) finish(false, next);
  }

  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const q = normalize(query);
    const scored: { t: Track; score: number }[] = [];
    for (const t of tracks) {
      const n = normalize(t.title);
      let score = -1;
      if (n.startsWith(q)) score = 0;
      else {
        // word-start match
        const words = n.split(" ");
        if (words.some((w) => w.startsWith(q))) score = 1;
        else if (n.includes(q)) score = 2;
      }
      if (score >= 0) scored.push({ t, score });
    }
    scored.sort((a, b) => a.score - b.score || a.t.title.length - b.t.title.length);
    return scored.slice(0, 40).map((s) => s.t);
  }, [query, tracks]);

  function shareText() {
    const tag = mode === "fx" ? `FX${currentEffect ? " " + currentEffect.name : ""}` : "Classic";
    const sq = attempts
      .map((a) => (a.correct ? "🟩" : a.type === "skip" ? "⬛" : "🟥"))
      .concat(Array(Math.max(0, maxAttempts - attempts.length)).fill("⬜"))
      .join("");
    return `YT-Guessless · ${tag} ${finished === "win" ? attempts.length + "/" + maxAttempts : "X/" + maxAttempts}\n${sq}`;
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
    <div
      className="min-h-screen text-slate-100 flex flex-col font-sans"
      style={{ backgroundColor: settings.bgColor }}
    >
      {/* Hidden YT player */}
      <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
        <div id="yt-hidden-player" />
      </div>

      {/* Header */}
      <header className="relative px-4 py-4 border-b border-white/10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => setShowHelp(true)} className="p-2 text-slate-300 hover:text-white transition" aria-label="Ayuda">
              <HelpCircle size={22} />
            </button>
            <button onClick={() => setShowChangePlaylist(true)} className="p-2 text-slate-300 hover:text-white transition" aria-label="Cambiar playlist" title="Cambiar playlist">
              <ListMusic size={22} />
            </button>
            <button onClick={() => setShowSettings(true)} className="p-2 text-slate-300 hover:text-white transition" aria-label="Configuración" title="Configuración">
              <SettingsIcon size={22} />
            </button>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">YT-GUESS-LESS</h1>
          <button onClick={() => setShowStats(true)} className="p-2 text-slate-300 hover:text-white transition" aria-label="Estadísticas">
            <BarChart3 size={22} />
          </button>
        </div>
        <div className="max-w-2xl mx-auto mt-3 flex items-center justify-center gap-3">
          <label className="text-[10px] uppercase tracking-wider text-slate-400">Modo</label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:border-slate-500"
          >
            <option value="classic">Clásico · 6 intentos</option>
            <option value="fx">FX · 3 intentos · 60s con efecto</option>
          </select>
          {mode === "fx" && currentEffect && !finished && (
            <span
              className="px-2 py-1 rounded-md text-[11px] font-semibold border"
              style={{ borderColor: settings.accentColor, color: settings.accentColor }}
              title={`Velocidad x${currentEffect.rate}`}
            >
              {currentEffect.emoji} {currentEffect.name}
            </span>
          )}
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
          <div
            className="relative h-3 w-full bg-slate-800 rounded-full overflow-hidden cursor-pointer select-none"
            onPointerDown={(e) => {
              if (!playerRef.current || finished) return;
              const el = e.currentTarget;
              el.setPointerCapture(e.pointerId);
              const seek = (clientX: number) => {
                const rect = el.getBoundingClientRect();
                const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
                const target = Math.min(pct * MAX, currentLimit);
                const offset = startOffsetRef.current ?? 0;
                try {
                  playerRef.current.seekTo(offset + target, true);
                } catch {}
                setProgress(target);
              };
              seek(e.clientX);
              const move = (ev: PointerEvent) => seek(ev.clientX);
              const up = (ev: PointerEvent) => {
                seek(ev.clientX);
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", up);
                el.removeEventListener("pointercancel", up);
              };
              el.addEventListener("pointermove", move);
              el.addEventListener("pointerup", up);
              el.addEventListener("pointercancel", up);
            }}
          >
            {/* segment markers */}
            {STEPS.slice(0, -1).map((s, i) => (
              <div key={i} className="absolute top-0 bottom-0 w-px bg-slate-700 pointer-events-none" style={{ left: `${(s / MAX) * 100}%` }} />
            ))}
            <div
              className="absolute top-0 bottom-0 left-0 bg-white/10 pointer-events-none"
              style={{ width: `${(currentLimit / MAX) * 100}%` }}
            />
            <div
              className={`absolute top-0 bottom-0 left-0 pointer-events-none ${settings.reduceMotion ? "" : "transition-[width] duration-100"}`}
              style={{ width: `${Math.min((progress / MAX) * 100, 100)}%`, backgroundColor: settings.accentColor }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow pointer-events-none"
              style={{ left: `${Math.min((progress / MAX) * 100, 100)}%` }}
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
            {settings.hintEnabled && current && (() => {
              const letters = (current.title.match(/[\p{L}\p{N}]/gu) || []) as string[];
              const words = current.title.replace(/[\(\[\{].*?[\)\]\}]/g, " ").split(/\s+/).filter((w) => w.match(/[\p{L}\p{N}]/u));
              const isFx = mode === "fx";
              const hints: { when: number; label: string; value: string; enabled: boolean }[] = isFx
                ? [
                    { when: 1, label: "Empieza por", value: (letters[0] || "?").toUpperCase(), enabled: settings.hintFirstLetter },
                    { when: 2, label: "Artista / canal", value: current.channel || "—", enabled: settings.hintChannel },
                  ].filter((h) => h.enabled && attempts.length >= h.when)
                : [
                    { when: 3, label: "Empieza por", value: (letters[0] || "?").toUpperCase(), enabled: settings.hintFirstLetter },
                    { when: 4, label: "Segunda letra", value: (letters[1] || "?").toUpperCase(), enabled: settings.hintSecondLetter },
                    { when: 5, label: "Nº de palabras", value: String(words.length || 1), enabled: settings.hintWordCount },
                    { when: 5, label: "Artista / canal", value: current.channel || "—", enabled: settings.hintChannel },
                    { when: 5, label: "Longitud del título", value: `${letters.length} letras`, enabled: settings.hintTitleLength },
                  ].filter((h) => h.enabled && attempts.length >= h.when);
              if (!hints.length) return null;
              return (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-yellow-500/70 text-center">Pistas</div>
                  <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-300">
                    {hints.map((h, i) => (
                      <div key={i}>
                        {h.label}:{" "}
                        <span className="font-bold text-yellow-400 tracking-wider">{h.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
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
                {mode === "fx"
                  ? "SALTAR"
                  : `SALTAR (+${attemptIndex < maxAttempts - 1 ? STEPS[attemptIndex + 1] - STEPS[attemptIndex] : 0}s)`}
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
            <div className="relative w-full max-w-xl mx-auto aspect-video rounded-lg overflow-hidden shadow-xl bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${current.id}?autoplay=1&start=${revealStart}&rel=0&modestbranding=1`}
                title={current.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
            </div>
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

      {showChangePlaylist && config && (
        <ChangePlaylistModal
          current={config.playlistId}
          onClose={() => setShowChangePlaylist(false)}
          onSave={(pid) => {
            const next = { ...config, playlistId: pid };
            localStorage.setItem(LS_KEY, JSON.stringify(next));
            setConfig(next);
            setShowChangePlaylist(false);
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          onResetStats={() => {
            localStorage.removeItem(LS_STATS);
            setToast("Estadísticas reiniciadas");
            setTimeout(() => setToast(null), 1800);
          }}
          onResetConfig={() => {
            localStorage.removeItem(LS_KEY);
            setConfig(null);
          }}
        />
      )}
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

function ChangePlaylistModal({
  current,
  onClose,
  onSave,
}: {
  current: string;
  onClose: () => void;
  onSave: (pid: string) => void;
}) {
  const [value, setValue] = useState(current);
  const [err, setErr] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    let pid = value.trim();
    const m = pid.match(/[?&]list=([^&]+)/);
    if (m) pid = m[1];
    if (!pid) {
      setErr("Introduce un Playlist ID o URL.");
      return;
    }
    onSave(pid);
  }
  return (
    <Modal title="Cambiar playlist" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-slate-400">
          Se mantendrá tu API Key. Solo cambiará la playlist de origen.
        </p>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setErr("");
          }}
          placeholder="PLxxxxxxxx o URL completa"
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500"
        />
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-semibold"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-sm font-semibold"
          >
            Cargar playlist
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsModal({
  settings,
  onChange,
  onClose,
  onResetStats,
  onResetConfig,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  onResetStats: () => void;
  onResetConfig: () => void;
}) {
  function update<K extends keyof Settings>(k: K, v: Settings[K]) {
    onChange({ ...settings, [k]: v });
  }
  return (
    <Modal title="Configuración" onClose={onClose}>
      <div className="space-y-5 text-sm">
        {/* Volume */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wider text-slate-400">Volumen</label>
            <button
              onClick={() => update("muted", !settings.muted)}
              className="text-slate-300 hover:text-white"
              aria-label="Silenciar"
            >
              {settings.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={settings.muted ? 0 : settings.volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                onChange({ ...settings, volume: v, muted: v === 0 });
              }}
              className="flex-1 accent-green-500"
            />
            <span className="w-10 text-right tabular-nums text-slate-400">
              {settings.muted ? 0 : settings.volume}
            </span>
          </div>
        </div>

        {/* Background color */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-slate-400">Color de fondo</label>
          <div className="flex flex-wrap gap-2">
            {BG_PRESETS.map((c) => (
              <button
                key={c.value}
                onClick={() => update("bgColor", c.value)}
                className={`h-8 w-8 rounded-full border-2 transition ${
                  settings.bgColor === c.value ? "border-white scale-110" : "border-slate-700"
                }`}
                style={{ backgroundColor: c.value }}
                title={c.name}
                aria-label={c.name}
              />
            ))}
            <label className="h-8 w-8 rounded-full border-2 border-slate-700 overflow-hidden cursor-pointer relative">
              <input
                type="color"
                value={settings.bgColor}
                onChange={(e) => update("bgColor", e.target.value)}
                className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
              />
              <div className="w-full h-full bg-gradient-to-br from-pink-500 via-yellow-400 to-green-500" />
            </label>
          </div>
        </div>

        {/* Accent color */}
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wider text-slate-400">Color de acento</label>
          <div className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                onClick={() => update("accentColor", c)}
                className={`h-8 w-8 rounded-full border-2 transition ${
                  settings.accentColor === c ? "border-white scale-110" : "border-slate-700"
                }`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-3 pt-2 border-t border-slate-800">
          <Toggle
            label="Pistas activadas (master)"
            value={settings.hintEnabled}
            onChange={(v) => update("hintEnabled", v)}
          />
          <div className="pl-3 border-l border-slate-800 space-y-3">
            <Toggle
              label="1ª letra del título (3er fallo)"
              value={settings.hintFirstLetter}
              onChange={(v) => update("hintFirstLetter", v)}
            />
            <Toggle
              label="2ª letra del título (4º fallo)"
              value={settings.hintSecondLetter}
              onChange={(v) => update("hintSecondLetter", v)}
            />
            <Toggle
              label="Artista / canal (5º fallo)"
              value={settings.hintChannel}
              onChange={(v) => update("hintChannel", v)}
            />
            <Toggle
              label="Nº de palabras del título (5º fallo)"
              value={settings.hintWordCount}
              onChange={(v) => update("hintWordCount", v)}
            />
            <Toggle
              label="Longitud del título en letras (5º fallo)"
              value={settings.hintTitleLength}
              onChange={(v) => update("hintTitleLength", v)}
            />
          </div>
          <Toggle
            label="Auto-reproducir al cambiar de canción"
            value={settings.autoplayNext}
            onChange={(v) => update("autoplayNext", v)}
          />
          <Toggle
            label="Reducir animaciones"
            value={settings.reduceMotion}
            onChange={(v) => update("reduceMotion", v)}
          />
        </div>


        {/* Danger zone */}
        <div className="space-y-2 pt-3 border-t border-slate-800">
          <label className="text-xs uppercase tracking-wider text-slate-400">Reiniciar</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={onResetStats}
              className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} /> Estadísticas
            </button>
            <button
              onClick={onResetConfig}
              className="flex-1 py-2 rounded-lg bg-red-900/60 hover:bg-red-800 border border-red-800 text-xs font-semibold flex items-center justify-center gap-2"
            >
              <RotateCcw size={14} /> API Key + Playlist
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between gap-3 text-left"
    >
      <span className="text-sm text-slate-200">{label}</span>
      <span
        className={`relative inline-flex h-6 w-11 rounded-full transition ${
          value ? "bg-green-600" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
            value ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
