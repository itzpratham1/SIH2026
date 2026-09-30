import type { APIRoute } from 'astro';
import publicKeyMeta from '../../data/public-key.json';

export const GET: APIRoute = async () => {
  try {
    const backendRes = await fetch('http://127.0.0.1:8001/api/public-key', {
      signal: AbortSignal.timeout(600),
    });
    if (backendRes.ok) {
      const data = await backendRes.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {}

  return new Response(JSON.stringify(publicKeyMeta), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
