// commands:
// Terminal 1
// cd server
// python3 main.py
// Terminal 2
// node client2.js

const soap = require('soap');
const readline = require('readline');

const WSDL = process.argv[2] || 'gen/ChatRoom.wsdl';
const ENDPOINT = process.argv[3] || null;

const HELP = [
  'commands:',
  '  register <user> <pass>     login <user> <pass>',
  '  createroom <name> <desc>   rooms',
  '  join <room>                users <room>',
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
  if (result.success) {
    console.log(`${name} OK`);
    return true;
  }
  console.log(`${name} failed: ${result.error}`);
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

soap.createClientAsync(WSDL)
  .then((client) => {
    if (ENDPOINT) client.setEndpoint(ENDPOINT);

    let token = '';

    function call(method, args) {
      return client[`${method}Async`](buildArgs(method, token, args))
        .then((result) => unwrap(result[0]));
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('> ');

    function handle(line) {
      const idx = line.indexOf(' ');
      const cmd = idx === -1 ? line : line.slice(0, idx);
      const rest = idx === -1 ? '' : line.slice(idx + 1).trim();
      const parts = rest.split(/\s+/).filter(Boolean);

      function need(n) {
        if (parts.length < n) {
          console.log("wrong number of arguments (type 'help')");
          return false;
        }
        return true;
      }

      function simple(name, method, args, onOk) {
        return call(method, args).then((res) => {
          if (show(name, res) && onOk) onOk(res);
        });
      }

      switch (cmd) {
        case 'quit':
          rl.close();
          return Promise.resolve();
        case 'help':
          console.log(HELP);
          return Promise.resolve();
        case 'register':
          return need(2) ? simple('register', 'CreateAccount', [parts[0], parts[1]]) : Promise.resolve();
        case 'login':
          return need(2) ? simple('login', 'LogIn', [parts[0], parts[1]], (res) => { token = res.sessionToken; }) : Promise.resolve();
        case 'createroom': {
          if (!need(2)) return Promise.resolve();
          const i = rest.indexOf(' ');
          const name = i === -1 ? rest : rest.slice(0, i);
          const desc = i === -1 ? '' : rest.slice(i + 1);
          return simple('createroom', 'CreateRoom', [name, desc], (res) => {
            console.log('room id =', res.room.roomId);
          });
        }
        case 'rooms':
          return simple('rooms', 'ListRooms', [], (res) => {
            asList(res.rooms && res.rooms.room).forEach((r) => {
              console.log(`  [${r.roomId}] ${r.roomName} - ${r.roomDescription}`);
            });
          });
        case 'join':
          if (!need(1)) return Promise.resolve();
          return simple('join', 'JoinRoom', [rest]);
        case 'users':
          if (!need(1)) return Promise.resolve();
          return simple('users', 'DisplayJoined', [rest], (res) => {
            asList(res.usernames && res.usernames.item).forEach((u) => console.log('  ' + u));
          });
        case 'say': {
          if (!need(2)) return Promise.resolve();
          const i = rest.indexOf(' ');
          const room = i === -1 ? rest : rest.slice(0, i);
          const message = i === -1 ? '' : rest.slice(i + 1);
          return simple('say', 'Broadcast', [room, message]);
        }
        case 'pm': {
          if (!need(3)) return Promise.resolve();
          const p = parts;
          return simple('pm', 'SendPrivate', [p[0] || '', p[1] || '', p.slice(2).join(' ')]);
        }
        case 'poll':
          return call('GetMessages', []).then((res) => {
            if (res.success) {
              asList(res.messages && res.messages.message).forEach((m) => {
                const tag = m.isPrivate ? ' (private)' : '';
                console.log(`  [${m.roomName}]${tag} ${m.sender}: ${m.text}`);
              });
            } else {
              console.log('poll failed:', res.error);
            }
          });
        case 'leave':
          if (!need(1)) return Promise.resolve();
          return simple('leave', 'Leave', [rest]);
        case 'logout':
          return simple('logout', 'LogOut', [], () => { token = ''; });
        default:
          console.log("unknown command (type 'help')");
          return Promise.resolve();
      }
    }

    console.log(HELP);
    rl.prompt();
    let commandQueue = Promise.resolve();
    rl.on('line', (raw) => {
      const line = raw.trim();
      if (!line) return rl.prompt();
      commandQueue = commandQueue
        .then(() => handle(line))
        .catch((err) => { console.log('error:', err.message || err); })
        .then(() => { if (!rl.closed) rl.prompt(); });
    });
    rl.on('close', () => process.exit(0));
  })
  .catch((err) => {
    console.log('could not load WSDL:', err.message || err);
    process.exit(1);
  });
