// commands:
// Terminal 1
// cd server
// python3 main.py
// Terminal 2
// node client14.js

const soap = require('soap');
const readline = require('readline');

const WSDL = process.argv[2] || 'gen/ChatRoom.wsdl';
const ENDPOINT = process.argv[3] || null;
const TIMEOUT_MS = 5000;


class OperationTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs} ms; the server outcome may be pending`);
    this.name = 'OperationTimeoutError';
  }
}

function unwrap(response) {
  if (response && response.success !== undefined) return response;
  return response ? response.result : response;
}

function asList(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function buildArgs(method, token, args) {
  switch (method) {
    case 'LogIn':
      return { username: args[0], password: args[1] };
    case 'JoinRoom':
    case 'Leave':
    case 'DisplayJoined':
      return { token, roomName: args[0] };
    default:
      throw new Error(`Unsupported operation: ${method}`);
  }
}

// Promise.race() implements the deadline. The underlying SOAP request is not
// cancelled by Promise.race(), so mutating operations need compensation logic.
function withTimeout(promise, label, timeoutMs = TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError(label, timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  let client;

  try {
    client = await soap.createClientAsync(WSDL);
    if (ENDPOINT) client.setEndpoint(ENDPOINT);
  } catch (err) {
    console.error('Could not load WSDL:', err.message || err);
    process.exit(1);
  }

  let token = '';
  const pendingJoinCleanups = new Set();
  const uncertainJoinRooms = new Set();

  function callRaw(method, args) {
    return client[`${method}Async`](buildArgs(method, token, args))
      .then((response) => unwrap(response[0]));
  }

  function call(method, args) {
    return withTimeout(callRaw(method, args), method);
  }

  async function waitForPendingJoinCleanups() {
    if (uncertainJoinRooms.size > 0) {
      throw new Error(
        `Cannot safely retry yet: the outcome of a timed-out join is still unknown ` +
        `for ${[...uncertainJoinRooms].join(', ')}. Wait for reconciliation or ` +
        `verify/clean up the membership on the server before retrying.`,
      );
    }
  }

  function joinRoomWithTimeoutCompensation(roomName) {
    const operation = callRaw('JoinRoom', [roomName]);

    return withTimeout(operation, `JoinRoom(${roomName})`).catch((err) => {
      if (!(err instanceof OperationTimeoutError)) throw err;

      uncertainJoinRooms.add(roomName);

      let cleanupTask;
      cleanupTask = operation
        .then(async (result) => {
          if (result && result.success) {
            const leaveResult = await callRaw('Leave', [roomName]);
            if (!leaveResult || !leaveResult.success) {
              throw new Error(
                `timed-out join for "${roomName}" completed, but rollback failed: ` +
                `${leaveResult ? leaveResult.error : 'empty Leave response'}`,
              );
            }
            console.log(`Reconciled timed-out join: left "${roomName}" successfully.`);
          }
          uncertainJoinRooms.delete(roomName);
        })
        .catch((cleanupError) => {
          
          console.error(
            `Could not reconcile timed-out join for "${roomName}":`,
            cleanupError.message || cleanupError,
          );
        })
        .finally(() => pendingJoinCleanups.delete(cleanupTask));

      pendingJoinCleanups.add(cleanupTask);
      throw err;
    });
  }

  async function login(username, password) {
    const result = await call('LogIn', [username, password]);
    if (!result || !result.success) throw new Error(result ? result.error : 'Empty login response');
    token = result.sessionToken;
    console.log(`Logged in successfully as ${username}.`);
  }

  async function rollbackSuccessfulJoins(roomNames) {
    if (roomNames.length === 0) return [];

    console.log('A room join failed. Rolling back the room(s) joined by this operation...');
    const rollbackResults = await Promise.allSettled(
      roomNames.map((roomName) => call('Leave', [roomName])),
    );

    const rollbackProblems = [];
    rollbackResults.forEach((settled, index) => {
      const roomName = roomNames[index];
      if (settled.status === 'rejected') {
        rollbackProblems.push(`${roomName}: ${settled.reason.message || settled.reason}`);
      } else if (!settled.value || !settled.value.success) {
        rollbackProblems.push(
          `${roomName}: ${settled.value ? settled.value.error : 'empty Leave response'}`,
        );
      } else {
        console.log(`Rollback successful: left "${roomName}".`);
      }
    });
    return rollbackProblems;
  }

  async function joinTwoRoomsAndCount(roomA, roomB) {
    await waitForPendingJoinCleanups();

    if (roomA === roomB) {
      throw new Error('Please provide two different room names.');
    }

    console.log(`\nJoining "${roomA}" and "${roomB}" concurrently...`);

    
    const joinSettled = await Promise.allSettled([
      joinRoomWithTimeoutCompensation(roomA),
      joinRoomWithTimeoutCompensation(roomB),
    ]);

    const successfulJoins = [];
    const joinProblems = [];

    joinSettled.forEach((settled, index) => {
      const roomName = index === 0 ? roomA : roomB;
      if (settled.status === 'rejected') {
        joinProblems.push(`${roomName}: ${settled.reason.message || settled.reason}`);
      } else if (!settled.value || !settled.value.success) {
        joinProblems.push(
          `${roomName}: ${settled.value ? settled.value.error : 'empty JoinRoom response'}`,
        );
      } else {
        successfulJoins.push(roomName);
      }
    });

    if (joinProblems.length > 0) {
      const rollbackProblems = await rollbackSuccessfulJoins(successfulJoins);
      const details = [
        ...joinProblems,
        ...rollbackProblems.map((problem) => `rollback failed (${problem})`),
      ];
      throw new Error(details.join('; '));
    }

    console.log('Successfully joined both rooms.');

    
    let userResults;
    try {
      userResults = await Promise.all([
        call('DisplayJoined', [roomA]),
        call('DisplayJoined', [roomB]),
      ]);
    } catch (err) {
      const rollbackProblems = await rollbackSuccessfulJoins([roomA, roomB]);
      throw new Error([
        `Could not retrieve both user lists: ${err.message || err}`,
        ...rollbackProblems.map((problem) => `rollback failed (${problem})`),
      ].join('; '));
    }

    const failedUserResult = userResults.find((result) => !result || !result.success);
    if (failedUserResult) {
      const rollbackProblems = await rollbackSuccessfulJoins([roomA, roomB]);
      throw new Error([
        `Could not retrieve both user lists: ${failedUserResult ? failedUserResult.error : 'empty response'}`,
        ...rollbackProblems.map((problem) => `rollback failed (${problem})`),
      ].join('; '));
    }

    const usersA = asList(userResults[0].usernames && userResults[0].usernames.item);
    const usersB = asList(userResults[1].usernames && userResults[1].usernames.item);
    const countA = usersA.length;
    const countB = usersB.length;
    const total = countA + countB;

    console.log('\n========== RESULT ==========');
    console.log(`${roomA}: ${countA} user(s)`);
    console.log(`${roomB}: ${countB} user(s)`);
    console.log('----------------------------');
    console.log(`Total room memberships: ${total}`);
    console.log('============================\n');

    return {
      roomA: { name: roomA, users: usersA, count: countA },
      roomB: { name: roomB, users: usersB, count: countB },
      total,
    };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('1.4> ');

  console.log('Feature 1.4 — Promise orchestration');
  console.log('Commands:');
  console.log('  login <username> <password>');
  console.log('  count <roomA> <roomB>');
  console.log('  help');
  console.log('  quit');
  rl.prompt();

  let commandQueue = Promise.resolve();

  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return rl.prompt();

    commandQueue = commandQueue
      .then(async () => {
        const [command, ...args] = line.split(/\s+/);

        if (command === 'help') {
          console.log('login <username> <password>');
          console.log('count <roomA> <roomB>');
          console.log('quit');
          return;
        }

        if (command === 'login') {
          if (args.length !== 2) {
            console.log('Usage: login <username> <password>');
            return;
          }
          await login(args[0], args[1]);
          return;
        }

        if (command === 'count') {
          if (!token) {
            console.log('Please log in first.');
            return;
          }
          if (args.length !== 2) {
            console.log('Usage: count <roomA> <roomB>');
            return;
          }
          await joinTwoRoomsAndCount(args[0], args[1]);
          return;
        }

        if (command === 'quit') {
          rl.close();
          return;
        }

        console.log("Unknown command. Type 'help'.");
      })
      .catch((err) => {
        console.error('Operation failed:', err.message || err);
      })
      .then(() => {
        if (!rl.closed) rl.prompt();
      });
  });

  rl.on('close', () => process.exit(0));
}

main();
