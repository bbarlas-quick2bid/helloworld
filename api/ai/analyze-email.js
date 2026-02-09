import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { ANTHROPIC_API_KEY } = process.env;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    const { email } = req.body;

    if (!email || !email.subject || !email.from) {
      return res.status(400).json({ error: 'Invalid email data' });
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });

    // Create prompt for Claude
    const prompt = `Analyze this email and provide actionable recommendations:

Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Body: ${email.body || email.snippet}

Please provide:
1. A brief summary (1-2 sentences)
2. Priority level (High/Medium/Low)
3. Recommended action items
4. Suggested response tone (if reply needed)

Keep your response concise and actionable.`;

    // Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Extract the response
    const analysis = message.content[0].text;

    res.status(200).json({
      analysis,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens
      }
    });

  } catch (error) {
    console.error('AI analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze email',
      details: error.message
    });
  }
}
