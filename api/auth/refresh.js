import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { createDecipheriv } from 'crypto';
import { parse } from 'cookie';

// Decrypt refresh token using AES-256-GCM
function decryptToken(encryptedData) {
  const { ENCRYPTION_KEY } = process.env;
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.authTag, 'hex');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export default async function handler(req, res) {
  try {
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies.session;

    if (!sessionToken) {
      return res.status(401).json({ error: 'No session found' });
    }

    const { JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

    // Verify and decode JWT
    let sessionData;
    try {
      sessionData = jwt.verify(sessionToken, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Decrypt refresh token
    const refreshToken = decryptToken(sessionData.refreshToken);

    // Get new access token
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      return res.status(401).json({ error: 'Failed to refresh token' });
    }

    res.status(200).json({
      access_token: credentials.access_token,
      expires_in: credentials.expiry_date ? Math.floor((credentials.expiry_date - Date.now()) / 1000) : 3600
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
}
