import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { createCipheriv, randomBytes } from 'crypto';
import { parse } from 'cookie';

// Encrypt refresh token using AES-256-GCM
function encryptToken(token) {
  const { ENCRYPTION_KEY } = process.env;
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

export default async function handler(req, res) {
  try {
    const { code, state, error } = req.query;

    // Handle OAuth errors
    if (error) {
      return res.redirect(`/?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return res.redirect('/?error=invalid_request');
    }

    // Validate CSRF state
    const cookies = parse(req.headers.cookie || '');
    const storedState = cookies.oauth_state;

    if (!storedState || storedState !== state) {
      return res.redirect('/?error=invalid_state');
    }

    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, JWT_SECRET, ENCRYPTION_KEY } = process.env;

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI || !JWT_SECRET || !ENCRYPTION_KEY) {
      return res.redirect('/?error=server_config_error');
    }

    // Exchange authorization code for tokens
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      return res.redirect('/?error=token_exchange_failed');
    }

    // Get user info
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // Encrypt refresh token
    const encryptedRefreshToken = encryptToken(tokens.refresh_token);

    // Create JWT session token
    const sessionData = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      refreshToken: encryptedRefreshToken,
      exp: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour expiry
    };

    const sessionToken = jwt.sign(sessionData, JWT_SECRET);

    // Set session cookie
    res.setHeader('Set-Cookie', [
      `session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
      `oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` // Clear state cookie
    ]);

    // Redirect to portal
    res.redirect('/portal.html');
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect('/?error=authentication_failed');
  }
}
