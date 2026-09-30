import type { APIRoute } from 'astro';
import seedInstruments from '../../data/seed-instruments.json';

export const GET: APIRoute = async ({ url }) => {
  try {
    const backendRes = await fetch(`http://127.0.0.1:8001/api/instruments${url.search}`, {
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

  let list = [...seedInstruments];
  const mandi = url.searchParams.get('mandi_cluster');
  const status = url.searchParams.get('status');
  const band = url.searchParams.get('band');
  const sortBy = url.searchParams.get('sort_by');

  if (mandi) {
    list = list.filter((i: any) =>
      i.mandi_cluster?.toLowerCase().includes(mandi.toLowerCase())
    );
  }
  if (status) {
    list = list.filter((i: any) => i.status === status);
  }
  if (band) {
    list = list.filter((i: any) => i.confidence?.band === band);
  }
  if (sortBy === 'confidence_asc') {
    list.sort((a: any, b: any) => (a.confidence?.score || 0) - (b.confidence?.score || 0));
  } else if (sortBy === 'confidence_desc') {
    list.sort((a: any, b: any) => (b.confidence?.score || 0) - (a.confidence?.score || 0));
  }

  return new Response(JSON.stringify(list), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
