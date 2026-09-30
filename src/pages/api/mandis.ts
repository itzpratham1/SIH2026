import type { APIRoute } from 'astro';
import seedMandis from '../../data/seed-mandis.json';
import seedInstruments from '../../data/seed-instruments.json';

export const GET: APIRoute = async () => {
  try {
    const backendRes = await fetch('http://127.0.0.1:8001/api/mandis', {
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

  const results = seedMandis.map((m: any) => {
    const inMandi = seedInstruments.filter(
      (i: any) =>
        i.mandi_cluster?.toLowerCase().includes(m.mandi_name.toLowerCase()) ||
        m.mandi_name.toLowerCase().includes((i.mandi_cluster || '').toLowerCase())
    );
    const total = inMandi.length;
    const compliant = inMandi.filter((i: any) => i.status === 'COMPLIANT').length;
    const pct = total > 0 ? Math.round((compliant / total) * 1000) / 10 : 100;
    const risk = pct >= 80 ? 'LOW' : pct >= 60 ? 'MEDIUM' : 'HIGH';

    return {
      mandi_id: m.mandi_id,
      mandi_name: m.mandi_name,
      location: m.location,
      total_instruments: total,
      compliant_count: compliant,
      trust_index_pct: pct,
      risk_level: risk,
    };
  });

  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
