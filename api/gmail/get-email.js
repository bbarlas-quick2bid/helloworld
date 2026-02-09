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

// Extract email body from MIME parts
function extractBody(payload) {
  let htmlBody = '';
  let textBody = '';

  function processPart(part) {
    if (part.mimeType === 'text/html' && part.body.data) {
      htmlBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/plain' && part.body.data) {
      textBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
    }

    if (part.parts) {
      part.parts.forEach(processPart);
    }
  }

  processPart(payload);

  return {
    html: htmlBody,
    text: textBody || htmlBody.replace(/<[^>]*>/g, '') // Fallback to stripped HTML
  };
}

export default async function handler(req, res) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Email ID required' });
    }

    // Authenticate user
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies.session;

    if (!sessionToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

    // Verify JWT
    let sessionData;
    try {
      sessionData = jwt.verify(sessionToken, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Decrypt refresh token
    const refreshToken = decryptToken(sessionData.refreshToken);

    // Setup OAuth client
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Refresh access token
    await oauth2Client.getAccessToken();

    // Initialize Gmail API
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Fetch full message
    const { data: message } = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'full'
    });

    const headers = message.payload.headers;
    const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

    const body = extractBody(message.payload);

    res.status(200).json({
      id: message.id,
      threadId: message.threadId,
      subject: getHeader('Subject'),
      from: getHeader('From'),
      to: getHeader('To'),
      date: getHeader('Date'),
      body: body.text,
      bodyHtml: body.html,
      snippet: message.snippet,
      labelIds: message.labelIds
    });
  } catch (error) {
    console.error('Get email error:', error);

    if (error.code === 401) {
      return res.status(401).json({ error: 'Authentication expired' });
    }

    res.status(500).json({ error: 'Failed to fetch email' });
  }
}
