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
const LS_PLAYED = "playlistless_played_songs";

type PlayedEntry = { id: string; title: string; channel?: string };

function usePlayedHistory() {
  const [played, setPlayed] = useState<Record<string, PlayedEntry>>({});
  // Load once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PLAYED);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Back-compat: array of ids
        const map: Record<string, PlayedEntry> = {};
        for (const v of parsed) {
          if (typeof v === "string") map[v] = { id: v, title: v };
          else if (v && typeof v.id === "string") map[v.id] = { id: v.id, title: v.title || v.id, channel: v.channel };
        }
        setPlayed(map);
      } else if (parsed && typeof parsed === "object") {
        setPlayed(parsed);
      }
    } catch {}
  }, []);
  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(LS_PLAYED, JSON.stringify(played));
    } catch {}
  }, [played]);

  const markPlayed = (entries: PlayedEntry | PlayedEntry[]) => {
    const list = Array.isArray(entries) ? entries : [entries];
    if (!list.length) return;
    setPlayed((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const e of list) {
        if (!e?.id) continue;
        if (!next[e.id]) {
          next[e.id] = { id: e.id, title: e.title || e.id, channel: e.channel };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };
  const unlock = (id: string) => {
    setPlayed((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const clearAll = () => setPlayed({});
  return { played, markPlayed, unlock, clearAll };
}

type Mode = "classic" | "fx" | "tournament";

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
  rangeStartPct: number;
  rangeEndPct: number;
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
  rangeStartPct: 0,
  rangeEndPct: 100,
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

type Track = {
  id: string;
  title: string;
  channel?: string;
  duration?: number; // seconds
  publishedAt?: string; // ISO date
  viewCount?: number;
};
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

function parseISODuration(s?: string): number {
  if (!s) return 0;
  const m = s.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

function HistoryPanel({
  open,
  onToggle,
  played,
  onUnlock,
  onClearAll,
  accentColor,
}: {
  open: boolean;
  onToggle: () => void;
  played: Record<string, PlayedEntry>;
  onUnlock: (id: string) => void;
  onClearAll: () => void;
  accentColor: string;
}) {
  const entries = Object.values(played).sort((a, b) => a.title.localeCompare(b.title));
  const count = entries.length;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-800/40 transition"
      >
        <span className="text-xs font-semibold tracking-wide text-slate-200">
          📋 Gestionar canciones jugadas
        </span>
        <span className="flex items-center gap-2">
          <span
            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border"
            style={{ borderColor: accentColor, color: accentColor }}
          >
            {count} excluida{count === 1 ? "" : "s"}
          </span>
          <span className="text-slate-400 text-xs">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-slate-800 space-y-3">
          <button
            onClick={onClearAll}
            disabled={count === 0}
            className="w-full px-3 py-2 rounded-lg text-xs font-semibold border border-slate-700 bg-slate-800/60 hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
          >
            🔄 Desbloquear todas las canciones
          </button>
          {count === 0 ? (
            <p className="text-[11px] text-slate-500 text-center py-2">
              Aún no hay canciones jugadas. Cuando empieces a jugar, aparecerán aquí.
            </p>
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/60 bg-slate-950/40">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 truncate">{e.title}</p>
                    {e.channel && (
                      <p className="text-[10px] text-slate-500 truncate">{e.channel}</p>
                    )}
                  </div>
                  <button
                    onClick={() => onUnlock(e.id)}
                    title="Devolver al bombo"
                    className="shrink-0 w-7 h-7 rounded-md border border-slate-700 bg-slate-800/60 hover:bg-green-600/30 hover:border-green-500/60 text-slate-200 text-sm font-bold flex items-center justify-center transition"
                  >
                    🔓
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
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
  const [showHistory, setShowHistory] = useState(false);
  const [noAvailableMsg, setNoAvailableMsg] = useState<string | null>(null);
  const { played, markPlayed, unlock, clearAll } = usePlayedHistory();

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
    if (rawM === "classic" || rawM === "fx" || rawM === "tournament") setMode(rawM);
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

        // Enrich with duration/publishedAt/viewCount in background
        (async () => {
          const enriched = [...all];
          for (let i = 0; i < enriched.length; i += 50) {
            if (cancelled) return;
            const chunk = enriched.slice(i, i + 50);
            try {
              const u = new URL("https://www.googleapis.com/youtube/v3/videos");
              u.searchParams.set("part", "contentDetails,statistics,snippet");
              u.searchParams.set("id", chunk.map((t) => t.id).join(","));
              u.searchParams.set("key", config.apiKey);
              const rv = await fetch(u.toString());
              if (!rv.ok) continue;
              const dv = await rv.json();
              const map = new Map<string, any>();
              for (const it of dv.items || []) map.set(it.id, it);
              for (let j = 0; j < chunk.length; j++) {
                const v = map.get(chunk[j].id);
                if (!v) continue;
                enriched[i + j] = {
                  ...chunk[j],
                  duration: parseISODuration(v.contentDetails?.duration),
                  publishedAt: v.snippet?.publishedAt,
                  viewCount: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
                };
              }
            } catch {}
          }
          if (!cancelled) setTracks([...enriched]);
        })();
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
    const available = list.filter((x) => !played[x.id]);
    if (!available.length) {
      setNoAvailableMsg(
        list.length === 0
          ? "No hay canciones cargadas."
          : "No quedan canciones sin jugar. Desbloquea algunas desde 📋 Gestionar canciones jugadas."
      );
      setCurrent(null);
      return;
    }
    setNoAvailableMsg(null);
    const t = available[Math.floor(Math.random() * available.length)];
    markPlayed({ id: t.id, title: t.title, channel: t.channel });
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
    if (mode === "tournament") return;
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
        const sPct = Math.max(0, Math.min(100, settings.rangeStartPct)) / 100;
        const ePct = Math.max(0, Math.min(100, settings.rangeEndPct)) / 100;
        const lo = Math.min(sPct, ePct);
        const hi = Math.max(sPct, ePct);
        if (dur > 0) {
          const windowStart = dur * lo;
          const windowEnd = dur * hi;
          const maxStart = Math.max(windowStart, windowEnd - currentLimit);
          startOffsetRef.current =
            windowStart + Math.random() * Math.max(0, maxStart - windowStart);
        } else {
          startOffsetRef.current = Math.random() * 60;
        }
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
            <option value="tournament">Torneo · Brackets</option>
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
        <div className="max-w-2xl mx-auto mt-3">
          <HistoryPanel
            open={showHistory}
            onToggle={() => setShowHistory((o) => !o)}
            played={played}
            onUnlock={unlock}
            onClearAll={() => {
              clearAll();
              setToast("Historial vaciado · todas las canciones desbloqueadas");
              setTimeout(() => setToast(null), 1800);
            }}
            accentColor={settings.accentColor}
          />
        </div>
      </header>

      {noAvailableMsg && mode !== "tournament" && (
        <div className="max-w-2xl mx-auto w-full px-4 pt-4">
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm px-4 py-3 flex items-center justify-between gap-3">
            <span>⚠️ {noAvailableMsg}</span>
            <button
              onClick={() => {
                clearAll();
                setNoAvailableMsg(null);
                if (tracks.length) pickRandom(tracks);
              }}
              className="text-xs px-2 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40"
            >
              Desbloquear todas
            </button>
          </div>
        </div>
      )}

      {mode === "tournament" ? (
        <TournamentMode
          tracks={tracks}
          loading={loadingTracks}
          accentColor={settings.accentColor}
          reduceMotion={settings.reduceMotion}
          volume={settings.muted ? 0 : settings.volume}
          played={played}
          markPlayed={markPlayed}
        />
      ) : (
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
                : (() => {
                    const album = albumByTrack[current.id];
                    return [
                      { when: 3, label: "Empieza por", value: (letters[0] || "?").toUpperCase(), enabled: settings.hintFirstLetter },
                      { when: 4, label: "Segunda letra", value: (letters[1] || "?").toUpperCase(), enabled: settings.hintSecondLetter },
                      { when: 5, label: "Nº de palabras", value: String(words.length || 1), enabled: settings.hintWordCount },
                      { when: 5, label: "Artista / canal", value: current.channel || "—", enabled: settings.hintChannel },
                      { when: 5, label: "Longitud del título", value: `${letters.length} letras`, enabled: settings.hintTitleLength },
                      { when: 5, label: "Álbum", value: album || "—", enabled: settings.hintAlbum && !!album },
                    ].filter((h) => h.enabled && attempts.length >= h.when);
                  })();
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
      )}

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
            <Toggle
              label="Álbum del tema (5º fallo)"
              value={settings.hintAlbum}
              onChange={(v) => update("hintAlbum", v)}
            />
        </div>

        {/* Tramo de la canción */}
        <div className="space-y-2 pt-3 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <label className="text-xs uppercase tracking-wider text-slate-400">
              Tramo aleatorio de la canción
            </label>
            <button
              onClick={() => {
                update("rangeStartPct", 0);
                update("rangeEndPct", 100);
              }}
              className="text-[10px] uppercase tracking-wider text-slate-400 hover:text-white"
            >
              Reset
            </button>
          </div>
          <p className="text-xs text-slate-400">
            El inicio del audio se elegirá al azar entre el{" "}
            <span className="text-white font-semibold">
              {Math.min(settings.rangeStartPct, settings.rangeEndPct)}%
            </span>{" "}
            y el{" "}
            <span className="text-white font-semibold">
              {Math.max(settings.rangeStartPct, settings.rangeEndPct)}%
            </span>{" "}
            del tema.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="text-xs text-slate-300 space-y-1">
              <span>Desde: {settings.rangeStartPct}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.rangeStartPct}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update("rangeStartPct", Math.min(v, settings.rangeEndPct));
                }}
                className="w-full accent-emerald-500"
              />
            </label>
            <label className="text-xs text-slate-300 space-y-1">
              <span>Hasta: {settings.rangeEndPct}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.rangeEndPct}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  update("rangeEndPct", Math.max(v, settings.rangeStartPct));
                }}
                className="w-full accent-emerald-500"
              />
            </label>
          </div>
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

// ============== TOURNAMENT MODE ==============

type TMatch = {
  id: string;
  round: number;
  slot: number; // index within round
  a: Track | null;
  b: Track | null;
  winner: Track | null;
  revealed: boolean;
};

function buildBracket(picked: Track[]): TMatch[] {
  const size = picked.length;
  const rounds = Math.log2(size);
  const matches: TMatch[] = [];
  // Round 0 (first round) with picked tracks
  for (let i = 0; i < size / 2; i++) {
    matches.push({
      id: `r0-${i}`,
      round: 0,
      slot: i,
      a: picked[i * 2],
      b: picked[i * 2 + 1],
      winner: null,
      revealed: false,
    });
  }
  // Empty subsequent rounds
  for (let r = 1; r < rounds; r++) {
    const count = size / Math.pow(2, r + 1);
    for (let i = 0; i < count; i++) {
      matches.push({
        id: `r${r}-${i}`,
        round: r,
        slot: i,
        a: null,
        b: null,
        winner: null,
        revealed: r === 0 ? false : true, // reveal all later rounds
      });
    }
  }
  return matches;
}

function TournamentMode({
  tracks,
  loading,
  accentColor,
  reduceMotion,
  volume,
}: {
  tracks: Track[];
  loading: boolean;
  accentColor: string;
  reduceMotion: boolean;
  volume: number;
}) {
  const [size, setSize] = useState<number | null>(null);
  const [matches, setMatches] = useState<TMatch[]>([]);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [champion, setChampion] = useState<Track | null>(null);

  const rounds = size ? Math.log2(size) : 0;
  const roundNames = useMemo(() => {
    if (!size) return [] as string[];
    const names: string[] = [];
    for (let r = 0; r < rounds; r++) {
      const left = size / Math.pow(2, r + 1);
      if (left === 1) names.push("Final");
      else if (left === 2) names.push("Semifinal");
      else if (left === 4) names.push("Cuartos");
      else if (left === 8) names.push("Octavos");
      else names.push(`Ronda ${r + 1}`);
    }
    return names;
  }, [size, rounds]);

  // ====== FILTERS STATE ======
  const KEYWORD_TAGS = useMemo(
    () => [
      { id: "live", label: "Live / En vivo", patterns: [/\blive\b/i, /\ben\s*vivo\b/i, /\bdirecto\b/i] },
      { id: "remix", label: "Remix", patterns: [/\bremix\b/i, /\bmix\b/i] },
      { id: "acoustic", label: "Acoustic / Acústico", patterns: [/\bacoustic\b/i, /\bac[uú]stic[oa]\b/i, /\bunplugged\b/i] },
      { id: "official", label: "Official Video", patterns: [/\bofficial\s+(music\s+)?video\b/i, /\bvideo\s+oficial\b/i] },
    ],
    []
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [excludedKeywords, setExcludedKeywords] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<"any" | "classics" | "recent">("any");
  const [popularity, setPopularity] = useState<"any" | "hits" | "hidden">("any");
  const [artistQuery, setArtistQuery] = useState("");

  // Duration bounds
  const maxDurationInPlaylist = useMemo(() => {
    let m = 0;
    for (const t of tracks) if (t.duration && t.duration > m) m = t.duration;
    return m || 600;
  }, [tracks]);
  const [minDur, setMinDur] = useState<number>(0);
  const [maxDur, setMaxDur] = useState<number>(0);
  useEffect(() => {
    // initialize/extend max when playlist enrich completes
    if (maxDurationInPlaylist > maxDur) setMaxDur(maxDurationInPlaylist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDurationInPlaylist]);

  const hasViewCounts = useMemo(
    () => tracks.some((t) => typeof t.viewCount === "number"),
    [tracks]
  );
  const hasDurations = useMemo(() => tracks.some((t) => !!t.duration), [tracks]);
  const hasDates = useMemo(() => tracks.some((t) => !!t.publishedAt), [tracks]);

  // ====== FILTERED POOL ======
  const filteredTracks = useMemo(() => {
    const now = Date.now();
    const YEAR = 365.25 * 24 * 3600 * 1000;
    const norm = (s: string) => normalize(s);
    const aq = norm(artistQuery.trim());
    return tracks.filter((t) => {
      // keyword exclusion
      for (const k of KEYWORD_TAGS) {
        if (excludedKeywords.has(k.id)) {
          if (k.patterns.some((p) => p.test(t.title))) return false;
        }
      }
      // duration
      if (hasDurations && t.duration) {
        if (t.duration < minDur || t.duration > maxDur) return false;
      }
      // date
      if (dateFilter !== "any" && t.publishedAt) {
        const age = now - new Date(t.publishedAt).getTime();
        if (dateFilter === "classics" && age < 10 * YEAR) return false;
        if (dateFilter === "recent" && age > 5 * YEAR) return false;
      }
      // artist
      if (aq) {
        const hay = `${t.channel || ""} ${t.title}`;
        if (!norm(hay).includes(aq)) return false;
      }
      return true;
    });
  }, [tracks, excludedKeywords, minDur, maxDur, dateFilter, artistQuery, KEYWORD_TAGS, hasDurations]);

  function toggleKeyword(id: string) {
    setExcludedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setExcludedKeywords(new Set());
    setDateFilter("any");
    setPopularity("any");
    setArtistQuery("");
    setMinDur(0);
    setMaxDur(maxDurationInPlaylist);
  }

  function start(n: number) {
    if (filteredTracks.length < n) return;
    let pool = [...filteredTracks];
    // Popularity bias: sort, then slice candidate window, then shuffle pick
    if (popularity !== "any" && hasViewCounts) {
      pool.sort((a, b) => {
        const av = a.viewCount ?? 0;
        const bv = b.viewCount ?? 0;
        return popularity === "hits" ? bv - av : av - bv;
      });
      // narrow to top n*2 for variety, then shuffle
      pool = pool.slice(0, Math.max(n, Math.min(pool.length, n * 2)));
    }
    // shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, n);
    setSize(n);
    setMatches(buildBracket(picked));
    setChampion(null);
    setActiveMatchId(null);
  }

  function reset() {
    setSize(null);
    setMatches([]);
    setChampion(null);
    setActiveMatchId(null);
  }

  function pickWinner(matchId: string, winner: Track) {
    setMatches((prev) => {
      const next = prev.map((m) => ({ ...m }));
      const m = next.find((x) => x.id === matchId);
      if (!m) return prev;
      m.winner = winner;
      if (m.round < rounds - 1) {
        const nextSlot = Math.floor(m.slot / 2);
        const parent = next.find((x) => x.round === m.round + 1 && x.slot === nextSlot);
        if (parent) {
          if (m.slot % 2 === 0) parent.a = winner;
          else parent.b = winner;
        }
      } else {
        setTimeout(() => setChampion(winner), 300);
      }
      return next;
    });
    setActiveMatchId(null);
  }

  function reveal(matchId: string) {
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, revealed: true } : m)));
  }

  // ===== SETUP SCREEN =====
  if (!size) {
    const totalFiltered = filteredTracks.length;
    const filtersActive =
      excludedKeywords.size > 0 ||
      dateFilter !== "any" ||
      popularity !== "any" ||
      artistQuery.trim() !== "" ||
      minDur > 0 ||
      (hasDurations && maxDur < maxDurationInPlaylist);

    return (
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-10 flex flex-col items-center gap-6">
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-black tracking-tight">🏆 Torneo de Canciones</h2>
          <p className="text-sm text-slate-400 max-w-md">
            Empareja canciones aleatorias en un bracket de eliminatorias. Escucha ambas,
            elige tu favorita, y avanza hasta coronar una ganadora.
          </p>
        </div>
        {loading && <p className="text-slate-400">Cargando playlist…</p>}
        {!loading && (
          <div className="w-full space-y-4">
            <p className="text-xs uppercase tracking-wider text-slate-400 text-center">
              Elige el tamaño del torneo
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[2, 4, 8, 16].map((n) => {
                const enough = totalFiltered >= n;
                return (
                  <button
                    key={n}
                    onClick={() => start(n)}
                    disabled={!enough}
                    className="aspect-square rounded-2xl border-2 border-slate-700 bg-slate-900/60 hover:bg-slate-800 hover:border-slate-500 transition flex flex-col items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <span className="text-4xl font-black">{n}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400">
                      canciones
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500 text-center">
              {filtersActive ? (
                <>
                  <span className="text-slate-300 font-semibold">{totalFiltered}</span> de{" "}
                  {tracks.length} canciones pasan los filtros
                </>
              ) : (
                <>Playlist actual: {tracks.length} canciones disponibles</>
              )}
            </p>

            {/* ===== Filtros avanzados ===== */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 overflow-hidden">
              <button
                onClick={() => setFiltersOpen((o) => !o)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800/40 transition"
              >
                <span className="text-sm font-bold flex items-center gap-2">
                  ⚙️ Filtros Avanzados de la Playlist
                  {filtersActive && (
                    <span
                      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold"
                      style={{ backgroundColor: accentColor, color: "#0a0a0a" }}
                    >
                      Activos
                    </span>
                  )}
                </span>
                <span className="text-slate-400 text-sm">{filtersOpen ? "▲" : "▼"}</span>
              </button>
              {filtersOpen && (
                <div className="px-4 pb-5 pt-2 space-y-5 border-t border-slate-800 animate-fade-in">
                  {/* A) Keywords */}
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                      Tipo de contenido
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Marca para <span className="text-slate-300">excluir</span> canciones cuyo
                      título contenga estos términos.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {KEYWORD_TAGS.map((k) => {
                        const excluded = excludedKeywords.has(k.id);
                        return (
                          <button
                            key={k.id}
                            onClick={() => toggleKeyword(k.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition ${
                              excluded
                                ? "bg-red-500/15 border-red-500/60 text-red-300 line-through"
                                : "border-slate-700 text-slate-300 hover:border-slate-500"
                            }`}
                          >
                            {excluded ? "✕ " : ""}
                            {k.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* B) Duration */}
                  {hasDurations && (
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                        Duración de la canción
                      </label>
                      <p className="text-[11px] text-slate-500">
                        Solo se incluyen canciones que duren entre{" "}
                        <span className="text-white font-semibold">{fmt(minDur)}</span> y{" "}
                        <span className="text-white font-semibold">{fmt(maxDur)}</span>.
                      </p>
                      <DurationRange
                        min={0}
                        max={maxDurationInPlaylist}
                        start={minDur}
                        end={maxDur}
                        accentColor={accentColor}
                        onChange={(s, e) => {
                          setMinDur(s);
                          setMaxDur(e);
                        }}
                      />
                    </div>
                  )}

                  {/* C) Date */}
                  {hasDates && (
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                        Antigüedad del vídeo
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { id: "any", label: "Cualquier fecha" },
                          { id: "classics", label: "Joyas clásicas" , sub: "+10 años"},
                          { id: "recent", label: "Últimos años", sub: "<5 años" },
                        ] as const).map((opt) => {
                          const active = dateFilter === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setDateFilter(opt.id as any)}
                              className={`rounded-xl px-2 py-2 text-xs border-2 transition flex flex-col items-center gap-0.5 ${
                                active
                                  ? "border-transparent"
                                  : "border-slate-700 text-slate-300 hover:border-slate-500"
                              }`}
                              style={
                                active
                                  ? { backgroundColor: accentColor, color: "#0a0a0a" }
                                  : undefined
                              }
                            >
                              <span className="font-semibold">{opt.label}</span>
                              {"sub" in opt && opt.sub && (
                                <span className="text-[10px] opacity-70">{opt.sub}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* D) Popularity */}
                  {hasViewCounts && (
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                        Rarezas / Joyas ocultas
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { id: "any", label: "Aleatorio" },
                          { id: "hits", label: "🔥 Modo Hits" },
                          { id: "hidden", label: "💎 Joyas Ocultas" },
                        ] as const).map((opt) => {
                          const active = popularity === opt.id;
                          return (
                            <button
                              key={opt.id}
                              onClick={() => setPopularity(opt.id as any)}
                              className={`rounded-xl px-2 py-2 text-xs font-semibold border-2 transition ${
                                active
                                  ? "border-transparent"
                                  : "border-slate-700 text-slate-300 hover:border-slate-500"
                              }`}
                              style={
                                active
                                  ? { backgroundColor: accentColor, color: "#0a0a0a" }
                                  : undefined
                              }
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* E) Artist */}
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                      Filtrar por artista
                    </label>
                    <input
                      value={artistQuery}
                      onChange={(e) => setArtistQuery(e.target.value)}
                      placeholder="Ej: Daft Punk"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500"
                    />
                    {artistQuery.trim() && (
                      <p className="text-[11px] text-slate-500">
                        Se incluirán solo canciones cuyo título o canal contenga "
                        <span className="text-slate-300">{artistQuery.trim()}</span>".
                      </p>
                    )}
                  </div>

                  {filtersActive && (
                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={resetFilters}
                        className="text-xs text-slate-400 hover:text-white underline"
                      >
                        Restablecer filtros
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {filtersActive && totalFiltered < 16 && (
              <p className="text-xs text-red-400 text-center font-semibold rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
                ⚠ Quedan {totalFiltered} canciones. Es posible que no haya suficientes para los
                torneos más grandes con estos filtros.
              </p>
            )}
          </div>
        )}
      </main>
    );
  }


  const activeMatch = matches.find((m) => m.id === activeMatchId) || null;

  return (
    <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold">🏆 Torneo · {size} canciones</h2>
        <button
          onClick={reset}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 font-semibold"
        >
          Nuevo torneo
        </button>
      </div>

      {/* Bracket Map */}
      <div className="overflow-x-auto pb-4">
        <div
          className="flex gap-6 sm:gap-10 min-w-max items-stretch"
          style={{ minHeight: `${size * 36}px` }}
        >
          {Array.from({ length: rounds }).map((_, r) => {
            const roundMatches = matches.filter((m) => m.round === r);
            return (
              <div key={r} className="flex flex-col flex-1 min-w-[180px]">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 text-center mb-3 font-semibold">
                  {roundNames[r]}
                </div>
                <div className="flex-1 flex flex-col justify-around gap-2">
                  {roundMatches.map((m) => {
                    const ready = m.a && m.b && !m.winner;
                    const done = !!m.winner;
                    return (
                      <BracketCell
                        key={m.id}
                        match={m}
                        ready={!!ready}
                        done={done}
                        accentColor={accentColor}
                        onOpen={() => ready && setActiveMatchId(m.id)}
                        onReveal={() => reveal(m.id)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* Champion column */}
          <div className="flex flex-col flex-1 min-w-[200px]">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 text-center mb-3 font-semibold">
              Ganador
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div
                className="w-full rounded-xl border-2 px-3 py-4 text-center"
                style={{
                  borderColor: champion ? accentColor : "rgb(51 65 85)",
                  boxShadow: champion ? `0 0 30px ${accentColor}40` : undefined,
                }}
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                  👑
                </div>
                <div className="text-sm font-bold truncate">
                  {champion ? champion.title : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Duel modal */}
      {activeMatch && (
        <DuelView
          match={activeMatch}
          accentColor={accentColor}
          volume={volume}
          onPick={(w) => pickWinner(activeMatch.id, w)}
          onClose={() => setActiveMatchId(null)}
        />
      )}

      {/* Champion celebration */}
      {champion && (
        <ChampionOverlay
          champion={champion}
          accentColor={accentColor}
          reduceMotion={reduceMotion}
          onReset={reset}
        />
      )}
    </main>
  );
}

function BracketCell({
  match,
  ready,
  done,
  accentColor,
  onOpen,
  onReveal,
}: {
  match: TMatch;
  ready: boolean;
  done: boolean;
  accentColor: string;
  onOpen: () => void;
  onReveal: () => void;
}) {
  const isFirstRound = match.round === 0;
  const showNames = match.revealed || !isFirstRound || done;

  function Row({ track, isWinner }: { track: Track | null; isWinner: boolean }) {
    const label = track ? (showNames ? track.title : "??? ???") : "—";
    return (
      <div
        className={`px-2 py-1.5 text-xs truncate ${
          isWinner ? "font-bold" : "text-slate-300"
        }`}
        style={isWinner ? { color: accentColor } : undefined}
      >
        {label}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border bg-slate-900/60 overflow-hidden transition ${
        ready
          ? "border-slate-600 hover:border-white cursor-pointer hover:bg-slate-800/80"
          : done
            ? "border-slate-800 opacity-70"
            : "border-slate-800"
      }`}
      onClick={() => ready && onOpen()}
      style={
        ready
          ? { boxShadow: `0 0 0 1px ${accentColor}30, 0 0 12px ${accentColor}20` }
          : undefined
      }
    >
      <Row track={match.a} isWinner={!!match.winner && match.winner.id === match.a?.id} />
      <div className="border-t border-slate-800" />
      <Row track={match.b} isWinner={!!match.winner && match.winner.id === match.b?.id} />
      {isFirstRound && !match.revealed && !done && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReveal();
          }}
          className="w-full text-[10px] uppercase tracking-wider py-1 bg-slate-800 hover:bg-slate-700 border-t border-slate-700 font-semibold"
        >
          Revelar
        </button>
      )}
      {ready && (match.revealed || !isFirstRound) && (
        <div
          className="text-center text-[10px] uppercase tracking-wider py-1 border-t border-slate-700 font-bold"
          style={{ color: accentColor }}
        >
          ▶ Enfrentar
        </div>
      )}
      {done && (
        <div className="text-center text-[10px] uppercase tracking-wider py-1 border-t border-slate-800 text-slate-500">
          Resuelto
        </div>
      )}
    </div>
  );
}

function DuelView({
  match,
  accentColor,
  volume,
  onPick,
  onClose,
}: {
  match: TMatch;
  accentColor: string;
  volume: number;
  onPick: (w: Track) => void;
  onClose: () => void;
}) {
  if (!match.a || !match.b) return null;
  const mute = volume === 0 ? 1 : 0;
  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm animate-fade-in flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button
          onClick={onClose}
          className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 font-semibold"
        >
          ← Volver al mapa
        </button>
        <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
          Duelo
        </div>
        <div className="w-[120px]" />
      </div>
      <div className="flex-1 flex flex-col md:flex-row items-stretch gap-4 p-4 md:p-8 overflow-auto">
        {[match.a, match.b].map((t, idx) => (
          <button
            key={t.id}
            onClick={() => onPick(t)}
            className="flex-1 group flex flex-col rounded-2xl border-2 border-slate-700 bg-slate-900/60 hover:bg-slate-800/80 transition overflow-hidden text-left"
            style={{ minHeight: 240 }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor = accentColor)
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.borderColor = "rgb(51 65 85)")
            }
          >
            <div className="relative w-full aspect-video bg-black">
              <iframe
                src={`https://www.youtube.com/embed/${t.id}?rel=0&modestbranding=1&mute=${mute}`}
                title={t.title}
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full border-0"
              />
            </div>
            <div className="p-4 flex flex-col gap-2 flex-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Opción {idx === 0 ? "A" : "B"}
              </span>
              <span className="text-lg font-bold leading-tight">{t.title}</span>
              {t.channel && (
                <span className="text-xs text-slate-400 truncate">{t.channel}</span>
              )}
              <div
                className="mt-auto self-start text-xs px-3 py-1.5 rounded-lg font-bold transition group-hover:scale-105"
                style={{
                  backgroundColor: accentColor,
                  color: "#0a0a0a",
                }}
              >
                Elegir ganadora →
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="text-center text-xs text-slate-500 pb-4">
        Escucha ambas y haz clic sobre la tarjeta de tu favorita.
      </div>
    </div>
  );
}

function ChampionOverlay({
  champion,
  accentColor,
  reduceMotion,
  onReset,
}: {
  champion: Track;
  accentColor: string;
  reduceMotion: boolean;
  onReset: () => void;
}) {
  const confetti = useMemo(() => {
    if (reduceMotion) return [];
    const colors = [accentColor, "#fde047", "#f472b6", "#60a5fa", "#34d399", "#f87171"];
    return Array.from({ length: 80 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 1.5,
      duration: 2 + Math.random() * 2.5,
      color: colors[i % colors.length],
      size: 6 + Math.random() * 8,
      rot: Math.random() * 360,
    }));
  }, [accentColor, reduceMotion]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center px-4 overflow-hidden">
      <style>{`
        @keyframes tourney-confetti-fall {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.8; }
        }
      `}</style>
      {confetti.map((c) => (
        <span
          key={c.id}
          className="absolute top-0 pointer-events-none rounded-sm"
          style={{
            left: `${c.left}%`,
            width: `${c.size}px`,
            height: `${c.size * 0.4}px`,
            background: c.color,
            transform: `rotate(${c.rot}deg)`,
            animation: `tourney-confetti-fall ${c.duration}s ${c.delay}s linear infinite`,
          }}
        />
      ))}
      <div className="relative text-center space-y-6 max-w-2xl animate-scale-in">
        <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
          🏆 Ganadora del torneo
        </div>
        <h2
          className="text-4xl sm:text-6xl font-black leading-tight"
          style={{ color: accentColor, textShadow: `0 0 40px ${accentColor}80` }}
        >
          {champion.title}
        </h2>
        {champion.channel && (
          <p className="text-sm text-slate-400">{champion.channel}</p>
        )}
        <div className="relative w-full max-w-md mx-auto aspect-video rounded-xl overflow-hidden shadow-2xl bg-black">
          <iframe
            src={`https://www.youtube.com/embed/${champion.id}?autoplay=1&rel=0&modestbranding=1`}
            title={champion.title}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full border-0"
          />
        </div>
        <button
          onClick={onReset}
          className="px-6 py-3 rounded-xl font-bold text-sm transition hover:scale-105"
          style={{ backgroundColor: accentColor, color: "#0a0a0a" }}
        >
          🎮 Nuevo torneo
        </button>
      </div>
    </div>
  );
}

function DurationRange({
  min,
  max,
  start,
  end,
  accentColor,
  onChange,
}: {
  min: number;
  max: number;
  start: number;
  end: number;
  accentColor: string;
  onChange: (start: number, end: number) => void;
}) {
  const span = Math.max(1, max - min);
  const leftPct = ((start - min) / span) * 100;
  const rightPct = ((end - min) / span) * 100;

  function parseMS(mins: string, secs: string): number {
    const m = Math.max(0, Math.floor(Number(mins) || 0));
    const s = Math.max(0, Math.min(59, Math.floor(Number(secs) || 0)));
    return m * 60 + s;
  }
  const sMin = Math.floor(start / 60);
  const sSec = start % 60;
  const eMin = Math.floor(end / 60);
  const eSec = end % 60;

  return (
    <div className="space-y-3">
      {/* dual slider */}
      <div className="relative h-8 flex items-center">
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-slate-800" />
        <div
          className="absolute h-1.5 rounded-full"
          style={{
            left: `${leftPct}%`,
            right: `${100 - rightPct}%`,
            backgroundColor: accentColor,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={start}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), end);
            onChange(v, end);
          }}
          className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={end}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), start);
            onChange(start, v);
          }}
          className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        />
      </div>
      {/* numeric inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Desde</span>
          <input
            type="number"
            min={0}
            value={sMin}
            onChange={(e) => onChange(Math.min(parseMS(e.target.value, String(sSec)), end), end)}
            className="w-10 bg-transparent text-sm text-right focus:outline-none tabular-nums"
          />
          <span className="text-slate-500">:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={sSec.toString().padStart(2, "0")}
            onChange={(e) => onChange(Math.min(parseMS(String(sMin), e.target.value), end), end)}
            className="w-10 bg-transparent text-sm focus:outline-none tabular-nums"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Hasta</span>
          <input
            type="number"
            min={0}
            value={eMin}
            onChange={(e) => onChange(start, Math.max(parseMS(e.target.value, String(eSec)), start))}
            className="w-10 bg-transparent text-sm text-right focus:outline-none tabular-nums"
          />
          <span className="text-slate-500">:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={eSec.toString().padStart(2, "0")}
            onChange={(e) => onChange(start, Math.max(parseMS(String(eMin), e.target.value), start))}
            className="w-10 bg-transparent text-sm focus:outline-none tabular-nums"
          />
        </div>
      </div>
    </div>
  );
}
