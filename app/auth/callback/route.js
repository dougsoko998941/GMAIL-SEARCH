import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // The Google refresh token is ONLY returned here, during the server-side
      // code exchange. The client's session (read from cookies) omits it, so
      // this is the one reliable place to persist it. Storing it lets the app
      // silently mint fresh access tokens instead of forcing repeated logins.
      const session = data?.session
      const refreshToken = session?.provider_refresh_token
      if (refreshToken && session?.user?.id) {
        const { error: saveError } = await supabase.from('google_tokens').upsert(
          {
            user_id: session.user.id,
            refresh_token: refreshToken,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
        if (saveError) console.log('[v0] callback save token error:', saveError.message)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`)
}
