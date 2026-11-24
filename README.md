# Complete Homework Project

This repository contains the JavaScript SOAP clients for Milestone 3, the separate Promise-orchestration client for Feature 1.4, and the RxJS/WebSocket chat application for Milestone 4. It also includes the supplied Python SOAP server.

## Project structure

```text
RPC_Homework_All_Milestones/
├── Python_SOAP_Server/
│   ├── main.py
│   ├── http_layer.py
│   ├── soap.py
│   ├── logic.py
│   └── state.py
│
├── Milestone_3_SOAP_Clients/
│   ├── client.js
│   ├── client2.js
│   ├── client3.js
│   └── README.md
│
├── Feature_1_4_Orchestration/
│   ├── client14.js
│   └── README.md
│
├── Milestone_4_RxJS/
│   ├── server.js
│   ├── client-rxjs.js
│   └── README.md
│
├── Milestone_4_RxJS_Web_UI/
│   ├── index.html
│   ├── src/
│   │   ├── main.js
│   │   └── style.css
│   ├── server.js
│   ├── client-rxjs.js
│   ├── package.json
│   └── README.md
│
└── README.md
```

## 1. Requirements and tools

Install the following before running the project:

- Python 3
- Node.js 18 or newer
- npm
- The project dependencies listed below

Check your installations:

```bash
python3 --version
node --version
npm --version
```

The SOAP clients use the `soap` npm package. The Milestone 4 server uses `ws`. The browser UI uses `rxjs` and Vite in addition to `ws`.

---

## 2. Python SOAP server

The provided Python server exposes the SOAP service over HTTP. By default, it listens on port `8080` and serves its WSDL at `/?wsdl`.

Open a terminal in `Python_SOAP_Server/`:

```bash
python3 main.py
```

To use a different port:

```bash
python3 main.py 8080
```

The server's default WSDL path is `gen/ChatRoom.wsdl`. Make sure the generated WSDL exists at that path before starting the JavaScript SOAP clients. The WSDL-generation step and the `gen/` directory are not included in this archive.

If your WSDL is stored elsewhere, pass its path as the second server argument:

```bash
python3 main.py 8080 path/to/ChatRoom.wsdl
```

Keep the SOAP server running while using the Milestone 3 clients and Feature 1.4 client.

## 3. Milestone 3 — JavaScript SOAP clients

The three clients demonstrate different asynchronous programming styles while calling the SOAP service.

| File | Requirement | Main concept |
|---|---|---|
| `client.js` | Milestone 3.1 | Callback-based SOAP calls |
| `client2.js` | Milestone 3.2 | Promises without `async`/`await` |
| `client3.js` | Milestone 3.3 | `async`/`await` |

### Install dependency

Open a terminal in `Milestone_3_SOAP_Clients/`:

```bash
npm init -y
npm install soap
```

### Run the clients

```bash
node client.js
```

```bash
node client2.js
```

```bash
node client3.js
```

The clients default to the WSDL path `gen/ChatRoom.wsdl`. You can provide a custom WSDL path and service endpoint as command-line arguments:

```bash
node client3.js path/to/ChatRoom.wsdl http://localhost:8080/
```

### Common commands

The clients provide chat operations such as:

```text
register <username> <password>
login <username> <password>
createroom <name> <description>
rooms
join <room>
users <room>
say <room> <message>
pm <room> <username> <message>
poll
leave <room>
logout
quit
```

The exact command help printed by each client is authoritative for that client version.

---

## 4. Feature 1.4 — Promise orchestration

This is a separate client that demonstrates coordinating multiple asynchronous SOAP operations.

Open a terminal in `Feature_1_4_Orchestration/`:

```bash
npm init -y
npm install soap
node client14.js
```

If needed, provide the WSDL path and endpoint:

```bash
node client14.js path/to/ChatRoom.wsdl http://localhost:8080/
```

### Commands

```text
login <username> <password>
count <roomA> <roomB>
help
quit
```

### How the orchestration works

1. The client starts both room-join operations concurrently with `Promise.allSettled()`.
2. It checks the outcome of each join.
3. If one join fails, it calls `Leave` for any room successfully joined by this operation, preventing a partial join from being left behind.
4. When both joins succeed, it retrieves the two room user lists concurrently.
5. It calculates the combined membership count.
6. `Promise.race()` applies a timeout to SOAP operations.

A timeout does not cancel the underlying SOAP network request. The client therefore tracks uncertain join outcomes and attempts a compensating `Leave` if a timed-out join eventually succeeds.

**Counting interpretation:** the total is the sum of the two room membership counts. A user who belongs to both rooms is counted once in each room. This is a membership total, not a distinct-user count.

---

## 5. Milestone 4 — RxJS chat application

Milestone 4 is implemented as a separate WebSocket-based chat service. It includes both a terminal client and a browser interface.

### Option A — Browser interface (recommended for demonstration)

Open a terminal in `Milestone_4_RxJS_Web_UI/`.

**Terminal 1: install dependencies and start the WebSocket server**

```bash
npm install
npm run server
```

The WebSocket server listens on:

```text
ws://localhost:8081
```

**Terminal 2: start the browser development server**

```bash
npm run dev
```

Vite prints a local URL, normally:

```text
http://localhost:5173
```

Open the HTTP URL in your browser. Do not enter `ws://localhost:8081` in the browser address bar; it is the WebSocket endpoint used internally by the application.

The browser interface supports:

- Account registration and login
- Creating and listing chat rooms
- Joining and leaving rooms
- Viewing room members
- Sending messages to joined rooms
- Viewing messages from joined rooms in one timeline
- Monitoring the combined room-membership count

### Option B — Terminal RxJS client

The terminal client is also included in `Milestone_4_RxJS_Web_UI/`.

Start the server as described above, then in another terminal in the same folder run:

```bash
npm run client
```

Alternatively, the standalone terminal implementation is in `Milestone_4_RxJS/`. Follow that folder's README for its setup and usage.

### RxJS operators and their roles

| Operator / Subject | Role in the implementation |
|---|---|
| `BehaviorSubject` | Holds the current list of joined rooms and the latest member snapshot for each room |
| `switchMap` | Rebuilds the active room subscriptions when the joined-room list changes |
| `combineLatest` | Combines the latest user-list snapshot from every currently joined room |
| `map` | Calculates each room's user count and the combined total |
| `merge` | Combines message events from the currently joined rooms into one stream |
| `scan` | Maintains the accumulated message timeline |
| `distinctUntilChanged` | Avoids rebuilding streams when the joined-room list has not changed |

The WebSocket server publishes room membership and message events to connected clients. The browser client uses the browser's native WebSocket API for transport and RxJS for reactive stream composition.

### Suggested Milestone 4 demonstration

1. Start the WebSocket server and open the browser interface.
2. Register and log in as the first user.
3. Create two rooms, for example `roomA` and `roomB`.
4. Open a second browser window (or another browser) and register/log in as a second user.
5. Join the second user to one of the rooms.
6. Observe the first user's membership count and member list update.
7. Send messages in both rooms and observe them in the unified timeline.
8. Leave one room and verify it no longer contributes to the active room count or message stream.
9. Join that room again and verify that its stream becomes active again.

---

## 6. Important notes and limitations

- **SOAP WSDL:** The archive does not include the generated `gen/ChatRoom.wsdl` file. Generate or obtain it from the course materials and place it at the expected path, or pass its actual path to the client.
- **Separate Milestone 4 service:** The RxJS implementation uses its own Node.js WebSocket server. It is not the Python SOAP server. Run the correct server for the milestone being demonstrated.
- **Separate data stores:** The SOAP server and WebSocket server maintain separate in-memory state. Accounts and rooms created in one service are not automatically available in the other.
- **In-memory data:** Restarting either server clears that server's accounts, rooms, sessions, and messages.
- **Ports:** The Python SOAP server defaults to port `8080`; the Milestone 4 WebSocket server defaults to port `8081`; Vite normally serves the browser UI on port `5173`.
- **Port conflicts:** If a port is already in use, stop the other process or configure a different port. The browser UI's WebSocket URL must match the WebSocket server port.
- **Chronological messages:** The Milestone 4 WebSocket server attaches timestamps to messages. The client uses these timestamps to order the unified timeline.
- **Testing status:** Build and integration-test results depend on the latest test run in the development environment. Run the commands and manual checks above on the machine used for the final demonstration.

## 7. Troubleshooting

### SOAP client cannot load the WSDL

- Confirm that `gen/ChatRoom.wsdl` exists, or provide the correct path as the first command-line argument.
- Confirm that the Python SOAP server is running.
- Confirm that the endpoint matches the server's host and port.

### Browser says `ERR_UNKNOWN_URL_SCHEME`

You likely opened the WebSocket URL directly. Open the Vite HTTP URL instead:

```text
http://localhost:5173
```

### Browser cannot connect to the WebSocket server

- Confirm that `npm run server` is still running.
- Confirm that port `8081` is available.
- Refresh the browser after starting the server.
- If you changed the WebSocket server port, update the WebSocket URL in the browser client.

### `npm install` fails

- Confirm Node.js and npm are installed.
- Run `npm install` from the folder containing the relevant `package.json`.
- Check your internet connection and retry.

---

## 8. Recommended execution order

1. Set up the generated SOAP WSDL and Python SOAP server.
2. Run the three Milestone 3 clients.
3. Run the separate Feature 1.4 orchestration client.
4. Start the Milestone 4 WebSocket server and browser UI.
5. Demonstrate dynamic room changes, reactive membership aggregation, and the unified chronological message timeline.
