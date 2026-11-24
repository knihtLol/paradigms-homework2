# Milestone 4 — Roomwave browser UI (RxJS)

This version gives the RxJS chat project a browser-based interface. It uses the same `server.js` WebSocket backend and the same reactive RxJS streams; only the presentation layer has been redesigned.

## Run it

Requirements: Node.js 18 or newer.

Open two terminals in this folder.

**Terminal 1 — install dependencies and start the WebSocket server:**

```bash
npm install
npm run server
```

**Terminal 2 — start the browser development server:**

```bash
npm run dev
```

Open the `http://localhost:5173` URL printed by Vite.

> Do not type `ws://localhost:8081` into the browser address bar. That is the WebSocket endpoint the page connects to internally, not a website.

## Interface features

- Register and log in
- Browse rooms, create rooms, join and leave rooms
- See live room membership
- See the combined membership total update automatically
- Send messages to joined rooms
- View messages from all joined rooms in one chronological timeline
- Responsive layout for desktop and mobile

## RxJS concepts demonstrated

- `BehaviorSubject`: keeps the dynamic joined-room list and each room's latest member snapshot
- `switchMap`: rebuilds active streams when the joined-room list changes
- `combineLatest` and `map`: aggregate the latest member lists and calculate the total
- `merge`: combines message streams from all currently joined rooms
- `scan`: maintains a unique, chronologically sorted message timeline
- `distinctUntilChanged`: avoids rebuilding streams when the room list has not changed

The browser uses the native WebSocket API for transport and RxJS for reactive state and stream composition. The terminal-based `client-rxjs.js` remains included as an alternative client.

## Notes

- The WebSocket server stores data in memory. Restarting it clears accounts, rooms, sessions and messages.
- To demonstrate live updates, open the app in two browser windows, register two different users, and join the same room.
