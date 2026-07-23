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
  deriveCheckCycle,
  toTimeInputValue,
  applyTimeInputValue,
  CHECK_INTERVAL_MS,
} from './lib'
import {
  MoonIcon,
  BottleIcon,
  DropletIcon,
  ClockIcon,
  HeartIcon,
  SproutIcon,
  StarIcon,
  ChevronIcon,
} from './icons'

// ── persistence (synchronous, on every mutation) ────────────────────

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
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

// two soft ascending beeps — generated, no asset needed, works fully offline
function playChime(ctx) {
  if (!ctx) return
  const t0 = ctx.currentTime
  ;[0, 0.16].forEach((offset, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = i === 0 ? 880 : 1046.5
    gain.gain.setValueAtTime(0, t0 + offset)
    gain.gain.linearRampToValueAtTime(0.16, t0 + offset + 0.02)
    gain.gain.linearRampToValueAtTime(0, t0 + offset + 0.32)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0 + offset)
    osc.stop(t0 + offset + 0.34)
  })
}

export default function App() {
  const [events, setEvents] = useState(loadEvents)
  const [now, setNow] = useState(() => Date.now())
  const [feedOpen, setFeedOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmNew, setConfirmNew] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const audioCtxRef = useRef(null)
  const prevCycleRef = useRef(null)

  function commit(next) {
    saveEvents(next)
    setEvents(next)
  }

  function addEvent(partial) {
    const e = { id: newId(), ts: Date.now(), ...partial }
    commit([...events, e])
    return e
  }

  function editEvent(id, patch) {
    const next = events
      .map((e) => (e.id === id ? { ...e, ...patch } : e))
      .sort((a, b) => a.ts - b.ts)
    commit(next)
    flash('Saved')
  }

  function deleteEvent(id) {
    commit(events.filter((e) => e.id !== id))
    flash('Deleted')
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

  // live clock — 1s tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // unlock audio on first tap anywhere (iOS requires a user-gesture)
  useEffect(() => {
    function unlock() {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
        if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume().catch(() => {})
      } catch {
        /* Web Audio unsupported — chime just won't play */
      }
    }
    document.addEventListener('touchend', unlock, { once: true })
    document.addEventListener('click', unlock, { once: true })
    return () => {
      document.removeEventListener('touchend', unlock)
      document.removeEventListener('click', unlock)
    }
  }, [])

  const status = useMemo(() => deriveStatus(events), [events])
  const tally = useMemo(() => getTally(events), [events])
  const wakings = useMemo(() => getWakings(events), [events])
  const isAwake = status.status === 'awake'

  const checkCycle = useMemo(
    () => (isAwake && status.wakeTs ? deriveCheckCycle(status.wakeTs, now) : null),
    [isAwake, status.wakeTs, now],
  )

  // vibrate + chime exactly on check-cycle phase transitions (foreground only)
  useEffect(() => {
    if (!checkCycle) {
      prevCycleRef.current = null
      return
    }
    const prev = prevCycleRef.current
    if (prev && (prev.phase !== checkCycle.phase || prev.cycleNum !== checkCycle.cycleNum)) {
      if (navigator.vibrate) {
        navigator.vibrate(checkCycle.phase === 'soothe' ? [180, 90, 180] : 150)
      }
      playChime(audioCtxRef.current)
    }
    prevCycleRef.current = checkCycle
  }, [checkCycle])

  const wakeSummary = useMemo(() => {
    const m = new Map()
    for (const w of wakings) m.set(w.wakeId, w)
    return m
  }, [wakings])

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

  // ── derived display bits ────────────────────────────────────────

  const wakeElapsed = isAwake && status.wakeTs ? now - status.wakeTs : 0
  const lastAgo = tally.lastTs != null ? fmtHM(now - tally.lastTs) : null
  const reversed = useMemo(() => [...events].slice().reverse(), [events])
  const bedtimeLogged = status.bedtime != null
  const dayEnded = status.status === 'day'

  return (
    <div className="mx-auto flex h-full max-w-md flex-col px-4 pb-3 pt-2 text-slate">
      {/* Header */}
      <header className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber/10">
            <MoonIcon className="h-[18px] w-[18px] text-amber" />
          </div>
          <div className="leading-tight">
            <div className="font-serif text-[19px] text-cream">Nico</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber">
              Night Log
            </div>
          </div>
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Menu"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 text-slate-dim active:scale-95"
        >
          <span className="text-xl leading-none">⋯</span>
        </button>
      </header>

      {/* HERO */}
      <Hero
        status={status.status}
        elapsed={wakeElapsed}
        asleepSince={status.asleepSince}
        checkCycle={checkCycle}
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
                onEdit={() => setEditingEvent(e)}
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
        onFed={() => setFeedOpen((v) => !v)}
        feedOpen={feedOpen}
      />

      {/* Feed row */}
      {feedOpen && <FeedRow onPick={logFeed} onCancel={() => setFeedOpen(false)} />}

      {/* Primary contextual button */}
      <button
        onClick={primaryAction}
        className={
          'mt-2 min-h-[76px] w-full rounded-2xl font-serif text-2xl transition-transform active:scale-95 ' +
          (isAwake
            ? 'bg-gradient-to-br from-[#F0BE5E] to-[#DE9A34] text-[#241605] shadow-[0_0_0_1px_rgba(232,168,56,0.25)]'
            : 'bg-gradient-to-br from-[#F0BE5E] to-[#DE9A34] text-[#241605] shadow-[0_0_0_1px_rgba(232,168,56,0.25)]')
        }
      >
        {isAwake ? 'Back asleep' : 'Woke up'}
      </button>

      {/* Utility bar */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={undo}
          className="min-h-[52px] rounded-xl bg-white/5 text-sm font-semibold text-slate-dim active:scale-95 disabled:opacity-30"
          disabled={events.length === 0}
        >
          ↺ Undo last
        </button>
        <button
          onClick={doCopy}
          className="min-h-[52px] rounded-xl bg-white/5 text-sm font-semibold text-amber active:scale-95 disabled:opacity-30"
          disabled={events.length === 0}
        >
          ⧉ Copy for Claude
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center">
          <div className="rounded-full bg-panel px-4 py-2 text-sm text-slate shadow-lg ring-1 ring-white/10">
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

      {/* Edit / delete a log entry */}
      {editingEvent && (
        <EditSheet
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={(patch) => {
            editEvent(editingEvent.id, patch)
            setEditingEvent(null)
          }}
          onDelete={() => {
            deleteEvent(editingEvent.id)
            setEditingEvent(null)
          }}
        />
      )}
    </div>
  )
}

// ── Hero ────────────────────────────────────────────────────────────

function Hero({ status, elapsed, asleepSince, checkCycle }) {
  if (status === 'awake') {
    if (checkCycle && checkCycle.phase === 'soothe') {
      return (
        <div className="rounded-2xl bg-gradient-to-br from-[#2b1712] to-[#201014] px-5 py-6 text-center ring-1 ring-rose/35">
          <div className="flex items-center justify-center gap-1.5">
            <StarIcon className="h-3 w-3 text-rose" />
            <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-rose">
              Go soothe him
            </span>
          </div>
          <div className="mt-1 font-serif tabular-nums text-rose" style={{ fontSize: '3.2rem', lineHeight: 1 }}>
            {fmtClock(checkCycle.remainingMs)}
          </div>
          <div className="mt-1.5 text-xs text-rose/50">60-second soothe, then back to 10:00</div>
        </div>
      )
    }
    const remaining = checkCycle ? checkCycle.remainingMs : CHECK_INTERVAL_MS
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#131a2b] to-[#0f1420] px-5 py-6 text-center ring-1 ring-amber/15">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber/75">
          Next check in
        </div>
        <div className="mt-1 font-serif tabular-nums text-amber" style={{ fontSize: '3.2rem', lineHeight: 1 }}>
          {fmtClock(remaining)}
        </div>
        <div className="mt-1.5 text-xs text-slate-dim">
          Awake {fmtClock(elapsed)} total{checkCycle ? ` · check ${checkCycle.cycleNum}` : ''}
        </div>
      </div>
    )
  }
  if (status === 'day') {
    return (
      <div className="rounded-2xl bg-panel-2 px-5 py-6 text-center ring-1 ring-white/5">
        <div className="font-serif text-2xl text-cream/80">Up for the day</div>
        <div className="mt-1 text-xs text-slate-dim">tap ⋯ to start a new night</div>
      </div>
    )
  }
  // asleep or preBed — calm, dim
  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#131a2b] to-[#0f1420] px-5 py-6 text-center ring-1 ring-white/5">
      <div className="font-serif text-3xl text-cream">
        {status === 'preBed' ? 'Not down yet' : 'Asleep'}
      </div>
      <div className="mt-1.5 text-sm text-slate-dim">
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
    <div className="mt-2 flex items-center rounded-xl bg-white/[0.03] px-2 py-3">
      <Stat icon={<MoonIcon className="h-4 w-4 text-amber" />} label="wakings" value={tally.wakings} />
      <Div />
      <Stat icon={<BottleIcon className="h-4 w-4 text-amber" />} label="feeds" value={tally.feeds} />
      <Div />
      <Stat icon={<DropletIcon className="h-4 w-4 text-amber" />} label="oz" value={tally.oz} />
      <Div />
      <Stat
        icon={<ClockIcon className="h-4 w-4 text-amber" />}
        label="last"
        value={lastAgo ?? '—'}
      />
    </div>
  )
}

function Stat({ icon, label, value }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      {icon}
      <div className="font-serif text-lg text-cream">{value}</div>
      <div className="text-[9px] uppercase tracking-[0.14em] text-slate-dim">{label}</div>
    </div>
  )
}

function Div() {
  return <div className="h-8 w-px bg-white/[0.06]" />
}

// ── Secondary grid ──────────────────────────────────────────────────

function SecondaryGrid({ active, onCheck, onRescue, onFed, feedOpen }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <BTile
          icon={<HeartIcon className="h-[18px] w-[18px] text-rose" />}
          iconBg="bg-rose/10"
          title="Check"
          subtitle="Quick check-in"
          onClick={onCheck}
          active={active}
        />
        <BTile
          icon={<SproutIcon className="h-[18px] w-[18px] text-sage" />}
          iconBg="bg-sage/10"
          title="Rescue"
          subtitle="Time to help"
          onClick={onRescue}
          active={active}
        />
      </div>
      <BTile
        icon={<BottleIcon className="h-[18px] w-[18px] text-amber" />}
        iconBg="bg-amber/10"
        title="Fed"
        subtitle="Log a feed"
        onClick={onFed}
        active={active}
        full
        selected={feedOpen}
      />
    </div>
  )
}

function BTile({ icon, iconBg, title, subtitle, onClick, active, full, selected }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex min-h-[64px] items-center gap-3 rounded-2xl px-4 py-3 text-left ring-1 transition-transform active:scale-95 ' +
        (full ? 'w-full' : 'flex-1') +
        ' ' +
        (selected
          ? 'bg-amber/10 ring-amber/40'
          : active
            ? 'bg-white/[0.035] ring-white/10'
            : 'bg-white/[0.02] ring-white/5 opacity-60')
      }
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
        {icon}
      </div>
      <div className="leading-tight">
        <div className="font-serif text-[15px] text-slate">{title}</div>
        <div className="text-[10.5px] text-slate-dim">{subtitle}</div>
      </div>
    </button>
  )
}

// ── Feed row ────────────────────────────────────────────────────────

function FeedRow({ onPick, onCancel }) {
  const btn =
    'min-h-[60px] flex-1 rounded-xl bg-amber/10 text-amber ring-1 ring-amber/25 text-base font-semibold transition-transform active:scale-95'
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
  bedtime: 'text-cream',
  asleep: 'text-cream',
  wakeforday: 'text-cream',
  check: 'text-slate',
  rescue: 'text-slate',
}

function LogRow({ event, waking, now, onEdit }) {
  const label = TYPE_LABEL[event.type] || event.type
  const detail = event.type === 'feed' ? feedText(event) : null
  const isWakeHead = event.type === 'wake'
  return (
    <li>
      <button
        onClick={onEdit}
        className={
          'w-full rounded-xl bg-white/[0.03] px-3 py-2.5 text-left transition-transform active:scale-[0.98] ' +
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
          <ChevronIcon className="ml-auto h-4 w-4 shrink-0 text-slate-dim/40" />
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
      </button>
    </li>
  )
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState({ bedtimeLogged }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-slate-dim">
      <MoonIcon className="h-7 w-7 text-slate-dim/40" />
      <div className="mt-3 text-sm">No events yet.</div>
      <div className="mt-1 text-xs text-slate-dim/70">
        {bedtimeLogged ? 'Tap “Woke up” when he stirs.' : 'Open ⋯ → Bedtime to start the night.'}
      </div>
    </div>
  )
}

// ── Menu sheet ──────────────────────────────────────────────────────

function MenuSheet({ onClose, onBedtime, onUpForDay, onCopy, onNewNight, bedtimeLogged, dayEnded }) {
  const item =
    'min-h-[60px] w-full rounded-2xl px-4 text-left font-serif text-base ring-1 ring-white/10 transition-transform active:scale-95'
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative mx-auto w-full max-w-md space-y-2 rounded-t-3xl bg-panel px-4 pb-6 pt-3"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-dim/40" />
        <button onClick={onBedtime} className={`${item} bg-white/[0.03] text-cream`}>
          🌙 Bedtime {bedtimeLogged && <span className="font-sans text-xs text-slate-dim">(already set)</span>}
        </button>
        <button onClick={onUpForDay} className={`${item} bg-white/[0.03] text-cream`}>
          ☀️ Up for day
        </button>
        <button onClick={onCopy} className={`${item} bg-white/[0.03] text-slate`}>
          ⧉ Copy for Claude
        </button>
        <button onClick={onNewNight} className={`${item} bg-white/[0.03] text-amber`}>
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
        <div className="font-serif text-lg text-cream">Start a new night?</div>
        <div className="mt-1 text-sm text-slate-dim">
          This clears the current log. {hasEvents && 'Export first so you don’t lose it.'}
        </div>
        <div className="mt-4 space-y-2">
          {hasEvents && (
            <button
              onClick={onExportFirst}
              className="min-h-[56px] w-full rounded-2xl bg-white/[0.03] text-base font-semibold text-amber ring-1 ring-amber/25 active:scale-95"
            >
              ⧉ Copy export first
            </button>
          )}
          <button
            onClick={onConfirm}
            className="min-h-[56px] w-full rounded-2xl bg-gradient-to-br from-[#F0BE5E] to-[#DE9A34] font-serif text-base text-[#241605] active:scale-95"
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

// ── Edit / delete a log entry ───────────────────────────────────────

const FEED_CHOICES = [
  { key: 'breast', label: 'Breast' },
  { key: 1, label: '1oz' },
  { key: 2, label: '2oz' },
  { key: 3, label: '3oz' },
  { key: 4, label: '4oz' },
  { key: 5, label: '5oz+' },
]

function EditSheet({ event, onSave, onDelete, onClose }) {
  const [time, setTime] = useState(() => toTimeInputValue(event.ts))
  const [feedChoice, setFeedChoice] = useState(() =>
    event.feedSource === 'breast' ? 'breast' : event.feedOz || 2,
  )
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isFeed = event.type === 'feed'

  function handleSave() {
    const ts = applyTimeInputValue(event.ts, time)
    const patch = { ts }
    if (isFeed) {
      if (feedChoice === 'breast') {
        patch.feedSource = 'breast'
        patch.feedOz = undefined
        patch.note = undefined
      } else {
        patch.feedSource = 'bottle'
        patch.feedOz = feedChoice
        patch.note = feedChoice === 5 ? '5+' : undefined
      }
    }
    onSave(patch)
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative mx-auto w-full max-w-md rounded-t-3xl bg-panel px-5 pt-3"
        onClick={(e) => e.stopPropagation()}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-dim/40" />

        {confirmDelete ? (
          <>
            <div className="font-serif text-lg text-cream">Delete this event?</div>
            <div className="mt-1 text-sm text-slate-dim">
              {fmtTime(event.ts)} — {TYPE_LABEL[event.type] || event.type}. This can't be undone.
            </div>
            <div className="mt-5 space-y-2">
              <button
                onClick={onDelete}
                className="min-h-[56px] w-full rounded-2xl bg-rose/15 font-serif text-base text-rose ring-1 ring-rose/30 active:scale-95"
              >
                Delete entry
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="min-h-[56px] w-full rounded-2xl bg-transparent text-base font-semibold text-slate-dim active:scale-95"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber">
              {TYPE_LABEL[event.type] || event.type}
            </div>
            <div className="mt-0.5 font-serif text-xl text-cream">Edit event</div>

            <div className="mt-5">
              <div className="mb-1.5 text-[10.5px] uppercase tracking-wider text-slate-dim">
                Time
              </div>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-2xl bg-white/[0.04] px-4 py-3 font-serif text-xl text-cream ring-1 ring-white/10 [color-scheme:dark]"
              />
            </div>

            {isFeed && (
              <div className="mt-4">
                <div className="mb-1.5 text-[10.5px] uppercase tracking-wider text-slate-dim">
                  Amount
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {FEED_CHOICES.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setFeedChoice(c.key)}
                      className={
                        'min-h-[52px] rounded-xl text-sm font-semibold ring-1 transition-transform active:scale-95 ' +
                        (feedChoice === c.key
                          ? 'bg-amber/15 text-amber ring-amber/40'
                          : 'bg-white/[0.03] text-slate-dim ring-white/10')
                      }
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 space-y-2">
              <button
                onClick={handleSave}
                className="min-h-[56px] w-full rounded-2xl bg-gradient-to-br from-[#F0BE5E] to-[#DE9A34] font-serif text-base text-[#241605] active:scale-95"
              >
                Save
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="min-h-[44px] w-full text-sm font-semibold text-rose active:scale-95"
              >
                Delete entry
              </button>
              <button
                onClick={onClose}
                className="min-h-[44px] w-full text-sm font-semibold text-slate-dim active:scale-95"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
