# MongoDB Atlas access for local development and Render

The active FastAPI entry point is `backend/main.py`. It reads `MONGODB_URI`
from `backend/.env` locally or the backend process environment on Render.
It uses the existing `SynapseAI` database. No application code change is
required to allow another source IP.

## Allow changing Wi-Fi and mobile-data IPs

1. Open the Atlas project containing your cluster.
2. Open **Database & Network Access / Network Access**, then the IP access list.
3. Choose **Add IP Address** and enter `0.0.0.0/0` (Allow Access from Anywhere).
4. Confirm and wait until the entry is active, then retry the application.

This allows connections from any IPv4 address; database authentication and TLS
are still required. Keep the database password private. This setting belongs
in Atlas, not in `.env` or the MongoDB connection string.

For more restricted access, allow your current development public IP and all
of the Render service's outbound CIDR ranges instead. Find those ranges under
the Render service's **Connect > Outbound** tab. End-user IPs do not need to
be added: only the backend connects to Atlas.

## Environment and startup

Local `backend/.env`:

```ini
MONGODB_URI=mongodb+srv://<database-user>:<encoded-password>@<cluster-host>/?retryWrites=true&w=majority
CLIENT_URL=http://localhost:5173
```

Keep your existing working URI and other settings. Percent-encode reserved
characters in URI credentials. Do not disable TLS or certificate validation.

From `backend`, run:

```powershell
uvicorn main:app --reload --port 8000
```

Restart the backend after changing `.env`.

For Render, set `MONGODB_URI` in the backend service's Environment settings.
With `backend` as the service root directory, use this start command:

```sh
uvicorn main:app --host 0.0.0.0 --port "$PORT"
```

Set backend `CLIENT_URL` to the exact frontend origin. Set the frontend's
`VITE_API_URL` to the HTTPS backend URL and rebuild the frontend. Never put
database credentials in frontend variables. This guide configures database
access only; it does not deploy services or change cross-site session cookies.

## Verify the connection without modifying data

Run from `backend` with its Python environment:

```powershell
python -c "from dotenv import load_dotenv; import os; from pymongo import MongoClient; load_dotenv('.env'); c=MongoClient(os.environ['MONGODB_URI'],serverSelectionTimeoutMS=10000); c.admin.command('ping'); print('MongoDB connection OK'); c.close()"
```

Repeat after switching to a mobile hotspot to verify the Atlas access rule.
A successful check on one network alone does not prove another IP is allowed.
If connection still fails, check cluster availability and network access to
Atlas port 27017. SMTP errors are separate from database connectivity.

References:
- https://www.mongodb.com/docs/atlas/security/ip-access-list/
- https://render.com/docs/outbound-ip-addresses
