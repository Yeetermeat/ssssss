// Live chat + "who's online" counter.
// Messages live only in memory (last 60) and are never written to disk or logged.
import { WebSocketServer } from "ws";

const HISTORY_MAX = 60;
const NAME_MAX = 20;
const TEXT_MAX = 300;
const BURST = 5; // messages allowed in a burst
const REFILL_MS = 1200; // one more message allowed every this many ms

const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
const history = [];
let nextId = 1;

function clean(str, max) {
	return String(str || "")
		.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);
}

function okColor(c) {
	return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : "#57e389";
}

function onlineCount() {
	const ids = new Set();
	for (const ws of wss.clients) if (ws.readyState === 1 && ws.uid) ids.add(ws.uid);
	return ids.size;
}

function broadcast(obj) {
	const data = JSON.stringify(obj);
	for (const ws of wss.clients) if (ws.readyState === 1 && ws.uid) ws.send(data);
}

let lastCount = -1;
function sendCount() {
	const n = onlineCount();
	if (n === lastCount) return;
	lastCount = n;
	broadcast({ type: "online", n });
}

wss.on("connection", (ws) => {
	ws.alive = true;
	ws.tokens = BURST;
	ws.lastRefill = Date.now();
	ws.on("pong", () => (ws.alive = true));

	ws.on("message", (raw) => {
		let m;
		try {
			m = JSON.parse(raw.toString());
		} catch {
			return;
		}
		if (!m || typeof m !== "object") return;

		if (m.type === "hello") {
			ws.uid = clean(m.uid, 40) || Math.random().toString(36).slice(2);
			ws.name = clean(m.name, NAME_MAX) || "Guest";
			ws.color = okColor(m.color);
			ws.send(JSON.stringify({ type: "init", history, n: onlineCount() }));
			lastCount = -1;
			sendCount();
			return;
		}
		if (!ws.uid) return;

		if (m.type === "name") {
			ws.name = clean(m.name, NAME_MAX) || ws.name;
			ws.color = okColor(m.color);
			return;
		}

		if (m.type === "msg") {
			const text = clean(m.text, TEXT_MAX);
			if (!text) return;
			const now = Date.now();
			ws.tokens = Math.min(BURST, ws.tokens + (now - ws.lastRefill) / REFILL_MS);
			ws.lastRefill = now;
			if (ws.tokens < 1) {
				ws.send(JSON.stringify({ type: "slow" }));
				return;
			}
			ws.tokens -= 1;
			const msg = { type: "msg", id: nextId++, uid: ws.uid, name: ws.name, color: ws.color, text, t: now };
			history.push(msg);
			if (history.length > HISTORY_MAX) history.shift();
			broadcast(msg);
		}
	});

	ws.on("close", sendCount);
});

// drop connections that silently went away, so the online number stays right
setInterval(() => {
	for (const ws of wss.clients) {
		if (!ws.alive) {
			ws.terminate();
			continue;
		}
		ws.alive = false;
		try {
			ws.ping();
		} catch {}
	}
	sendCount();
}, 25000);

export function handleChatUpgrade(req, socket, head) {
	// only pages from this site may connect
	const origin = req.headers.origin;
	try {
		if (origin && new URL(origin).host !== req.headers.host) {
			socket.destroy();
			return;
		}
	} catch {
		socket.destroy();
		return;
	}
	wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
}
