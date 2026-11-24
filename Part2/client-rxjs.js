// client-rxjs.js - RxJS WebSocket client (Milestone 4)
// Install: npm install ws rxjs
// Run:     node client-rxjs.js [ws://localhost:8081]

const WebSocket = require('ws');
const readline = require('readline');
const { fromEvent, merge, combineLatest, BehaviorSubject, of } = require('rxjs');
const {
  filter, map, switchMap, startWith, distinctUntilChanged, scan,
} = require('rxjs/operators');

const URL = process.argv[2] || 'ws://localhost:8081';
const ws = new WebSocket(URL);
const incoming$ = fromEvent(ws, 'message').pipe(
  map((raw) => JSON.parse(raw.toString())),
);

let token = '';
let requestNumber = 0;
const joinedRooms$ = new BehaviorSubject([]);
const userSnapshots = new Map(); // roomName -> BehaviorSubject(users)
const timeline = [];

function request(action, fields = {}) {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) return reject(new Error('WebSocket is not connected'));
    const id = `req-${++requestNumber}`;
    const subscription = incoming$.pipe(
      filter((message) => message.type === 'response' && message.id === id),
    ).subscribe((response) => {
      subscription.unsubscribe();
      if (response.ok) resolve(response);
      else reject(new Error(response.error || 'request failed'));
    });
    ws.send(JSON.stringify({ id, action, token, ...fields }));
  });
}

function setJoinedRooms(next) {
  joinedRooms$.next([...new Set(next)]);
}

function startReactivePipelines() {
  // Apply live server snapshots to the BehaviorSubject for the matching room.
  incoming$.pipe(filter((event) => event.type === 'room_users')).subscribe((event) => {
    const roomSubject = userSnapshots.get(event.roomName);
    if (roomSubject) roomSubject.next(event.users);
  });

  // 4.2: combineLatest always holds the latest membership list for each
  // currently joined room. switchMap rebuilds the aggregate when rooms change.
  const totalUsers$ = joinedRooms$.pipe(
    distinctUntilChanged((a, b) => a.join('\u0000') === b.join('\u0000')),
    switchMap((rooms) => rooms.length
      ? combineLatest(rooms.map((room) => userSnapshots.get(room).pipe(
          map((users) => ({ roomName: room, users, count: users.length })),
        )))
      : of([])),
    map((snapshots) => ({
      snapshots,
      total: snapshots.reduce((sum, snapshot) => sum + snapshot.count, 0),
    })),
  );

  totalUsers$.subscribe(({ snapshots, total }) => {
    if (!snapshots.length) {
      console.log('\n[RxJS user count] No rooms joined.');
      return;
    }
    const perRoom = snapshots.map((s) => `${s.roomName}: ${s.count}`).join(' | ');
    console.log(`\n[RxJS user count] ${perRoom} | TOTAL: ${total}`);
  });

  // 4.3: each active room contributes a filtered message stream. merge()
  // combines all those room streams into one stream. Server timestamps make
  // the unified timeline consistently sortable.
  const mergedRoomMessages$ = joinedRooms$.pipe(
    distinctUntilChanged((a, b) => a.join('\u0000') === b.join('\u0000')),
    switchMap((rooms) => rooms.length
      ? merge(...rooms.map((room) => incoming$.pipe(
          filter((event) => event.type === 'room_message' &&
            event.message.roomName === room),
          map((event) => event.message),
        )))
      : of(null).pipe(filter(Boolean)),
    ),
  );

  mergedRoomMessages$.pipe(
    scan((all, message) => {
      if (!message || all.some((m) => m.messageId === message.messageId)) return all;
      return [...all, message].sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
      );
    }, []),
  ).subscribe((messages) => {
    if (!messages.length) return;
    const latest = messages[messages.length - 1];
    console.log(`\n[timeline] ${new Date(latest.timestamp).toLocaleTimeString()} ` +
      `[${latest.roomName}] ${latest.sender}: ${latest.text}`);
  });
}

function printHelp() {
  console.log([
    'Commands:',
    '  register <username> <password>',
    '  login <username> <password>',
    '  create <roomName> <description>',
    '  rooms',
    '  add <roomName>       (join room and add it to reactive streams)',
    '  remove <roomName>    (leave room and remove it from reactive streams)',
    '  joined',
    '  users <roomName>',
    '  say <roomName> <message>',
    '  pm <roomName> <username> <message>',
    '  logout',
    '  help',
    '  quit',
  ].join('\n'));
}

async function handle(line) {
  const firstSpace = line.indexOf(' ');
  const command = firstSpace < 0 ? line : line.slice(0, firstSpace);
  const rest = firstSpace < 0 ? '' : line.slice(firstSpace + 1).trim();
  const parts = rest.split(/\s+/).filter(Boolean);

  try {
    switch (command) {
      case 'help':
        printHelp();
        break;
      case 'register': {
        if (parts.length < 2) throw new Error('usage: register <username> <password>');
        await request('register', { username: parts[0], password: parts[1] });
        console.log('Account created.');
        break;
      }
      case 'login': {
        if (parts.length < 2) throw new Error('usage: login <username> <password>');
        const result = await request('login', { username: parts[0], password: parts[1] });
        token = result.token;
        console.log(`Logged in as ${result.username}.`);
        break;
      }
      case 'create': {
        if (!rest) throw new Error('usage: create <roomName> <description>');
        const i = rest.indexOf(' ');
        const roomName = i < 0 ? rest : rest.slice(0, i);
        const description = i < 0 ? '' : rest.slice(i + 1);
        const result = await request('create_room', { roomName, description });
        console.log(`Created room ${result.room.roomName} (id ${result.room.roomId}).`);
        break;
      }
      case 'rooms': {
        const result = await request('list_rooms');
        result.rooms.forEach((room) =>
          console.log(`[${room.roomId}] ${room.roomName} - ${room.roomDescription}`));
        break;
      }
      case 'add': {
        if (!rest) throw new Error('usage: add <roomName>');
        if (joinedRooms$.getValue().includes(rest)) {
          console.log('Already monitoring this room.');
          break;
        }
        const result = await request('join_room', { roomName: rest });
        userSnapshots.set(rest, new BehaviorSubject(result.users));
        setJoinedRooms([...joinedRooms$.getValue(), rest]);
        console.log(`Joined ${rest}; reactive monitoring started.`);
        break;
      }
      case 'remove': {
        if (!rest) throw new Error('usage: remove <roomName>');
        await request('leave_room', { roomName: rest });
        userSnapshots.delete(rest);
        setJoinedRooms(joinedRooms$.getValue().filter((room) => room !== rest));
        console.log(`Left ${rest}; removed it from reactive streams.`);
        break;
      }
      case 'joined':
        console.log('Joined rooms:', joinedRooms$.getValue().join(', ') || '(none)');
        break;
      case 'users': {
        if (!rest) throw new Error('usage: users <roomName>');
        const result = await request('get_users', { roomName: rest });
        console.log(`${rest}: ${result.users.length} user(s)`);
        result.users.forEach((user) => console.log('  ' + user));
        break;
      }
      case 'say': {
        const i = rest.indexOf(' ');
        if (i < 1) throw new Error('usage: say <roomName> <message>');
        await request('say', { roomName: rest.slice(0, i), text: rest.slice(i + 1) });
        break;
      }
      case 'pm': {
        if (parts.length < 3) throw new Error('usage: pm <roomName> <username> <message>');
        await request('private_message', {
          roomName: parts[0], receiver: parts[1], text: parts.slice(2).join(' '),
        });
        break;
      }
      case 'logout':
        await request('logout');
        token = '';
        userSnapshots.clear();
        setJoinedRooms([]);
        console.log('Logged out.');
        break;
      case 'quit':
        ws.close();
        rl.close();
        return;
      default:
        console.log("Unknown command. Type 'help'.");
    }
  } catch (err) {
    console.error('Error:', err.message || err);
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt('> ');

ws.on('open', () => {
  console.log(`Connected to ${URL}`);
  printHelp();
  startReactivePipelines();
  rl.prompt();
});
ws.on('error', (err) => console.error('WebSocket error:', err.message));
ws.on('close', () => {
  console.log('Disconnected from server.');
  if (rl) rl.close();
});
rl.on('line', (raw) => {
  const line = raw.trim();
  if (!line) return rl.prompt();
  handle(line).finally(() => { if (!rl.closed) rl.prompt(); });
});
rl.on('close', () => {
  if (ws.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
});
