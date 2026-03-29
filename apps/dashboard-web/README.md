## Dashboard Web

Next.js + TypeScript frontend for the ScholarPulse dashboard.

### Local Dev

1. Start the Python API from the repo root:
	`make run-dashboard-api`
2. Copy `.env.example` to `.env.local` if needed.
3. Run the web app:
	`NEXT_PUBLIC_DASHBOARD_API_URL=http://127.0.0.1:8051/api npm run dev`

Open `http://127.0.0.1:3000`.

### Scripts

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run lint`
- `npm run typecheck`
