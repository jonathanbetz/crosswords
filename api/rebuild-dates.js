import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Scan for all puzzle:YYYY-MM-DD keys
    const pattern = 'puzzle:????-??-??';
    let cursor = 0;
    const foundDates = [];

    do {
      const [nextCursor, keys] = await kv.scan(cursor, { match: pattern, count: 100 });
      cursor = nextCursor;

      for (const key of keys) {
        const date = key.replace('puzzle:', '');
        foundDates.push(date);
      }
    } while (cursor !== 0);

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
