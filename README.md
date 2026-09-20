# Task Manager

A full-stack productivity app with a **dark terminal / cyber-productivity** UI:
sidebar workspace, kanban board, calendar, analytics, a Pomodoro focus mode, a
notification centre, an activity feed and a complete settings screen.

Built with **zero external dependencies** — pure Node.js on the back end, vanilla
JS on the front end. Nothing to `npm install`, so it starts every time.

---

## Run it

### Windows — silent, one double-click (no console window)

Double-click **`Start Task Manager.vbs`**. It launches the backend hidden via
`wscript.exe`, waits for it, then opens the app. Stop it with
**`Stop Task Manager.vbs`**.

### Any platform — terminal

```bash
node server.js
```

Then open <http://localhost:3000>. `start.bat` does the same with a visible window.

`index.html` in this folder is a launcher page: it polls the backend and forwards
you to the app once it's up.

> `PORT=3001 node server.js` to change the port (the `.vbs` launchers assume 3000).

---

## Features

| Area | What it does |
|---|---|
| **Auth** | Register / login, scrypt-hashed passwords, HMAC session tokens, per-user data isolation |
| **Dashboard** | Greeting, 5 KPI stats, and re-orderable / hideable widgets: today's tasks, upcoming deadlines, priority overview, completion progress, productivity chart, recently completed, activity feed |
| **Tasks** | Kanban board **and** list view. Drag-and-drop between columns. Search (title/description/tags/status/priority), filters (status, priority, tag, due, overdue, completed, recurring), 5 sort orders |
| **Task card** | Title, priority (Critical/High/Medium/Low), due date + overdue flag, tags, checklist progress, recurring marker, per-card menu, multi-select + bulk actions |
| **Task detail** | Slide-over panel with autosave: description, status, priority, due/start date, estimate, recurring, assignee, tags, checklist/subtasks, notes, attachment links, and full change history |
| **Quick add** | Keyboard-first modal — Enter to create, Ctrl+Enter to add another |
| **Calendar** | Month / week / agenda views; tasks appear on their due date; click to open detail; double-click a day to add |
| **Analytics** | Completion rate, avg. completion time, streak, overdue, priority + status donuts, created-vs-completed and 14-day completion charts — all from real data |
| **Focus** | Pomodoro timer with configurable work / short / long durations, session dots, current-task picker, daily focus total, optional OS notification |
| **Notifications** | Bell centre for deadlines / overdue / completions, plus toast feedback for every action |
| **Activity feed** | Every create / complete / move / priority change / edit / archive / delete, with timestamps (right panel + analytics + task history) |
| **Settings** | Account (editable name), Appearance (theme, accent, density, font size, motion), Workspace defaults, Notifications, Dashboard widgets (drag to reorder), Kanban behaviour, Keyboard shortcuts, Data (export / import / clear / reset), Danger zone. Every control persists to the server. |
| **Realtime** | Server-Sent Events — changes in one tab appear in another instantly |
| **Responsive** | 1920 → mobile; sidebar collapses / becomes a drawer; bottom nav on phones; no horizontal scroll |
| **Accessible** | Keyboard nav, visible focus rings, semantic buttons, aria labels, `prefers-reduced-motion`, status shown with icon + text (not colour alone) |

**Keyboard:** `N` new task · `/` focus search · `G` then `D/T/C/A/F` navigate · `Esc` close.

---

## Project structure

```
.
├── server.js                 # HTTP API + static files + SSE (no deps)
├── public/
│   ├── index.html            # app shell + SVG icon sprite
│   ├── styles.css            # design system (tokens, components, responsive)
│   └── app.js                # SPA: router, views, state, realtime
├── index.html                # launcher page (detects backend, forwards)
├── Start Task Manager.vbs    # silent Windows launcher
├── Stop Task Manager.vbs     # stops the silent backend
├── start.bat / start.ps1     # visible-window launchers
├── package.json              # npm start -> node server.js
└── data.json                 # created on first run (git-ignored)
```

## API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Auth, returns a token |
| GET / PUT | `/api/me` | Current user / update name |
| GET / POST | `/api/tasks` | List / create |
| PUT / DELETE | `/api/tasks/:id` | Update / delete |
| GET | `/api/activity?limit=` | Activity feed |
| GET / PUT | `/api/settings` | Per-user settings blob |
| GET | `/api/events?token=` | SSE stream (`task:*`, `activity:new`, `settings:update`) |
| GET | `/health` | Liveness |

Send the token as `Authorization: Bearer <token>`.

Tasks carry: `title, description, notes, status, priority, dueDate, startDate,
estimateMinutes, recurring, tags[], checklist[], attachments[], archived,
completedAt, createdAt, updatedAt`.

## Notes

- All data lives in `data.json` next to `server.js`. Delete it to reset.
- Settings persist server-side (per user) and mirror to `localStorage` for instant paint.
- Fonts (JetBrains Mono, Plus Jakarta Sans) load from Google Fonts with full local
  fallbacks — the UI is completely styled offline.
