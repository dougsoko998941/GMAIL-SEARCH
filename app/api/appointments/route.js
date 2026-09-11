import { createClient } from '@/lib/supabase/server'
import { generateObject } from 'ai'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MODEL = 'openai/gpt-4.1-mini'

function decodeBody(data = '') {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return ''
  }
}
function flattenParts(payload, out = []) {
  if (payload?.body?.data) out.push(decodeBody(payload.body.data))
  for (const p of payload?.parts || []) flattenParts(p, out)
  return out.join('\n')
}
function header(headers, name) {
  return (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

async function gmailFetch(path, token) {
  const res = await fetch(`${GMAIL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const err = new Error(`gmail_${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function today() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).toISOString().slice(0, 10)
}

const extractionSchema = z.object({
  appointments: z.array(
    z.object({
      index: z.number().int().describe('The index number of the source email'),
      title: z.string().describe('Short human-readable title of the appointment'),
      date: z.string().describe('Appointment date in YYYY-MM-DD format'),
      time: z.string().describe('Time of day like "2:30 PM", or empty string if none'),
      location: z.string().describe('Location or address, or empty string if none'),
      type: z.enum(['Medical', 'Dining', 'School', 'Sports', 'Service', 'Travel', 'Appointment']),
      confidence: z.number().int().min(0).max(100),
    }),
  ),
})

// Use an AI model to read candidate emails and extract real appointments,
// including ones written with relative or natural-language dates.
async function extractWithAI(candidates) {
  if (!candidates.length) return []

  const emailBlocks = candidates
    .map(
      (c) =>
        `--- EMAIL index=${c.index} ---\nFrom: ${c.sender}\nSubject: ${c.subject}\nBody:\n${c.body.slice(0, 1500)}`,
    )
    .join('\n\n')

  const { object } = await generateObject({
    model: MODEL,
    schema: extractionSchema,
    system:
      `You extract CONFIRMED, scheduled appointments and reservations that the recipient personally has. ` +
      `Today's date is ${today()}. Resolve relative dates ("tomorrow", "next Tuesday", "this Friday at 3pm") against today.\n\n` +
      `INCLUDE only emails that confirm a specific personal booking with a concrete calendar date, such as:\n` +
      `- Medical/dental/vet appointments (dentist, doctor, clinic) -> type "Medical"\n` +
      `- Restaurant reservations, including Resy and OpenTable confirmations -> type "Dining"\n` +
      `- Salon, repair, home service, or other service bookings -> type "Service"\n` +
      `- Flights, hotels, trains, car rentals -> type "Travel"\n` +
      `- School events, parent-teacher conferences -> type "School"\n` +
      `- Sporting events: games, matches, tournaments (football, soccer, basketball, baseball, etc.), tickets to a game -> type "Sports"\n\n` +
      `STRICTLY EXCLUDE (do not return these at all):\n` +
      `- Marketing, promotions, newsletters, sales, discounts, "book now" ads\n` +
      `- Restaurant/venue promotional emails that are NOT an actual confirmed reservation\n` +
      `- Order receipts, shipping/delivery notifications, payment receipts\n` +
      `- Password resets, security alerts, account notices, social notifications\n` +
      `- Generic "let's schedule a meeting" emails with no concrete confirmed date\n\n` +
      `For Resy/OpenTable: only include when it is an actual reservation CONFIRMATION for a specific date and party, not a "your table is waiting" or "discover restaurants" marketing blast.\n` +
      `Return the date as YYYY-MM-DD. If you cannot determine a concrete future date, omit that email entirely. ` +
      `Set confidence 0-100: use 80+ only for clear confirmations, and below 60 if you are unsure it is a genuine personal booking.`,
    prompt: `Extract appointments from these emails:\n\n${emailBlocks}`,
  })

  return object.appointments || []
}

// Returns a usable Gmail access token. Prefers the live session token (and
// persists any refresh token it carries), otherwise silently exchanges the
// stored refresh token for a new access token — so the user isn't forced to
// sign in again each time.
async function getValidAccessToken(supabase, userId, session) {
  if (session.provider_refresh_token) {
    await supabase.from('google_tokens').upsert(
      { user_id: userId, refresh_token: session.provider_refresh_token, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  }
  if (session.provider_token) return session.provider_token

  const { data: row } = await supabase
    .from('google_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .maybeSingle()
  if (!row?.refresh_token) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    console.log('[v0] refresh exchange failed:', res.status)
    return null
  }
  const json = await res.json()
  return json.access_token || null
}

export async function POST(request) {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return Response.json({ error: 'not_authenticated' }, { status: 401 })

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const refreshToken = body?.refresh_token
  if (!refreshToken) return Response.json({ ok: true })

  const { error } = await supabase.from('google_tokens').upsert(
    { user_id: session.user.id, refresh_token: refreshToken, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (error) {
    console.log('[v0] save token error:', error.message)
    return Response.json({ error: 'db_failed' }, { status: 500 })
  }
  return Response.json({ ok: true })
}

async function readStored(supabase, userId) {
  const { data, error } = await supabase
    .from('appointments')
    .select('gmail_id, title, appt_date, appt_time, location, sender, type, confidence')
    .eq('user_id', userId)
    .gte('appt_date', today())
    .order('appt_date', { ascending: true })
    .limit(60)
  if (error) throw error
  return (data || []).map((r) => ({
    id: r.gmail_id,
    title: r.title,
    date: r.appt_date,
    time: r.appt_time || '',
    location: r.location || '',
    sender: r.sender || '',
    type: r.type || 'Appointment',
    confidence: r.confidence || 85,
  }))
}

export async function DELETE(request) {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return Response.json({ error: 'not_authenticated' }, { status: 401 })

  const gmailId = new URL(request.url).searchParams.get('id')
  if (!gmailId) return Response.json({ error: 'missing_id' }, { status: 400 })

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('user_id', session.user.id)
    .eq('gmail_id', gmailId)
  if (error) {
    console.log('[v0] delete error:', error.message)
    return Response.json({ error: 'db_failed' }, { status: 500 })
  }
  return Response.json({ items: await readStored(supabase, session.user.id) })
}

export async function PATCH(request) {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return Response.json({ error: 'not_authenticated' }, { status: 401 })

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const { id, title, date, time, location, type } = body || {}
  if (!id) return Response.json({ error: 'missing_id' }, { status: 400 })
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'invalid_date' }, { status: 400 })
  }

  const patch = {}
  if (typeof title === 'string') patch.title = title.trim() || 'Untitled appointment'
  if (date) patch.appt_date = date
  if (time !== undefined) patch.appt_time = time || null
  if (location !== undefined) patch.location = location || null
  if (type !== undefined) patch.type = type || 'Appointment'
  if (!Object.keys(patch).length) {
    return Response.json({ error: 'nothing_to_update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('appointments')
    .update(patch)
    .eq('user_id', session.user.id)
    .eq('gmail_id', id)
  if (error) {
    console.log('[v0] update error:', error.message)
    return Response.json({ error: 'db_failed' }, { status: 500 })
  }
  return Response.json({ items: await readStored(supabase, session.user.id) })
}

export async function GET(request) {
  const supabase = await createClient()

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) {
    return Response.json({ error: 'not_authenticated' }, { status: 401 })
  }

  const userId = session.user.id
  const scan = new URL(request.url).searchParams.get('scan') === '1'

  // Default request just returns what's already stored — works after a reload
  // even when the short-lived Google access token is gone.
  if (!scan) {
    try {
      return Response.json({ items: await readStored(supabase, userId) })
    } catch (e) {
      console.log('[v0] read stored error:', e.message)
      return Response.json({ error: 'db_failed' }, { status: 500 })
    }
  }

  const token = await getValidAccessToken(supabase, userId, session)
  if (!token) {
    // No live token and no stored refresh token — the user must reconnect once
    // to grant a fresh refresh token.
    return Response.json({ error: 'no_gmail_token' }, { status: 403 })
  }

  // Broad search — the AI does the real filtering, so we only need a wide net.
  // Explicitly include restaurant-reservation senders (Resy, OpenTable) and
  // common appointment keywords so real bookings aren't excluded up front.
  const q =
    'newer_than:120d (' +
    'appointment OR confirmed OR confirmation OR reservation OR reserved OR scheduled OR ' +
    'booking OR booked OR "your table" OR dentist OR doctor OR clinic OR flight OR hotel OR ' +
    'check-in OR upcoming OR reminder OR ' +
    'from:resy.com OR from:opentable.com OR from:resy OR from:opentable' +
    ')'

  try {
    const list = await gmailFetch(`/messages?q=${encodeURIComponent(q)}&maxResults=60`, token)
    const ids = list.messages || []
    const candidates = []

    for (const [i, row] of ids.slice(0, 40).entries()) {
      const msg = await gmailFetch(`/messages/${row.id}?format=full`, token)
      const p = msg.payload || {}
      const subject = header(p.headers, 'Subject')
      const sender = header(p.headers, 'From')
      const body = [flattenParts(p), msg.snippet || '']
        .join('\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      candidates.push({ index: i, id: row.id, subject, sender, body })
    }

    const extracted = await extractWithAI(candidates)
    const cutoff = today()
    const items = []

    for (const a of extracted) {
      const src = candidates[a.index]
      if (!src) continue
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || a.date < cutoff) continue
      // Drop low-confidence guesses to keep marketing/ambiguous emails out.
      if ((a.confidence ?? 0) < 60) continue
      items.push({
        id: src.id,
        title: a.title || src.subject || 'Upcoming appointment',
        date: a.date,
        time: a.time || '',
        location: a.location || '',
        sender: src.sender,
        type: a.type || 'Appointment',
        confidence: a.confidence ?? 85,
      })
    }

    if (items.length) {
      const rows = items.map((it) => ({
        user_id: userId,
        gmail_id: it.id,
        title: it.title,
        appt_date: it.date,
        appt_time: it.time || null,
        location: it.location || null,
        sender: it.sender || null,
        type: it.type,
        confidence: it.confidence,
      }))
      const { error: upsertError } = await supabase
        .from('appointments')
        .upsert(rows, { onConflict: 'user_id,gmail_id' })
      if (upsertError) {
        console.log('[v0] upsert error:', upsertError.message)
        return Response.json({ error: 'db_failed' }, { status: 500 })
      }
    }

    console.log(
      `[v0] scan: ${candidates.length} emails read, ${extracted.length} extracted, ${items.length} kept`,
    )

    // Return the full stored set (newly scanned + previously saved), plus scan stats.
    return Response.json({
      items: await readStored(supabase, userId),
      scan: { scanned: candidates.length, found: items.length },
    })
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      return Response.json({ error: 'gmail_token_expired' }, { status: 403 })
    }
    console.log('[v0] appointments error:', e.message)
    return Response.json({ error: 'gmail_failed' }, { status: 500 })
  }
}
