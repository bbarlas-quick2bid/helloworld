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

    // Get query parameters
    const { pageToken, maxResults = 20, labelIds = 'INBOX' } = req.query;

    // Fetch messages
    const listParams = {
      userId: 'me',
      maxResults: parseInt(maxResults, 10),
      labelIds: labelIds.split(',')
    };

    if (pageToken) {
      listParams.pageToken = pageToken;
    }

    const { data: messageList } = await gmail.users.messages.list(listParams);

    if (!messageList.messages || messageList.messages.length === 0) {
      return res.status(200).json({ messages: [], nextPageToken: null });
    }

    // Fetch message details for each email
    const messages = await Promise.all(
      messageList.messages.map(async (msg) => {
        const { data: message } = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date']
        });

        const headers = message.payload.headers;
        const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

        return {
          id: message.id,
          threadId: message.threadId,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: getHeader('Date'),
          snippet: message.snippet,
          labelIds: message.labelIds
        };
      })
    );

    res.status(200).json({
      messages,
      nextPageToken: messageList.nextPageToken || null
    });
  } catch (error) {
    console.error('List emails error:', error);

    if (error.code === 401) {
      return res.status(401).json({ error: 'Authentication expired' });
    }

    res.status(500).json({ error: 'Failed to fetch emails' });
  }
}
