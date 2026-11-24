// commands:
// Terminal 1
// cd server
// python3 main.py
// Terminal 2
// node client.js



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

// main 

soap.createClient(WSDL, (err, client) => {
  if (err) {
    console.log('could not load WSDL:', err.message);
    process.exit(1);
  }
  if (ENDPOINT) client.setEndpoint(ENDPOINT);

  let token = '';

  function call(method, args, cb) {
    client[method](buildArgs(method, token, args), (err, response) => {
      if (err) return cb(err);
      cb(null, unwrap(response));
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('> ');

  // handle one command line, then call done() so we can show the prompt again
  function handle(line, done) {
    const idx = line.indexOf(' ');
    const cmd = idx === -1 ? line : line.slice(0, idx);
    const rest = idx === -1 ? '' : line.slice(idx + 1).trim();

    function simple(name, method, args, onOk) {
      call(method, args, (err, res) => {
        if (err) { console.log('error:', err.message || err); return done(); }
        if (show(name, res) && onOk) onOk(res);
        done();
      });
    }

    const parts = rest.split(/\s+/).filter(Boolean);
    function need(n) {
      if (parts.length < n) {
        console.log("wrong number of arguments (type 'help')");
        done();
        return false;
      }
      return true;
    }

    switch (cmd) {
      case 'quit':
        rl.close();
        return;

      case 'help':
        console.log(HELP);
        return done();

      case 'register':
        if (!need(2)) return;
        return simple('register', 'CreateAccount', [parts[0], parts[1]]);

      case 'login':
        if (!need(2)) return;
        return simple('login', 'LogIn', [parts[0], parts[1]], (res) => {
          token = res.sessionToken;
        });

      case 'createroom': {
        if (!need(2)) return;
        const i = rest.indexOf(' ');
        const name = i === -1 ? rest : rest.slice(0, i);
        const desc = i === -1 ? '' : rest.slice(i + 1);
        return simple('createroom', 'CreateRoom', [name, desc], (res) => {
          console.log('room id =', res.room.roomId);
        });
      }

      case 'rooms':
        return simple('rooms', 'ListRooms', [], (res) => {
          for (const r of asList(res.rooms && res.rooms.room)) {
            console.log(`  [${r.roomId}] ${r.roomName} - ${r.roomDescription}`);
          }
        });

      case 'join':
        if (!need(1)) return;
        return simple('join', 'JoinRoom', [rest]);

      case 'users':
        if (!need(1)) return;
        return simple('users', 'DisplayJoined', [rest], (res) => {
          for (const u of asList(res.usernames && res.usernames.item)) {
            console.log('  ' + u);
          }
        });

      case 'say': {
        if (!need(2)) return;
        const i = rest.indexOf(' ');
        const room = i === -1 ? rest : rest.slice(0, i);
        const text = i === -1 ? '' : rest.slice(i + 1);
        return simple('say', 'Broadcast', [room, text]);
      }

      case 'pm': {
        if (!need(3)) return;
        const p = parts;
        const room = p[0] || '';
        const user = p[1] || '';
        const text = p.slice(2).join(' ');
        return simple('pm', 'SendPrivate', [room, user, text]);
      }

      case 'poll':
        return call('GetMessages', [], (err, res) => {
          if (err) { console.log('error:', err.message || err); return done(); }
          if (res.success) {
            for (const m of asList(res.messages && res.messages.message)) {
              const tag = m.isPrivate ? ' (private)' : '';
              console.log(`  [${m.roomName}]${tag} ${m.sender}: ${m.text}`);
            }
          } else {
            console.log('poll failed:', res.error);
          }
          done();
        });

      case 'leave':
        if (!need(1)) return;
        return simple('leave', 'Leave', [rest]);

      case 'logout':
        return simple('logout', 'LogOut', [], () => { token = ''; });

      default:
        console.log("unknown command (type 'help')");
        return done();
    }
  }

  console.log(HELP);
  rl.prompt();
  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return rl.prompt();
    handle(line, () => rl.prompt());
  });
  rl.on('close', () => process.exit(0));
});
