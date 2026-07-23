// ── Nico Night Log — pure logic helpers ─────────────────────────────

export const STORAGE_KEY = 'nico-night-log'
export const HISTORY_KEY = 'nico-night-log-history'

export const TYPE_LABEL = {
  bedtime: 'Bedtime',
  wake: 'Woke up',
  check: 'Check',
  rescue: 'Rescue',
  feed: 'Fed',
  asleep: 'Back asleep',
  wakeforday: 'Up for day',
}

// ── check-in timer (graduated check-ins while awake) ─────────────────

export const CHECK_INTERVAL_MS = 10 * 60 * 1000
export const SOOTHE_MS = 60 * 1000

// Derived purely from the wake timestamp + wall-clock now, so it's always
// correct even after the tab was frozen/backgrounded — nothing to resume.
export function deriveCheckCycle(wakeTs, now) {
  const cycle = CHECK_INTERVAL_MS + SOOTHE_MS
  const elapsed = Math.max(0, now - wakeTs)
  const inCycle = elapsed % cycle
  const cycleNum = Math.floor(elapsed / cycle) + 1
  if (inCycle < CHECK_INTERVAL_MS) {
    return { phase: 'waiting', remainingMs: CHECK_INTERVAL_MS - inCycle, cycleNum }
  }
  return { phase: 'soothe', remainingMs: cycle - inCycle, cycleNum }
}

// ── time / duration formatting ──────────────────────────────────────

// "HH:MM" (24h, for <input type="time">) from an epoch ms timestamp
export function toTimeInputValue(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Apply an "HH:MM" wall-clock value near ts, picking whichever of
// {same day, day before, day after} lands closest to ts — so backlogging
// a bedtime from "3am" back to "11pm" correctly lands on the prior night
// instead of 20 hours in the future.
export function applyTimeInputValue(ts, hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const base = new Date(ts)
  base.setHours(h, m, 0, 0)
  const candidates = [-1, 0, 1].map((dayOffset) => {
    const d = new Date(base)
    d.setDate(d.getDate() + dayOffset)
    return d.getTime()
  })
  return candidates.reduce((best, c) => (Math.abs(c - ts) < Math.abs(best - ts) ? c : best))
}

// 2:14a  /  11:05p
export function fmtTime(ts) {
  const d = new Date(ts)
  let h = d.getHours()
  const m = d.getMinutes()
  const ap = h < 12 ? 'a' : 'p'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${String(m).padStart(2, '0')}${ap}`
}

// 12m  /  1h 26m
export function fmtHM(ms) {
  const min = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// mm:ss counting-up timer
export function fmtClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── feed detail text ────────────────────────────────────────────────

export function feedText(e) {
  if (e.feedSource === 'breast') return 'breast'
  if (e.feedSource === 'bottle') {
    const plus = e.note === '5+' ? '+' : ''
    return `bottle ${e.feedOz}oz${plus}`
  }
  return 'fed'
}

// ── derive current status from chronological events ─────────────────

export function deriveStatus(events) {
  let status = 'preBed' // preBed | asleep | awake | day
  let wakeTs = null
  let wakeSource = null // 'bedtime' (still settling in) | 'wake' (overnight waking)
  let asleepSince = null
  let bedtime = null
  let upForDay = null
  for (const e of events) {
    switch (e.type) {
      case 'bedtime':
        // Laid down awake — sleep hasn't started yet. Reuses the same
        // "awake" state/timer as an overnight waking until "asleep" is tapped.
        status = 'awake'
        bedtime = e.ts
        wakeTs = e.ts
        wakeSource = 'bedtime'
        asleepSince = null
        break
      case 'wake':
        status = 'awake'
        wakeTs = e.ts
        wakeSource = 'wake'
        asleepSince = null
        break
      case 'asleep':
        status = 'asleep'
        wakeTs = null
        wakeSource = null
        asleepSince = e.ts
        break
      case 'wakeforday':
        status = 'day'
        wakeTs = null
        wakeSource = null
        asleepSince = null
        upForDay = e.ts
        break
      default:
        break
    }
  }
  return { status, wakeTs, wakeSource, asleepSince, bedtime, upForDay }
}

// ── time to fall asleep at bedtime (distinct from an overnight waking) ─

export function getSleepOnset(events) {
  const bedtimeEvt = events.find((e) => e.type === 'bedtime')
  if (!bedtimeEvt) return null
  const asleepEvt = events.find((e) => e.type === 'asleep' && e.ts >= bedtimeEvt.ts)
  return { bedtimeTs: bedtimeEvt.ts, asleepTs: asleepEvt ? asleepEvt.ts : null }
}

// "9:40p→9:58p (18m)" or "9:40p→ongoing (12m so far)"
export function onsetLine(onset, now) {
  const start = fmtTime(onset.bedtimeTs)
  if (onset.asleepTs) {
    return `${start}→${fmtTime(onset.asleepTs)} (${fmtHM(onset.asleepTs - onset.bedtimeTs)})`
  }
  return `${start}→ongoing (${fmtHM(now - onset.bedtimeTs)} so far)`
}

// ── pair wakes with the next asleep → wakings ───────────────────────

export function getWakings(events) {
  const wakings = []
  let cur = null
  for (const e of events) {
    if (e.type === 'wake') {
      if (cur) wakings.push(cur)
      cur = { wakeId: e.id, wakeTs: e.ts, asleepTs: null, ended: false, feeds: [], members: [] }
    } else if (cur) {
      if (e.type === 'asleep') {
        cur.asleepTs = e.ts
        cur.ended = true
        wakings.push(cur)
        cur = null
      } else if (e.type === 'wakeforday') {
        cur.ended = true // ended the night without resettling
        wakings.push(cur)
        cur = null
      } else if (e.type === 'feed') {
        cur.feeds.push(e)
        cur.members.push(e)
      } else if (e.type === 'check' || e.type === 'rescue') {
        cur.members.push(e)
      }
    }
  }
  if (cur) wakings.push(cur) // still open — baby currently awake
  return wakings
}

// summary tag for a waking, e.g. "FEED bottle 3oz" or "resettle"
export function wakingTag(w) {
  if (w.feeds.length > 0) {
    return 'FEED ' + w.feeds.map(feedText).join(' + ')
  }
  return 'resettle'
}

// one line like "2:15a→2:41a (26m, FEED bottle 3oz)"
export function wakingLine(w, now) {
  const start = fmtTime(w.wakeTs)
  if (w.asleepTs) {
    const dur = fmtHM(w.asleepTs - w.wakeTs)
    return `${start}→${fmtTime(w.asleepTs)} (${dur}, ${wakingTag(w)})`
  }
  if (w.ended) {
    return `${start}→up for day (${wakingTag(w)})`
  }
  const dur = fmtHM(now - w.wakeTs)
  return `${start}→ongoing (${dur}, ${wakingTag(w)})`
}

// ── longest stretch asleep ──────────────────────────────────────────

export function longestGap(events, now) {
  let best = null
  let sleepStart = null
  const consider = (from, to) => {
    const span = to - from
    if (!best || span > best.span) best = { span, from, to }
  }
  for (const e of events) {
    if (e.type === 'asleep') {
      sleepStart = e.ts
    } else if (e.type === 'wake' || e.type === 'wakeforday') {
      if (sleepStart != null) {
        consider(sleepStart, e.ts)
        sleepStart = null
      }
    }
  }
  if (sleepStart != null) consider(sleepStart, now) // still asleep now
  return best
}

// ── live tally ──────────────────────────────────────────────────────

export function getTally(events) {
  let wakings = 0
  let feeds = 0
  let oz = 0
  for (const e of events) {
    if (e.type === 'wake') wakings++
    if (e.type === 'feed') {
      feeds++
      if (e.feedSource === 'bottle' && typeof e.feedOz === 'number') oz += e.feedOz
    }
  }
  const last = events.length ? events[events.length - 1].ts : null
  return { wakings, feeds, oz, lastTs: last }
}

// ── export text ─────────────────────────────────────────────────────

export function buildExport(events, now) {
  const { bedtime, upForDay } = deriveStatus(events)
  const wakings = getWakings(events)
  const feedEvents = events.filter((e) => e.type === 'feed')
  const bottleFeeds = feedEvents.filter((e) => e.feedSource === 'bottle')
  const breastFeeds = feedEvents.filter((e) => e.feedSource === 'breast')
  const totalOz = bottleFeeds.reduce((a, e) => a + (e.feedOz || 0), 0)

  const feedWakings = wakings.filter((w) => w.feeds.length > 0).length
  const resettleWakings = wakings.length - feedWakings

  const dateRef = bedtime || (events[0] && events[0].ts) || now
  const gap = longestGap(events, now)
  const onset = getSleepOnset(events)

  const L = []
  L.push(`NICO NIGHT LOG — ${fmtDate(dateRef)}`)
  L.push(
    `Bedtime: ${bedtime ? fmtTime(bedtime) : '—'} | Up for day: ${
      upForDay ? fmtTime(upForDay) : 'still going'
    }`,
  )
  if (bedtime && upForDay) {
    L.push(`Night length: ${fmtHM(upForDay - bedtime)}`)
  }
  L.push('')
  L.push('SUMMARY')
  if (onset) {
    L.push(`- Time to fall asleep: ${onsetLine(onset, now)}`)
  }
  L.push(`- Wakings: ${wakings.length}  (Feeds: ${feedWakings}, Resettles: ${resettleWakings})`)
  L.push(
    `- Total milk: ${totalOz} oz across ${bottleFeeds.length} bottle feed${
      bottleFeeds.length === 1 ? '' : 's'
    } + ${breastFeeds.length} breast feed${breastFeeds.length === 1 ? '' : 's'}`,
  )
  if (wakings.length) {
    L.push('- Resettle times:')
    for (const w of wakings) L.push(`    ${wakingLine(w, now)}`)
  } else {
    L.push('- Resettle times: none')
  }
  if (gap) {
    L.push(
      `- Longest gap asleep: ${fmtHM(gap.span)} between ${fmtTime(gap.from)} and ${fmtTime(gap.to)}`,
    )
  } else {
    L.push('- Longest gap asleep: —')
  }
  L.push('')
  L.push('CHRONOLOGICAL')
  for (const e of events) {
    const label = TYPE_LABEL[e.type] || e.type
    const detail = e.type === 'feed' ? ` — ${feedText(e)}` : ''
    L.push(`${fmtTime(e.ts)} — ${label}${detail}`)
  }

  return L.join('\n')
}

// ── night review (past-night summaries + timeline) ────────────────────

// One-line stats for a night-review list card.
export function getNightSummary(events, now) {
  const status = deriveStatus(events)
  const tally = getTally(events)
  const dateRef = status.bedtime || (events[0] && events[0].ts) || now
  const totalSleepMs = status.bedtime && status.upForDay ? status.upForDay - status.bedtime : null
  return {
    dateRef,
    bedtime: status.bedtime,
    upForDay: status.upForDay,
    totalSleepMs,
    wakings: tally.wakings,
    feeds: tally.feeds,
    oz: tally.oz,
  }
}

// Alternating asleep/awake spans across [rangeStart, rangeEnd], for drawing
// the timeline bar. 'bedtime'/'wake' start an awake span, 'asleep' starts
// an asleep span — matches deriveStatus's status machine.
export function buildTimelineSegments(events, rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) return []
  const segs = []
  let curKind = 'awake'
  let curFrom = rangeStart
  for (const e of events) {
    if (e.ts <= rangeStart || e.ts >= rangeEnd) continue
    let nextKind = null
    if (e.type === 'asleep') nextKind = 'asleep'
    else if (e.type === 'wake' || e.type === 'bedtime') nextKind = 'awake'
    if (nextKind && nextKind !== curKind) {
      segs.push({ fromTs: curFrom, toTs: e.ts, kind: curKind })
      curFrom = e.ts
      curKind = nextKind
    }
  }
  segs.push({ fromTs: curFrom, toTs: rangeEnd, kind: curKind })
  return segs
}

// Hour gridlines between rangeStart and rangeEnd, e.g. { ts, label: "9p" }.
export function buildHourMarks(rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd || rangeEnd <= rangeStart) return []
  const marks = []
  const first = new Date(rangeStart)
  first.setMinutes(0, 0, 0)
  if (first.getTime() <= rangeStart) first.setHours(first.getHours() + 1)
  for (let t = first.getTime(); t < rangeEnd; t += 3600000) {
    marks.push({ ts: t, label: fmtTime(t).replace(':00', '') })
  }
  return marks
}
