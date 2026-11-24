// Гость на /t/<ссылка> не должен получать «План Б» и служебные отметки подтверждения, даже если они придут из базы.
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://sb'; process.env.SUPABASE_ANON_KEY = 'k';
const rpc = { guest: { firstName: 'Г' }, trip: { city: 'Берлин' }, days: [{ date: '2026-12-02', items: [{
  time: '20:00', title: 'Ужин', category: 'Dining', kind: 'request', venueName: 'Основное место',
  backup_venue: 'СЕКРЕТ-План-Б', backupVenue: 'СЕКРЕТ', backup_address: 'СЕКРЕТ', backup_contact: 'СЕКРЕТ', backup_notes: 'СЕКРЕТ', backupPlan: { v: 'СЕКРЕТ' },
  precheck24h_done: true, precheck3h_done: false, last_precheck_at: '2026-12-01T10:00:00Z', precheck: { done: true },
}] }], concierge: { whatsapp: '33600000000' } };
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes('open-meteo') ? {} : rpc) });
const h = (await import('../api/trip-portal.js')).default;
let body;
await h({ method: 'GET', query: { token: 'A'.repeat(24) } }, { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { body = b; } });
const s = JSON.stringify(body);
assert.ok(s.includes('Основное место'), 'основное бронирование гость видит');
assert.ok(!/backup|precheck|СЕКРЕТ|last_precheck/i.test(s), 'План Б и отметки подтверждения не должны попадать в ответ портала');
console.log('portal isolation ok');
