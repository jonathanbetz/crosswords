export function apiHandler(methods) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    const handler = methods[req.method];
    if (!handler) {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
      return await handler(req, res);
    } catch (error) {
      console.error('Unhandled error in API handler:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
