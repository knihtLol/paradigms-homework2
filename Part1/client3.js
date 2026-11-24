// commands:
// Terminal 1
// cd server
// python3 main.py
// Terminal 2
// node client3.js

const soap = require('soap');
const readline = require('readline');

const WSDL = process.argv[2] || 'gen/ChatRoom.wsdl';
const ENDPOINT = process.argv[3] || null;

const HELP = [
  'commands:',
  '  register <user> <pass>     login <user> <pass>',
  '  createroom <name> <desc>   rooms',
  '  join <room>                users <room>',
  '  joinboth <room1> <room2>   totalusers <room1> <room2>',
  '  say <room> <text>          pm <room> <user> <text>',
  '  poll                       leave <room>',
  '  logout                     quit',
].join('\n');

function unwrap(response) {
  if (response && response.success !== undefined) return response;
  return response ? response.result : response;
}

function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function show(name, result) {
  if (result && result.success) {
    console.log(`${name} OK`);
    return true;
  }
  console.log(`${name} failed: ${result ? result.error : 'empty response'}`);
  return false;
}

function buildArgs(method, token, a) {
  switch (method) {
    case 'CreateAccount': return { username: a[0], password: a[1] };
    case 'LogIn':         return { username: a[0], password: a[1] };
    case 'CreateRoom':    return { token, roomName: a[0], roomDescription: a[1] };
    case 'ListRooms':     return { token };
    case 'JoinRoom':      return { token, roomName: a[0] };
    case 'DisplayJoined': return { token, roomName: a[0] };
    case 'Broadcast':     return { token, roomName: a[0], message: a[1] };
    case 'SendPrivate':   return { token, roomName: a[0], receiver: a[1], message: a[2] };
    case 'GetMessages':   return { token };
    case 'Leave':         return { token, roomName: a[0] };
    case 'LogOut':        return { token };
    default: throw new Error('unknown method ' + method);
  }
}

async function main() {
  let client;
  try {
    client = await soap.createClientAsync(WSDL);
    if (ENDPOINT) client.setEndpoint(ENDPOINT);
  } catch (err) {
    console.error('could not load WSDL:', err.message || err);
    process.exit(1);
  }

  let token = '';

  async function call(method, args) {
    const response = await client[`${method}Async`](buildArgs(method, token, args));
    return unwrap(response[0]);
  }

  async function simple(name, method, args, onOk) {
    try {
      const result = await call(method, args);
      if (show(name, result) && onOk) await onOk(result);
    } catch (err) {
      console.error('error:', err.message || err);
    }
  }

  async function getRoomUserCount(roomName) {
    const result = await call('DisplayJoined', [roomName]);
    if (!result || !result.success) {
      throw new Error(result ? result.error : `No response for room ${roomName}`);
    }
    return asList(result.usernames && result.usernames.item).length;
  }

  async function joinTwoRooms(room1, room2) {
    const first = await call('JoinRoom', [room1]);
    if (!show(`join ${room1}`, first)) return;

    const second = await call('JoinRoom', [room2]);
    if (!show(`join ${room2}`, second)) return;

    const [count1, count2] = await Promise.all([
      getRoomUserCount(room1),
      getRoomUserCount(room2),
    ]);

    console.log(`${room1}: ${count1} user(s)`);
    console.log(`${room2}: ${count2} user(s)`);
    console.log(`Total users in both rooms: ${count1 + count2}`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('> ');

  async function handle(line) {
    const idx = line.indexOf(' ');
    const cmd = idx === -1 ? line : line.slice(0, idx);
    const rest = idx === -1 ? '' : line.slice(idx + 1).trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    const need = (n) => {
      if (parts.length >= n) return true;
      console.log("wrong number of arguments (type 'help')");
      return false;
    };

    switch (cmd) {
      case 'quit':
        rl.close();
        return;
      case 'help':
        console.log(HELP);
        return;
      case 'register':
        if (need(2)) await simple('register', 'CreateAccount', [parts[0], parts[1]]);
        return;
      case 'login':
        if (need(2)) await simple('login', 'LogIn', [parts[0], parts[1]], (r) => { token = r.sessionToken; });
        return;
      case 'createroom': {
        if (!need(2)) return;
        const i = rest.indexOf(' ');
        const roomName = i === -1 ? rest : rest.slice(0, i);
        const description = i === -1 ? '' : rest.slice(i + 1);
        await simple('createroom', 'CreateRoom', [roomName, description],
          (r) => console.log('room id =', r.room.roomId));
        return;
      }
      case 'rooms':
        await simple('rooms', 'ListRooms', [], (r) => {
          asList(r.rooms && r.rooms.room).forEach((room) =>
            console.log(`  [${room.roomId}] ${room.roomName} - ${room.roomDescription}`));
        });
        return;
      case 'join':
        if (need(1)) await simple('join', 'JoinRoom', [rest]);
        return;
      case 'joinboth':
        if (need(2)) await joinTwoRooms(parts[0], parts[1]);
        return;
      case 'totalusers': {
        if (!need(2)) return;
        try {
          const [n1, n2] = await Promise.all([
            getRoomUserCount(parts[0]), getRoomUserCount(parts[1]),
          ]);
          console.log(`${parts[0]}: ${n1} user(s)`);
          console.log(`${parts[1]}: ${n2} user(s)`);
          console.log(`Total users in both rooms: ${n1 + n2}`);
        } catch (err) {
          console.error('could not calculate total:', err.message || err);
        }
        return;
      }
      case 'users':
        if (!need(1)) return;
        await simple('users', 'DisplayJoined', [rest], (r) =>
          asList(r.usernames && r.usernames.item).forEach((u) => console.log('  ' + u)));
        return;
      case 'say': {
        if (!need(2)) return;
        const i = rest.indexOf(' ');
        await simple('say', 'Broadcast',
          [i === -1 ? rest : rest.slice(0, i), i === -1 ? '' : rest.slice(i + 1)]);
        return;
      }
      case 'pm': {
        if (!need(3)) return;
        await simple('pm', 'SendPrivate', [parts[0], parts[1], parts.slice(2).join(' ')]);
        return;
      }
      case 'poll':
        try {
          const r = await call('GetMessages', []);
          if (r.success) {
            asList(r.messages && r.messages.message).forEach((m) => {
              const tag = m.isPrivate ? ' (private)' : '';
              console.log(`  [${m.roomName}]${tag} ${m.sender}: ${m.text}`);
            });
          } else console.log('poll failed:', r.error);
        } catch (err) {
          console.error('error:', err.message || err);
        }
        return;
      case 'leave':
        if (need(1)) await simple('leave', 'Leave', [rest]);
        return;
      case 'logout':
        await simple('logout', 'LogOut', [], () => { token = ''; });
        return;
      default:
        console.log("unknown command (type 'help')");
    }
  }

  console.log(HELP);
  rl.prompt();
  let queue = Promise.resolve();
  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return rl.prompt();
    queue = queue
      .then(() => handle(line))
      .catch((err) => console.error('error:', err.message || err))
      .then(() => { if (!rl.closed) rl.prompt(); });
  });
  rl.on('close', () => process.exit(0));
}

main();
