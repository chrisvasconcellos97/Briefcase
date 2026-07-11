import { useEffect, useMemo, useRef, useState } from 'react'
import {
  STORAGE_KEY,
  TYPE_LABEL,
  fmtTime,
  fmtHM,
  fmtClock,
  feedText,
  deriveStatus,
  getWakings,
  wakingLine,
  getTally,
  buildExport,
} from './lib'

// ── persistence (synchronous, on every mutation) ────────────────────

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // keep only well-formed events, sorted chronologically for safety
    return parsed
      .filter((e) => e && typeof e.ts === 'number' && typeof e.type === 'string')
      .sort((a, b) => a.ts - b.ts)
  } catch {
    return []
  }
}

function saveEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch {
    /* storage full / private mode — nothing we can do, keep going in-memory */
  }
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// iOS-safe clipboard copy
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function App() {
  const [events, setEvents] = useState(loadEvents)
  const [now, setNow] = useState(() => Date.now())
  const [feedOpen, setFeedOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // single commit path — updates state AND persists synchronously
  function commit(next) {
    saveEvents(next)
    setEvents(next)
  }

  function addEvent(partial) {
    const e = { id: newId(), ts: Date.now(), ...partial }
    commit([...events, e])
    return e
  }

  function undo() {
    if (!events.length) return
    commit(events.slice(0, -1))
    flash('Removed last')
  }

  function flash(msg) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1600)
  }

  // live clock — 1s tick (only matters while awake, but cheap)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const status = useMemo(() => deriveStatus(events), [events])
  const tally = useMemo(() => getTally(events), [events])
  const wakings = useMemo(() => getWakings(events), [events])

  // map each wake event id → its waking summary (for grouping in the log)
  const wakeSummary = useMemo(() => {
    const m = new Map()
    for (const w of wakings) m.set(w.wakeId, w)
    return m
  }, [wakings])

  const isAwake = status.status === 'awake'

  // ── actions ───────────────────────────────────────────────────────

  function primaryAction() {
    if (isAwake) {
      addEvent({ type: 'asleep' })
      setFeedOpen(false)
    } else {
      addEvent({ type: 'wake' })
    }
  }

  function logFeed(source, oz) {
    if (source === 'breast') {
      addEvent({ type: 'feed', feedSource: 'breast' })
    } else {
      const plus = oz === 5 && source === 'bottle+' ? '5+' : undefined
      addEvent({ type: 'feed', feedSource: 'bottle', feedOz: oz, ...(plus ? { note: plus } : {}) })
    }
    setFeedOpen(false)
  }

  async function doCopy() {
    const text = buildExport(events, Date.now())
    const ok = await copyText(text)
    flash(ok ? 'Copied for Claude' : 'Copy failed')
    setMenuOpen(false)
  }

  function doNewNight() {
    commit([])
    setConfirmNew(false)
    setMenuOpen(false)
    setFeedOpen(false)
    flash('Fresh night')
  }

  // ── derived display bits ──────────────────────────────────────────

  const wakeElapsed = isAwake && status.wakeTs ? now - status.wakeTs : 0
  const lastAgo =
    tally.lastTs != null ? fmtHM(now - tally.lastTs) : null

  const reversed = useMemo(() => [...events].slice().reverse(), [events])

  const bedtimeLogged = status.bedtime != null
  const dayEnded = status.status === 'day'

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-4 pb-3 pt-2 text-slate">
      {/* Header */}
      <header className="flex items-center justify-between pb-2">
        <div className="leading-tight">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-dim">
            Nico Night Log
          </div>
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-panel-2 text-slate-dim active:scale-95"
        >
          <span className="text-xl leading-none">⋯</span>
        </button>
      </header>

      {/* HERO */}
      <Hero
        status={status.status}
        elapsed={wakeElapsed}
        asleepSince={status.asleepSince}
      />

      {/* Tally */}
      <Tally tally={tally} lastAgo={lastAgo} />

      {/* Running log */}
      <div className="no-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto">
        {reversed.length === 0 ? (
          <EmptyState bedtimeLogged={bedtimeLogged} />
        ) : (
          <ul className="space-y-1.5 pb-2">
            {reversed.map((e) => (
              <LogRow
                key={e.id}
                event={e}
                waking={e.type === 'wake' ? wakeSummary.get(e.id) : null}
                now={now}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Secondary grid */}
      <SecondaryGrid
        active={isAwake}
        onCheck={() => addEvent({ type: 'check' })}
        onRescue={() => addEvent({ type: 'rescue' })}
        onBinky={() => addEvent({ type: 'binky' })}
        onFed={() => setFeedOpen((v) => !v)}
        feedOpen={feedOpen}
      />

      {/* Feed row */}
      {feedOpen && <FeedRow onPick={logFeed} onCancel={() => setFeedOpen(false)} />}

      {/* Primary contextual button */}
      <button
        onClick={primaryAction}
        className={
          'mt-2 min-h-[76px] w-full rounded-2xl text-2xl font-bold tracking-wide transition-transform active:scale-95 ' +
          (isAwake
            ? 'bg-teal text-[#06120F] shadow-[0_0_0_1px_rgba(74,155,130,0.4)]'
            : 'bg-amber text-[#1a1206] shadow-[0_0_0_1px_rgba(232,168,56,0.35)]')
        }
      >
        {isAwake ? 'Back asleep' : 'Woke up'}
      </button>

      {/* Utility bar */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={undo}
          className="min-h-[52px] rounded-xl bg-panel-2 text-sm font-semibold text-slate-dim active:scale-95 disabled:opacity-30"
          disabled={events.length === 0}
        >
          ↺ Undo last
        </button>
        <button
          onClick={doCopy}
          className="min-h-[52px] rounded-xl bg-panel-2 text-sm font-semibold text-teal active:scale-95 disabled:opacity-30"
          disabled={events.length === 0}
        >
          ⧉ Copy for Claude
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center">
          <div className="rounded-full bg-panel px-4 py-2 text-sm text-slate shadow-lg ring-1 ring-white/5">
            {toast}
          </div>
        </div>
      )}

      {/* Menu sheet */}
      {menuOpen && (
        <MenuSheet
          onClose={() => setMenuOpen(false)}
          bedtimeLogged={bedtimeLogged}
          dayEnded={dayEnded}
          onBedtime={() => {
            addEvent({ type: 'bedtime' })
            setMenuOpen(false)
          }}
          onUpForDay={() => {
            addEvent({ type: 'wakeforday' })
            setFeedOpen(false)
            setMenuOpen(false)
          }}
          onCopy={doCopy}
          onNewNight={() => {
            setMenuOpen(false)
            setConfirmNew(true)
          }}
        />
      )}

      {/* New-night confirm */}
      {confirmNew && (
        <ConfirmNewNight
          hasEvents={events.length > 0}
          onExportFirst={async () => {
            await doCopy()
          }}
          onCancel={() => setConfirmNew(false)}
          onConfirm={doNewNight}
        />
      )}
    </div>
  )
}

// ── Hero ────────────────────────────────────────────────────────────

function Hero({ status, elapsed, asleepSince }) {
  if (status === 'awake') {
    return (
      <div className="rounded-2xl bg-[#231809] px-5 py-5 text-center ring-1 ring-amber/25">
        <div className="text-sm font-semibold uppercase tracking-[0.35em] text-amber/80">
          Awake
        </div>
        <div className="mt-1 font-bold tabular-nums text-amber" style={{ fontSize: '3.4rem', lineHeight: 1 }}>
          {fmtClock(elapsed)}
        </div>
        <div className="mt-1 text-xs text-amber/50">counting since woke up</div>
      </div>
    )
  }
  if (status === 'day') {
    return (
      <div className="rounded-2xl bg-panel-2 px-5 py-6 text-center ring-1 ring-white/5">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-dim">
          Up for the day
        </div>
        <div className="mt-1 text-xs text-slate-dim/70">tap ⋯ to start a new night</div>
      </div>
    )
  }
  // asleep or preBed — calm, dim
  return (
    <div className="rounded-2xl bg-panel-2 px-5 py-6 text-center ring-1 ring-teal/10">
      <div className="text-2xl font-semibold tracking-wide text-teal/70">
        {status === 'preBed' ? 'Not down yet' : 'Asleep'}
      </div>
      <div className="mt-1 text-sm text-slate-dim">
        {status === 'preBed'
          ? 'log Bedtime from ⋯'
          : asleepSince
            ? `since ${fmtTime(asleepSince)}`
            : ''}
      </div>
    </div>
  )
}

// ── Tally ───────────────────────────────────────────────────────────

function Tally({ tally, lastAgo }) {
  return (
    <div className="mt-2 flex items-center justify-between rounded-xl bg-panel-2/60 px-3 py-2 text-xs text-slate-dim">
      <Stat label="wakings" value={tally.wakings} />
      <Dot />
      <Stat label="feeds" value={tally.feeds} />
      <Dot />
      <Stat label="oz" value={tally.oz} />
      <Dot />
      <div className="text-right leading-tight">
        <div className="text-slate">{lastAgo ? `${lastAgo}` : '—'}</div>
        <div className="text-[10px] uppercase tracking-wider">last event</div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="leading-tight">
      <div className="text-base font-bold text-slate">{value}</div>
      <div className="text-[10px] uppercase tracking-wider">{label}</div>
    </div>
  )
}

function Dot() {
  return <div className="h-1 w-1 rounded-full bg-slate-dim/40" />
}

// ── Secondary grid ──────────────────────────────────────────────────

function SecondaryGrid({ active, onCheck, onRescue, onBinky, onFed, feedOpen }) {
  const base =
    'min-h-[64px] rounded-2xl text-base font-semibold transition-transform active:scale-95 ring-1'
  const on = 'bg-panel text-slate ring-white/10'
  const off = 'bg-panel-2/50 text-slate-dim/50 ring-white/5'
  const cls = active ? on : off
  return (
    <div className="grid grid-cols-2 gap-2">
      <button onClick={onCheck} className={`${base} ${cls}`}>
        Check
      </button>
      <button onClick={onRescue} className={`${base} ${cls}`}>
        Rescue
      </button>
      <button onClick={onBinky} className={`${base} ${cls}`}>
        Binky?
      </button>
      <button
        onClick={onFed}
        className={`${base} ${
          feedOpen ? 'bg-amber text-[#1a1206] ring-amber/40' : cls
        }`}
      >
        Fed
      </button>
    </div>
  )
}

// ── Feed row ────────────────────────────────────────────────────────

function FeedRow({ onPick, onCancel }) {
  const btn =
    'min-h-[60px] flex-1 rounded-xl bg-[#231809] text-amber ring-1 ring-amber/25 text-base font-semibold transition-transform active:scale-95'
  return (
    <div className="mt-2 rounded-2xl bg-panel-2 p-2 ring-1 ring-amber/20">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] uppercase tracking-widest text-amber/70">How much?</span>
        <button onClick={onCancel} className="px-2 text-xs text-slate-dim active:scale-95">
          cancel
        </button>
      </div>
      <div className="flex gap-1.5">
        <button className={btn} onClick={() => onPick('breast')}>
          Breast
        </button>
        {[1, 2, 3, 4].map((oz) => (
          <button key={oz} className={btn} onClick={() => onPick('bottle', oz)}>
            {oz}
          </button>
        ))}
        <button className={btn} onClick={() => onPick('bottle+', 5)}>
          5+
        </button>
      </div>
    </div>
  )
}

// ── Log row ─────────────────────────────────────────────────────────

const TYPE_ACCENT = {
  wake: 'text-amber',
  feed: 'text-amber',
  bedtime: 'text-teal',
  asleep: 'text-teal',
  wakeforday: 'text-teal',
  check: 'text-slate',
  rescue: 'text-slate',
  binky: 'text-slate',
}

function LogRow({ event, waking, now }) {
  const label = TYPE_LABEL[event.type] || event.type
  const detail = event.type === 'feed' ? feedText(event) : null
  const isWakeHead = event.type === 'wake'
  return (
    <li
      className={
        'rounded-xl bg-panel-2/60 px-3 py-2 ' +
        (isWakeHead ? 'ring-1 ring-amber/15' : '')
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="w-14 shrink-0 tabular-nums text-sm text-slate-dim">
          {fmtTime(event.ts)}
        </span>
        <span className={`text-sm font-semibold ${TYPE_ACCENT[event.type] || 'text-slate'}`}>
          {label}
        </span>
        {detail && <span className="text-sm text-slate-dim">— {detail}</span>}
      </div>
      {isWakeHead && waking && (
        <div className="mt-0.5 pl-16 text-[11px] text-slate-dim/70">
          {waking.asleepTs
            ? `↳ ${wakingLine(waking, now)}`
            : waking.ended
              ? '↳ up for day'
              : '↳ ongoing…'}
        </div>
      )}
    </li>
  )
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState({ bedtimeLogged }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-slate-dim">
      <div className="text-sm">No events yet.</div>
      <div className="mt-1 text-xs text-slate-dim/70">
        {bedtimeLogged ? 'Tap “Woke up” when he stirs.' : 'Open ⋯ → Bedtime to start the night.'}
      </div>
    </div>
  )
}

// ── Menu sheet ──────────────────────────────────────────────────────

function MenuSheet({ onClose, onBedtime, onUpForDay, onCopy, onNewNight, bedtimeLogged, dayEnded }) {
  const item =
    'min-h-[60px] w-full rounded-2xl px-4 text-left text-base font-semibold ring-1 ring-white/10 transition-transform active:scale-95'
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative mx-auto w-full max-w-md space-y-2 rounded-t-3xl bg-panel px-4 pb-6 pt-3"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-dim/40" />
        <button onClick={onBedtime} className={`${item} bg-panel-2 text-teal`}>
          🌙 Bedtime {bedtimeLogged && <span className="text-xs text-slate-dim">(already set)</span>}
        </button>
        <button onClick={onUpForDay} className={`${item} bg-panel-2 text-teal`}>
          ☀️ Up for day
        </button>
        <button onClick={onCopy} className={`${item} bg-panel-2 text-slate`}>
          ⧉ Copy for Claude
        </button>
        <button onClick={onNewNight} className={`${item} bg-panel-2 text-amber`}>
          ↺ New night
        </button>
        <button onClick={onClose} className={`${item} bg-transparent text-slate-dim`}>
          Close
        </button>
      </div>
    </div>
  )
}

// ── Confirm new night ───────────────────────────────────────────────

function ConfirmNewNight({ hasEvents, onExportFirst, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/70" onClick={onCancel} />
      <div className="relative w-full max-w-sm rounded-3xl bg-panel p-5 ring-1 ring-white/10">
        <div className="text-lg font-bold text-slate">Start a new night?</div>
        <div className="mt-1 text-sm text-slate-dim">
          This clears the current log. {hasEvents && 'Export first so you don’t lose it.'}
        </div>
        <div className="mt-4 space-y-2">
          {hasEvents && (
            <button
              onClick={onExportFirst}
              className="min-h-[56px] w-full rounded-2xl bg-panel-2 text-base font-semibold text-teal ring-1 ring-teal/25 active:scale-95"
            >
              ⧉ Copy export first
            </button>
          )}
          <button
            onClick={onConfirm}
            className="min-h-[56px] w-full rounded-2xl bg-amber text-base font-bold text-[#1a1206] active:scale-95"
          >
            Clear &amp; start fresh
          </button>
          <button
            onClick={onCancel}
            className="min-h-[56px] w-full rounded-2xl bg-transparent text-base font-semibold text-slate-dim active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
