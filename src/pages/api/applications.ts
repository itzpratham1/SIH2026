import type { APIRoute } from 'astro';
import seedApplications from '../../data/seed-applications.json';

export const GET: APIRoute = async () => {
  try {
    const backendRes = await fetch('http://127.0.0.1:8001/api/applications', {
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

  return new Response(JSON.stringify(seedApplications), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const POST: APIRoute = async ({ request }) => {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const backendRes = await fetch('http://127.0.0.1:8001/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    if (backendRes.ok) {
      const data = await backendRes.json();
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {}

  const newApp = {
    application_id: `APP-2026-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    trader_id: body.trader_id || 'TRADER-DEMO',
    trader_name: body.trader_name || 'Demo Trader',
    instrument_id: body.instrument_id,
    applied_at: new Date().toISOString(),
    status: 'PENDING_ALLOCATION',
    supporting_documents: body.supporting_documents || [],
  };

  return new Response(JSON.stringify(newApp), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
