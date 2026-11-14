# Putting Lost in the Spectrum online

## Render (current setup, free)

`render.yaml` in this repo describes two free Render services:

| Service | What it is | Sleeps? |
|---|---|---|
| `spectrum-nasa` | The website: pages, guide and the pre-built Featured frames (static files) | Never |
| `spectrum-nasa-api` | Live search: finds and stacks SPHEREx exposures (Python, Virginia region, next to the SPHEREx files on AWS us-east-1) | After 15 idle minutes; wakes in about a minute |

The website wakes the search server as soon as anyone opens a page and tells visitors while it
wakes. Featured targets never need it.

**Set up once:**
1. Sign in at **dashboard.render.com** with GitHub.
2. **New → Blueprint**, pick this repository, click **Apply**. Both services build (about 5 minutes).
3. Check `https://spectrum-nasa-api.onrender.com/api/health` shows `{"ok":true}`, then open
   `https://spectrum-nasa.onrender.com`.

If Render gives the search server a different address (it adds a suffix when a name is taken),
put that address in `VITE_API_BASE` in `render.yaml` and push.

Every push to `main` redeploys both services.

**Free-plan limits:** 512 MB of memory and a tenth of a CPU for live search, so a new search is
slower than on a desktop. The server runs one search at a time (others queue) and keeps a small
download cache (`LITS_CUTOUT_CACHE_MB`, `LITS_SEQ_CACHE_MB`). To make it faster and stop it
sleeping, change `plan: free` to `starter` (paid) for `spectrum-nasa-api`.

## Any Docker host

The `Dockerfile` builds one container that serves everything (website, Featured and live search):

```bash
docker build -t lits .
docker run -p 8080:8080 lits      # http://localhost:8080
```

On Google Cloud Run use instance-based billing with minimum and maximum instances set to 1
(search progress lives in one process).

## Settings

| Variable | Meaning |
|---|---|
| `VITE_API_BASE` | Website build only: address of the live-search server, if it isn't the same site |
| `LITS_CACHE_DIR` | Download cache folder |
| `LITS_CUTOUT_CACHE_MB` / `LITS_SEQ_CACHE_MB` | Cache size caps; oldest files go first (0 = no cap) |
| `LITS_BUILD_WORKERS` | Searches built at once (default 2) |
| `LITS_MAX_PARALLEL` | Exposure downloads at once (default 8) |
| `LITS_MAX_ACTIVE_JOBS` | Past this many unfinished searches, new ones get a polite "busy" message (default 8) |
