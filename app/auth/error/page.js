export default function AuthErrorPage() {
  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: 24, textAlign: 'center' }}>
      <h1>Sign-in failed</h1>
      <p className="muted">We couldn&apos;t complete the Google sign-in. Please try connecting again.</p>
      <a className="primary" href="/">Back to app</a>
    </main>
  )
}
