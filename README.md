# ບໍລິຫານເງິນ (money-app)

Personal income/expense tracker — mobile-first PWA.

- **Frontend:** plain HTML/CSS/JS (no build step), Chart.js, supabase-js via CDN
- **Database/Auth:** Supabase project `money-app` (`eieeessmqfavwtmzzaoc`, Singapore)
- **Hosting:** Vercel (static)

## Files
| File | Purpose |
|---|---|
| `index.html` | All screens: login, home, transactions, plan, dashboard, sheets |
| `app.js` | App logic |
| `config.js` | Supabase URL + publishable key (safe to be public — RLS protects data) |
| `style.css` | Styles |
| `sw.js`, `manifest.json`, `icon*` | PWA (install to home screen) |

## Database
- `categories`, `transactions`, `budgets` — all with RLS `user_id = auth.uid()`
- Trigger seeds default Lao categories on sign-up
- RPCs: `get_balance()`, `get_monthly_summary(from,to)`, `get_category_summary(from,to)`
- Amounts are `bigint` kip (no decimals)

## Run locally
Any static server, e.g. `npx serve .` then open http://localhost:3000
