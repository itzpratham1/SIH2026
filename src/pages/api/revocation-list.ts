import type { APIRoute } from 'astro';
import seedRevocations from '../../data/revocation-list.json';

export const GET: APIRoute = async () => {
  try {
    const backendRes = await fetch('http://127.0.0.1:8001/api/revocation-list', {
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

  return new Response(JSON.stringify(seedRevocations), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
