# Putting Lost in the Spectrum online (Google Cloud Run)

The whole site (pages, the pre-built Featured frames and live search) runs as **one container**
built from the `Dockerfile` in this repo. Google Cloud builds it straight from GitHub, so nothing
needs installing on your own computer, and every push to `main` redeploys automatically.

Button names in the Google Cloud console change from time to time; if a label below doesn't
match exactly, look for the closest one.

## 1. One-time account setup

1. Go to **cloud.google.com/free** and start the free trial with your Google account
   (a card is asked for to verify identity; the trial doesn't charge it).
2. In the console, create a project, e.g. **lost-in-the-spectrum**.
3. Optional but sensible: **Billing → Budgets & alerts → Create budget**, e.g. $100, with email
   alerts. (A budget only warns; it doesn't switch anything off.)

## 2. Create the service

**Cloud Run → Create service** (or **Deploy container → Service**), then:

| Setting | Value | Why |
|---|---|---|
| Source | **Continuously deploy from a repository** → **Set up with Cloud Build** | Builds from GitHub on every push |
| Repository | GitHub → authorise → pick this repo | |
| Branch | `^main$` | |
| Build type | **Dockerfile**, location `/Dockerfile` | |
| Service name | `lost-in-the-spectrum` | Becomes part of the web address |
| Region | **us-east4 (Northern Virginia)** | Next to the SPHEREx files on AWS us-east-1, so downloads are fast |
| Authentication | **Allow public access** (allow unauthenticated invocations) | It's a public website |
| Billing | **Instance-based** (CPU always allocated) | Live searches keep working between page requests |
| Minimum instances | **1** | No wake-up wait for visitors |
| Maximum instances | **1** | Search progress lives in one process |
| Container port | `8080` | |
| Memory / CPU | **2 GiB / 1 vCPU** | |
| Startup CPU boost | On | Faster restarts |

Click **Create**. The first build takes about 5–10 minutes; the web address (`https://…run.app`)
appears at the top of the service page when it's done.

Rough cost at these settings: about $50 a month, paid from the trial's $300 credit
(1 vCPU and 2 GiB kept on all month, at Cloud Run's instance-based Tier 1 rates, after the free allowance).

## 3. Check it

- `https://<your-address>/api/health` should show `{"ok":true}`.
- Open the site, try a Featured card (instant) and a live search (e.g. "Vega").

## Settings the container already has

| Variable | Value | Meaning |
|---|---|---|
| `LITS_CACHE_DIR` | `/tmp/lits-cache` | Download cache (Cloud Run keeps this in memory) |
| `LITS_CUTOUT_CACHE_MB` | `400` | Oldest raw cutouts are deleted past this |
| `LITS_SEQ_CACHE_MB` | `150` | Oldest finished sequences are deleted past this |
| `LITS_MAX_ACTIVE_JOBS` | `8` (default) | Past this many unfinished searches, new ones get a polite "busy" message |

## Running the same container elsewhere

```bash
docker build -t lits .
docker run -p 8080:8080 lits      # http://localhost:8080
```

It also runs unchanged on Render (Docker web service) or any host that runs containers.
