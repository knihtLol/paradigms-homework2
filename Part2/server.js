// server.js - Milestone 4 WebSocket chat server
// Install: npm install ws
// Run:     node server.js [port]

const { WebSocketServer, WebSocket } = require('ws');
const { randomBytes, randomUUID } = require('crypto');

const PORT = Number(process.argv[2] || 8081);

// In-memory state mirrors the original Python server's state.py / logic.py.
const accounts = new Map();       // username -> password
const sessions = new Map();       // token -> username
const rooms = new Map();          // roomName -> { id, description, members:Set }
let nextRoomId = 1;

const wss = new WebSocketServer({ port: PORT });
console.log(`Milestone 4 chat server listening on ws://localhost:${PORT}`);

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function reply(ws, id, payload) {
  send(ws, { type: 'response', id, ...payload });
}

function userFor(token) {
  return sessions.get(token) || null;
}

function roomForUser(token, roomName) {
  const username = userFor(token);
  if (!username) return { error: 'invalid session' };
  const room = rooms.get(roomName);
  if (!room) return { error: 'no such room' };
  if (!room.members.has(username)) return { error: 'you have not joined this room' };
  return { username, room };
}

function roomUsers(roomName) {
  const room = rooms.get(roomName);
  return room ? [...room.members].sort() : [];
}

function publishUsers(roomName) {
  const room = rooms.get(roomName);
  if (!room) return;
  const event = { type: 'room_users', roomName, users: roomUsers(roomName) };
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN || !ws.token) continue;
    const username = userFor(ws.token);
    if (username && room.members.has(username)) send(ws, event);
  }
}

function publishMessage(roomName, message, recipients) {
  const event = { type: 'room_message', message };
  for (const ws of wss.clients) {
    if (ws.readyState !== WebSocket.OPEN || !ws.token) continue;
    const username = userFor(ws.token);
    if (username && recipients.has(username)) send(ws, event);
  }
}

function leaveAll(username) {
  for (const [roomName, room] of rooms) {
    if (room.members.delete(username)) publishUsers(roomName);
  }
}

function handle(ws, request) {
  const { id, action } = request;
  const token = request.token;
  const username = userFor(token);

  switch (action) {
    case 'register': {
      const { username: newUser, password } = request;
      if (!newUser || !password) return reply(ws, id, { ok: false, error: 'invalid username or password' });
      if (accounts.has(newUser)) return reply(ws, id, { ok: false, error: 'username already taken' });
      accounts.set(newUser, password);
      return reply(ws, id, { ok: true });
    }

    case 'login': {
      const { username: loginUser, password } = request;
      if (!password || accounts.get(loginUser) !== password) {
        return reply(ws, id, { ok: false, error: 'wrong username or password' });
      }
      const newToken = randomBytes(24).toString('hex');
      sessions.set(newToken, loginUser);
      ws.token = newToken;
      return reply(ws, id, { ok: true, token: newToken, username: loginUser });
    }

    case 'create_room': {
      if (!username) return reply(ws, id, { ok: false, error: 'invalid session' });
      const { roomName, description = '' } = request;
      if (!roomName) return reply(ws, id, { ok: false, error: 'invalid room name' });
      if (rooms.has(roomName)) return reply(ws, id, { ok: false, error: 'room name already exists' });
      const room = { id: nextRoomId++, description, members: new Set() };
      rooms.set(roomName, room);
      return reply(ws, id, {
        ok: true,
        room: { roomId: room.id, roomName, roomDescription: description },
      });
    }

    case 'list_rooms': {
      if (!username) return reply(ws, id, { ok: false, error: 'invalid session' });
      const list = [...rooms.entries()].map(([roomName, room]) => ({
        roomId: room.id, roomName, roomDescription: room.description,
      }));
      return reply(ws, id, { ok: true, rooms: list });
    }

    case 'join_room': {
      if (!username) return reply(ws, id, { ok: false, error: 'invalid session' });
      const room = rooms.get(request.roomName);
      if (!room) return reply(ws, id, { ok: false, error: 'no such room' });
      if (room.members.has(username)) return reply(ws, id, { ok: false, error: 'already in room' });
      room.members.add(username);
      // Respond with a snapshot so the client can seed its reactive user stream.
      reply(ws, id, { ok: true, users: roomUsers(request.roomName) });
      publishUsers(request.roomName);
      return;
    }

    case 'leave_room': {
      const checked = roomForUser(token, request.roomName);
      if (checked.error) return reply(ws, id, { ok: false, error: checked.error });
      checked.room.members.delete(checked.username);
      reply(ws, id, { ok: true });
      publishUsers(request.roomName);
      return;
    }

    case 'get_users': {
      const checked = roomForUser(token, request.roomName);
      if (checked.error) return reply(ws, id, { ok: false, error: checked.error });
      return reply(ws, id, { ok: true, users: roomUsers(request.roomName) });
    }

    case 'say':
    case 'private_message': {
      const checked = roomForUser(token, request.roomName);
      if (checked.error) return reply(ws, id, { ok: false, error: checked.error });
      const text = (request.text || '').trim();
      if (!text) return reply(ws, id, { ok: false, error: 'empty message' });

      let recipients;
      let isPrivate = false;
      if (action === 'private_message') {
        if (!checked.room.members.has(request.receiver)) {
          return reply(ws, id, { ok: false, error: 'receiver is not in this room' });
        }
        recipients = new Set([checked.username, request.receiver]);
        isPrivate = true;
      } else {
        recipients = new Set(checked.room.members);
      }

      const message = {
        messageId: randomUUID(),
        roomName: request.roomName,
        sender: checked.username,
        text,
        isPrivate,
        timestamp: new Date().toISOString(),
      };
      reply(ws, id, { ok: true, messageId: message.messageId });
      publishMessage(request.roomName, message, recipients);
      return;
    }

    case 'logout': {
      if (!username) return reply(ws, id, { ok: false, error: 'invalid session' });
      leaveAll(username);
      sessions.delete(token);
      if (ws.token === token) ws.token = null;
      return reply(ws, id, { ok: true });
    }

    default:
      return reply(ws, id, { ok: false, error: `unknown action: ${action}` });
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let request;
    try {
      request = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'protocol_error', error: 'message must be valid JSON' });
    }
    if (!request || !request.id || !request.action) {
      return send(ws, { type: 'protocol_error', error: 'request requires id and action' });
    }
    try {
      handle(ws, request);
    } catch (err) {
      reply(ws, request.id, { ok: false, error: err.message || 'server error' });
    }
  });
  ws.on('error', (err) => console.error('WebSocket error:', err.message));
});
