// Proveedores de mensajería simulados (staging local): reemplazan a WhatsApp Cloud API (Meta) y al
// agregador SMS, para que la API corra con su configuración de producción sin enviar mensajes reales.
// - POST /v21.0/:phoneNumberId/messages  (formato de WhatsApp Cloud API)
// - POST /sms                            ({ to, message })
// - GET  /__inbox?to=+51900000001        último mensaje recibido por ese número
// - POST /__whatsapp/down | /__whatsapp/up  simula una caída de WhatsApp (respaldo SMS)
import http from 'node:http';

const PORT = Number(process.env.MOCK_MESSAGING_PORT ?? 4010);
const inbox = new Map();
let whatsappDown = false;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (req.method === 'POST' && /^\/v[\d.]+\/[^/]+\/messages$/.test(url.pathname)) {
        if (whatsappDown) return json(res, 503, { error: { message: 'Service unavailable' } });
        const code = body.template?.components?.[0]?.parameters?.[0]?.text;
        inbox.set(`+${body.to}`, { channel: 'whatsapp', code, at: new Date().toISOString() });
        return json(res, 200, { messages: [{ id: `wamid.${Date.now()}` }] });
      }
      if (req.method === 'POST' && url.pathname === '/sms') {
        const code = /(\d{6})/.exec(body.message ?? '')?.[1];
        inbox.set(body.to, { channel: 'sms', code, at: new Date().toISOString() });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/__inbox') {
        return json(res, 200, inbox.get(url.searchParams.get('to')) ?? null);
      }
      if (req.method === 'POST' && url.pathname === '/__whatsapp/down') {
        whatsappDown = true;
        return json(res, 200, { whatsappDown });
      }
      if (req.method === 'POST' && url.pathname === '/__whatsapp/up') {
        whatsappDown = false;
        return json(res, 200, { whatsappDown });
      }
      json(res, 404, {});
    });
  })
  .listen(PORT, () => console.log(`mock-messaging :${PORT}`));
