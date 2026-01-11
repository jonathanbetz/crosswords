import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Use scanIterator to find all puzzle:* keys
    const foundDates = [];

    for await (const key of kv.scanIterator({ match: 'puzzle:????-??-??' })) {
      if (/^puzzle:\d{4}-\d{2}-\d{2}$/.test(key)) {
        foundDates.push(key.replace('puzzle:', ''));
      }
    }

    // Add all found dates to the set
    if (foundDates.length > 0) {
      await kv.sadd('puzzle:dates', ...foundDates);
    }

    // Get current set size
    const setSize = await kv.scard('puzzle:dates');

    return res.status(200).json({
      success: true,
      foundDates: foundDates.length,
      setSize,
      dates: foundDates.sort().reverse()
    });
  } catch (error) {
    console.error('Error rebuilding dates:', error);
    return res.status(500).json({ error: 'Failed to rebuild dates', details: error.message });
  }
}
