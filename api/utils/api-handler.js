export function apiHandler(methods) {
  return async (req, res) => {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    const handler = methods[req.method];
    if (!handler) {
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return handler(req, res);
  };
}
