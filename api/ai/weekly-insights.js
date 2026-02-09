import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Weekly insights request received');
    const { ANTHROPIC_API_KEY } = process.env;

    if (!ANTHROPIC_API_KEY) {
      console.error('No API key found');
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    console.log('Request body:', JSON.stringify(req.body).substring(0, 200));
    const { emails } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      console.error('Invalid emails data:', { emails: emails?.length });
      return res.status(400).json({ error: 'No emails provided' });
    }

    console.log(`Processing ${emails.length} emails`);

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });

    // Format emails for analysis (keep it concise for faster processing)
    const emailSummary = emails.map((email, idx) =>
      `${idx + 1}. From: ${email.from}\n   Subject: ${email.subject}\n   ${email.snippet.substring(0, 80)}...`
    ).join('\n\n');

    // Create prompt for Claude
    const prompt = `Analyze these ${emails.length} emails from the past week and provide strategic insights:

${emailSummary}

Please provide a comprehensive analysis with:

## 📊 Overview
- Total emails analyzed
- Key themes and patterns

## 🔥 High Priority Items
- What needs immediate attention (with specific email references)
- Urgent deadlines or requests

## 💡 Key Insights
- Notable trends or patterns
- Important conversations or threads
- People who need responses

## ✅ Recommended Next Actions
- Top 3-5 specific action items
- Prioritized by urgency and impact

## 📈 Communication Breakdown
- Who's contacting you most
- Topic distribution

Keep it concise, actionable, and specific. Reference email numbers when recommending actions.`;

    // Call Claude (use Haiku for faster response within timeout)
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Extract the response
    const insights = message.content[0].text;

    res.status(200).json({
      insights,
      emailCount: emails.length,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens
      }
    });

  } catch (error) {
    console.error('Weekly insights error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      error: 'Failed to generate insights',
      details: error.message,
      stack: error.stack
    });
  }
}
