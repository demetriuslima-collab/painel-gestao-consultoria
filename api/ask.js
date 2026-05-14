const ANTHROPIC_KEY = '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';

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
