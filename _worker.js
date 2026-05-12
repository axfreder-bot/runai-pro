// Cloudflare Pages Function — handles all /api/strava/* routes
// The Pages project is at runai-pro.pages.dev
// This single file handles OAuth callback, token refresh, and activity proxy
// STRAVA_CLIENT_SECRET set in Pages → Settings → Functions → Environment Variables

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname.replace('/api/strava/', '') || '';
  const clientId = context.env.STRAVA_CLIENT_ID || '204938';
  const clientSecret = context.env.STRAVA_CLIENT_SECRET || '';

  function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  // GET /api/strava/callback — OAuth code exchange
  if (pathname === 'callback' && context.request.method === 'GET') {
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');

    if (err || !code) {
      return Response.redirect(
        `https://runai-pro.pages.dev/#strava-error=${encodeURIComponent(err || 'access_denied')}`,
        302
      );
    }

    let tokenData = {};
    try {
      const resp = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
          grant_type: 'authorization_code'
        })
      });
      tokenData = await resp.json();
    } catch (e) {
      return Response.redirect(
        'https://runai-pro.pages.dev/#strava-error=token_exchange_failed',
        302
      );
    }

    if (!tokenData.access_token) {
      const errMsg = tokenData.error || 'no_token';
      return Response.redirect(
        `https://runai-pro.pages.dev/#strava-error=${encodeURIComponent(errMsg)}`,
        302
      );
    }

    // Encode tokens in fragment, redirect to app with #strava=...
    const payload = {
      at: tokenData.access_token,
      rt: tokenData.refresh_token,
      ex: tokenData.expires_at,
      aid: tokenData.athlete ? tokenData.athlete.id : null,
      an: tokenData.athlete ? tokenData.athlete.firstname : null
    };
    const fragment = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    return Response.redirect(
      `https://runai-pro.pages.dev/#strava=${fragment}`,
      302
    );
  }

  // POST /api/strava/refresh — exchange refresh token for new access token
  if (pathname === 'refresh' && context.request.method === 'POST') {
    let body = {};
    try { body = await context.request.json(); } catch (e) {}

    if (!body.refresh_token) {
      return json({ error: 'missing_refresh_token' }, 400);
    }

    try {
      const resp = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: body.refresh_token
        })
      });
      const data = await resp.json();
      if (!data.access_token) {
        return json({ error: data.error || 'refresh_failed' }, 502);
      }
      return json({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at
      });
    } catch (e) {
      return json({ error: 'strava_unreachable' }, 502);
    }
  }

  // POST /api/strava/activity — fetch activities from Strava API
  if (pathname === 'activity' && context.request.method === 'POST') {
    let body = {};
    try { body = await context.request.json(); } catch (e) {}

    const { access_token, after = 0, per_page = 30 } = body;
    if (!access_token) return json({ error: 'missing_token' }, 400);

    const params = new URLSearchParams({ per_page: String(per_page) });
    if (after) params.set('after', String(after));

    try {
      const resp = await fetch(
        `https://api.strava.com/api/v3/athlete/activities?${params}`,
        { headers: { 'Authorization': `Bearer ${access_token}` } }
      );
      const status = resp.status;
      const data = await resp.json().catch(() => []);
      return json(data, status);
    } catch (e) {
      return json({ error: 'strava_api_error' }, 502);
    }
  }

  return json({ error: 'not_found' }, 404);
}