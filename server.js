const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "12345Avril";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "appointments.json");
const sessions = new Set();

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");

const slots = [
  { start: "09:00", end: "10:30", label: "9:00 a. m. – 10:30 a. m." },
  { start: "10:30", end: "12:00", label: "10:30 a. m. – 12:00 p. m." },
  { start: "12:00", end: "13:30", label: "12:00 p. m. – 1:30 p. m." },
  { start: "13:30", end: "15:00", label: "1:30 p. m. – 3:00 p. m." },
  { start: "15:00", end: "16:30", label: "3:00 p. m. – 4:30 p. m." },
  { start: "16:30", end: "18:00", label: "4:30 p. m. – 6:00 p. m." }
];

function readAppointments() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return []; }
}

function writeAppointments(items) {
  const temp = DATA_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(items, null, 2), "utf8");
  fs.renameSync(temp, DATA_FILE);
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(payload);
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 1000000) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("JSON inválido")); } });
    req.on("error", reject);
  });
}

function isAdmin(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  return token && sessions.has(token);
}

function serveStatic(req, res, pathname) {
  const file = pathname === "/" ? "index.html" : pathname === "/admin" ? "admin.html" : pathname.slice(1);
  const safePath = path.normalize(path.join(PUBLIC_DIR, file));
  if (!safePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Acceso denegado" });
  fs.readFile(safePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: "Página no encontrada" });
    const ext = path.extname(safePath);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/slots") {
      const date = url.searchParams.get("date");
      const booked = readAppointments().filter(a => a.date === date).map(a => a.start);
      return sendJson(res, 200, { slots, booked });
    }

    if (req.method === "POST" && pathname === "/api/appointments") {
      const body = await getBody(req);
      const { date, start, name, phone, reason } = body;
      const slot = slots.find(s => s.start === start);
      if (!date || !slot || !name?.trim() || !phone?.trim()) {
        return sendJson(res, 400, { error: "Completa la fecha, horario, nombre y teléfono." });
      }
      const appointments = readAppointments();
      if (appointments.some(a => a.date === date && a.start === start)) {
        return sendJson(res, 409, { error: "Ese horario acaba de ser ocupado. Elige otro." });
      }
      appointments.push({
        id: crypto.randomUUID(), date, start: slot.start, end: slot.end,
        label: slot.label, name: name.trim(), phone: phone.trim(), reason: reason?.trim() || "Sin motivo especificado",
        createdAt: new Date().toISOString()
      });
      writeAppointments(appointments);
      return sendJson(res, 201, { ok: true });
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await getBody(req);
      if (body.password !== ADMIN_PASSWORD) return sendJson(res, 401, { error: "Contraseña incorrecta." });
      const token = crypto.randomBytes(32).toString("hex");
      sessions.add(token);
      return sendJson(res, 200, { token });
    }

    if (req.method === "GET" && pathname === "/api/admin/appointments") {
      if (!isAdmin(req)) return sendJson(res, 401, { error: "No autorizado." });
      return sendJson(res, 200, { appointments: readAppointments() });
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/appointments/")) {
      if (!isAdmin(req)) return sendJson(res, 401, { error: "No autorizado." });
      const id = pathname.split("/").pop();
      const appointments = readAppointments();
      const next = appointments.filter(a => a.id !== id);
      if (next.length === appointments.length) return sendJson(res, 404, { error: "Cita no encontrada." });
      writeAppointments(next);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET") return serveStatic(req, res, pathname);
    return sendJson(res, 405, { error: "Método no permitido" });
  } catch (error) {
    return sendJson(res, 500, { error: "Ocurrió un error en el servidor." });
  }
});

server.listen(PORT, () => console.log(`Lumma disponible en http://localhost:${PORT}`));
