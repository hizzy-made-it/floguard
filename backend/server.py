from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, UploadFile, File, Header, Query
from fastapi.responses import StreamingResponse, Response
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from bson import ObjectId
import os
import io
import asyncio
import logging
import html
import time
from collections import defaultdict
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Deque
from collections import deque
from datetime import datetime, timezone, timedelta
import uuid
import bcrypt
import jwt

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', '').strip()
db_name = os.environ.get('DB_NAME', 'floguard')

if not mongo_url:
    raise RuntimeError("MONGO_URL environment variable is required")

# Ensure the URI has the database name before options for reliable parsing
if db_name:
    if '?' in mongo_url:
        base, opts = mongo_url.split('?', 1)
        if not base.endswith('/' + db_name) and not base.endswith(db_name):
            if base.endswith('/'):
                base += db_name
            else:
                base += '/' + db_name
        mongo_url = f"{base}?{opts}"
    else:
        if not mongo_url.endswith('/' + db_name):
            if mongo_url.endswith('/'):
                mongo_url += db_name
            else:
                mongo_url += '/' + db_name

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# GridFS for file storage (free, uses existing MongoDB)
fs = AsyncIOMotorGridFSBucket(db)

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---- Email (Resend) ----
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')
LEAD_NOTIFICATION_EMAIL = os.environ.get('LEAD_NOTIFICATION_EMAIL', 'heath@hdconnex.com')

# ---- GridFS Storage (free using MongoDB, no extra paid services needed) ----
APP_NAME = "floguard"

MIME_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
              "gif": "image/gif", "webp": "image/webp", "heic": "image/heic"}


async def upload_file_to_gridfs(data: bytes, filename: str, content_type: str) -> dict:
    """Upload file to MongoDB GridFS. Returns path (file_id) and url for serving."""
    file_id = await fs.upload_from_stream(
        filename,
        data,
        metadata={"contentType": content_type}
    )
    file_id_str = str(file_id)
    return {"path": file_id_str, "url": f"/api/files/{file_id_str}"}


async def get_file_from_gridfs(file_id_str: str):
    """Retrieve file data and content type from GridFS."""
    try:
        grid_out = await fs.open_download_stream(ObjectId(file_id_str))
        data = await grid_out.read()
        content_type = grid_out.metadata.get("contentType", "application/octet-stream") if grid_out.metadata else "application/octet-stream"
        return data, content_type
    except Exception:
        return None, None


# ---- Auth config ----
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_HOURS = 8
JWT_SECRET = os.environ.get("JWT_SECRET", "").strip()
if not JWT_SECRET:
    if os.environ.get("ALLOW_INSECURE_JWT", "").lower() not in ("1", "true", "yes"):
        raise RuntimeError("JWT_SECRET environment variable is required")
    JWT_SECRET = "insecure-dev-only-change-me"


# ---- Simple in-memory rate limiting (per-process; enough for single-instance deploy) ----
_rate_buckets: Dict[str, Deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request, *, key: str, limit: int, window_sec: int = 60) -> None:
    """Raise 429 if more than `limit` hits for (ip, key) within window_sec."""
    ip = _client_ip(request)
    bucket_key = f"{key}:{ip}"
    now = time.time()
    q = _rate_buckets[bucket_key]
    while q and q[0] < now - window_sec:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again shortly.")
    q.append(now)


def esc(value) -> str:
    """HTML-escape user-controlled strings for email bodies."""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_admin(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return {"id": str(user["_id"]), "email": user["email"], "name": user.get("name", "Admin"), "role": user.get("role", "admin")}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---- Models ----
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LeadCreate(BaseModel):
    name: str
    email: EmailStr
    phone: str = ""
    address: Optional[str] = ""
    location: Optional[str] = ""
    property_type: Optional[str] = Field(default="", alias="propertyType")
    issues: List[str] = []
    water_location: List[str] = []
    water_duration: Optional[str] = ""
    frequency: Optional[str] = ""
    affected_size: Optional[str] = ""
    existing_drainage: List[str] = []
    damages: List[str] = []
    timeline: Optional[str] = ""
    photos: List[str] = []
    message: Optional[str] = ""
    source: Optional[str] = "contact"
    # Honeypot: bots fill this; humans leave empty. Never persist.
    website: Optional[str] = ""
    model_config = ConfigDict(populate_by_name=True)


class Lead(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: str
    phone: str = ""
    address: str = ""
    location: str = ""
    property_type: str = ""
    issues: List[str] = []
    water_location: List[str] = []
    water_duration: str = ""
    frequency: str = ""
    affected_size: str = ""
    existing_drainage: List[str] = []
    damages: List[str] = []
    timeline: str = ""
    photos: List[str] = []
    message: str = ""
    source: str = "contact"
    status: str = "new"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class GuideRequest(BaseModel):
    name: str = "Homeowner"
    email: EmailStr


def _row(label, value):
    safe = esc(value) if value else "&mdash;"
    return f'<tr><td style="padding:6px 0;"><b>{esc(label)}</b></td><td>{safe}</td></tr>'


def build_lead_email(lead: Lead) -> str:
    def li(items):
        return "".join(f"<li>{esc(i)}</li>" for i in items) or "<li>None specified</li>"
    header = 'Guide Download' if lead.source == 'guide' else 'Assessment Request'
    photos_html = ""
    if lead.photos:
        photos_html = "<p style='color:#334155;'><b>Photos:</b> " + f"{len(lead.photos)} uploaded (view in dashboard)</p>"
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#1E2A52;">New FloGuard {header}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">
        {_row('Name', lead.name)}
        {_row('Phone', lead.phone)}
        {_row('Email', lead.email)}
        {_row('Property', lead.property_type)}
        {_row('Location', lead.location)}
        {_row('Address', lead.address)}
        {_row('Water lingers', lead.water_duration)}
        {_row('Frequency', lead.frequency)}
        {_row('Problem size', lead.affected_size)}
        {_row('Timeline', lead.timeline)}
        {_row('Source', lead.source)}
      </table>
      <p style="color:#334155;"><b>Issues:</b></p><ul style="color:#334155;">{li(lead.issues)}</ul>
      <p style="color:#334155;"><b>Where water collects:</b></p><ul style="color:#334155;">{li(lead.water_location)}</ul>
      <p style="color:#334155;"><b>Existing drainage:</b></p><ul style="color:#334155;">{li(lead.existing_drainage)}</ul>
      <p style="color:#334155;"><b>Damage seen:</b></p><ul style="color:#334155;">{li(lead.damages)}</ul>
      {photos_html}
      <p style="color:#334155;"><b>Message:</b> {esc(lead.message) if lead.message else '&mdash;'}</p>
      <p style="color:#F57C1F;font-size:12px;">Submitted {esc(lead.created_at)}</p>
    </div>"""


async def send_lead_email(lead: Lead) -> bool:
    """Returns True if email sent successfully. Always logs failures loudly for ops."""
    if not RESEND_API_KEY:
        logger.error(
            "LEAD_EMAIL_SKIPPED lead_id=%s reason=RESEND_API_KEY_missing source=%s",
            lead.id,
            lead.source,
        )
        return False
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [LEAD_NOTIFICATION_EMAIL],
            "subject": f"New {lead.source} lead — {lead.name} ({lead.location or 'FL'})",
            "html": build_lead_email(lead),
        }
        await asyncio.to_thread(resend.Emails.send, params)
        logger.info("LEAD_EMAIL_SENT lead_id=%s source=%s", lead.id, lead.source)
        return True
    except Exception as e:
        logger.error(
            "LEAD_EMAIL_FAILED lead_id=%s source=%s error=%s",
            lead.id,
            lead.source,
            str(e),
        )
        return False


def generate_guide_pdf() -> bytes:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    w, h = LETTER
    navy = colors.HexColor("#1E2A52")
    orange = colors.HexColor("#F57C1F")
    slate = colors.HexColor("#334155")

    # Cover
    c.setFillColor(navy); c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(orange); c.rect(0, h - 0.4 * inch, w, 0.4 * inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 40); c.drawString(1 * inch, h - 3 * inch, "The Florida")
    c.drawString(1 * inch, h - 3.7 * inch, "Drainage Guide")
    c.setFillColor(orange); c.setFont("Helvetica-Bold", 16)
    c.drawString(1 * inch, h - 4.3 * inch, "Protect your home from standing water & flooding")
    c.setFillColor(colors.white); c.setFont("Helvetica", 12)
    c.drawString(1 * inch, 1.2 * inch, "FloGuard, LLC  ·  Flood Solutions & Management")
    c.drawString(1 * inch, 1.0 * inch, "(386) 259-0023  ·  FloGuardFL.com  ·  Central Florida")
    c.showPage()

    # Content page
    def para(cnv, x, y, title, body):
        cnv.setFillColor(orange); cnv.setFont("Helvetica-Bold", 13); cnv.drawString(x, y, title)
        cnv.setFillColor(slate); cnv.setFont("Helvetica", 11)
        yy = y - 0.28 * inch
        for line in body:
            cnv.drawString(x, yy, line); yy -= 0.22 * inch
        return yy - 0.15 * inch

    c.setFillColor(navy); c.setFont("Helvetica-Bold", 22)
    c.drawString(1 * inch, h - 1 * inch, "How French Drain + Sump Pump Systems Work")
    y = h - 1.6 * inch
    sections = [
        ("1. Capture the water", ["Groundwater and surface runoff enter a fabric-lined,", "gravel-filled trench through a perforated pipe."]),
        ("2. Move it along a controlled path", ["The pipe carries water by gravity toward a low", "collection point, away from your foundation."]),
        ("3. Lift it when gravity can't", ["On flat lots or high water tables, water collects in a", "sump basin where an automatic pump takes over."]),
        ("4. Discharge it safely", ["The pump pushes water through a solid line to a safe", "spot — a swale, dry well, or storm drain."]),
        ("5 signs you may need drainage", ["- Standing water hours after rain", "- Damp crawlspace or musty smell", "- Cracks or moisture near the foundation", "- Soil erosion and dying grass", "- Flooded patio or lanai"]),
        ("Next step", ["Book a FREE on-site assessment with FloGuard.", "Call (386) 259-0023 or visit FloGuardFL.com."]),
    ]
    for title, body in sections:
        y = para(c, 1 * inch, y, title, body)
    c.setFillColor(orange); c.rect(0, 0, w, 0.3 * inch, fill=1, stroke=0)
    c.showPage()
    c.save()
    return buf.getvalue()


# ---- Auth routes ----
@api_router.post("/auth/login")
async def login(payload: LoginRequest, request: Request):
    email = payload.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    ident = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": ident})
    if attempt and attempt.get("count", 0) >= 5:
        locked_until = attempt.get("locked_until")
        if locked_until and datetime.now(timezone.utc) < datetime.fromisoformat(locked_until):
            raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        new_count = (attempt.get("count", 0) + 1) if attempt else 1
        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$set": {"identifier": ident, "count": new_count,
                      "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat() if new_count >= 5 else None}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    await db.login_attempts.delete_one({"identifier": ident})
    token = create_access_token(str(user["_id"]), user["email"])
    return {"token": token, "user": {"id": str(user["_id"]), "email": user["email"], "name": user.get("name", "Admin"), "role": user.get("role", "admin")}}


@api_router.get("/auth/me")
async def me(admin: dict = Depends(get_current_admin)):
    return admin


# ---- Public routes ----
@api_router.get("/")
async def root():
    return {"message": "FloGuard API"}


@api_router.get("/health")
async def health():
    """Liveness + Mongo connectivity for uptime monitors."""
    try:
        await db.command("ping")
        return {"status": "ok", "mongo": "up", "ts": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        logger.error("HEALTH_CHECK_FAILED error=%s", str(e))
        raise HTTPException(status_code=503, detail="Database unavailable")


@api_router.post("/upload")
async def upload(request: Request, file: UploadFile = File(...)):
    rate_limit(request, key="upload", limit=20, window_sec=3600)
    ext = (file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "jpg").lower()
    content_type = file.content_type or MIME_TYPES.get(ext, "application/octet-stream")
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="Only image files are allowed.")
    data = await file.read()
    if len(data) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 12MB).")
    filename = f"{APP_NAME}/leads/{uuid.uuid4()}.{ext}"
    try:
        result = await upload_file_to_gridfs(data, filename, content_type)
    except Exception as e:
        logger.error("Upload to GridFS failed: %s", str(e))
        raise HTTPException(status_code=502, detail="Upload failed. Please try again.")
    await db.files.insert_one({
        "id": str(uuid.uuid4()),
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": len(data),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": result["path"], "url": result["url"]}


@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    data, content_type = await get_file_from_gridfs(path)
    if data is None:
        raise HTTPException(status_code=404, detail="File not found")

    return Response(content=data, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=86400"})


@api_router.post("/leads", response_model=Lead)
async def create_lead(payload: LeadCreate, request: Request):
    rate_limit(request, key="leads", limit=8, window_sec=600)
    if (payload.website or "").strip():
        return Lead(name="ignored", email=str(payload.email), source="honeypot")
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required.")
    lead = Lead(
        name=payload.name.strip(), email=payload.email, phone=(payload.phone or "").strip(),
        address=payload.address or "", location=payload.location or "",
        property_type=payload.property_type or "", issues=payload.issues or [],
        water_location=payload.water_location or [], water_duration=payload.water_duration or "",
        frequency=payload.frequency or "", affected_size=payload.affected_size or "",
        existing_drainage=payload.existing_drainage or [], damages=payload.damages or [],
        timeline=payload.timeline or "", photos=payload.photos or [],
        message=payload.message or "", source=payload.source or "contact",
    )
    doc = lead.model_dump()
    await db.leads.insert_one(doc)
    # Fire-and-forget email; failures are logged as LEAD_EMAIL_FAILED for alerting
    asyncio.create_task(send_lead_email(lead))
    return lead


@api_router.post("/guide")
async def request_guide(payload: GuideRequest, request: Request):
    rate_limit(request, key="guide", limit=10, window_sec=600)
    lead = Lead(name=payload.name.strip() or "Homeowner", email=payload.email, source="guide",
                message="Downloaded the Florida Drainage Guide")
    await db.leads.insert_one(lead.model_dump())
    asyncio.create_task(send_lead_email(lead))
    return {"status": "success", "download_url": "/api/guide/download"}


@api_router.get("/guide/download")
async def download_guide():
    pdf = await asyncio.to_thread(generate_guide_pdf)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": "attachment; filename=FloGuard-Florida-Drainage-Guide.pdf"})


# ---- Admin-protected routes ----
@api_router.get("/leads", response_model=List[Lead])
async def list_leads(admin: dict = Depends(get_current_admin)):
    leads = await db.leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return leads


@api_router.get("/leads/stats")
async def lead_stats(admin: dict = Depends(get_current_admin)):
    leads = await db.leads.find({}, {"_id": 0}).to_list(2000)
    by_source = {}
    for l in leads:
        by_source[l.get("source", "contact")] = by_source.get(l.get("source", "contact"), 0) + 1
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    recent = sum(1 for l in leads if l.get("created_at", "") >= week_ago)
    return {"total": len(leads), "recent_7d": recent, "by_source": by_source}


@api_router.patch("/leads/{lead_id}")
async def update_lead_status(lead_id: str, body: dict, admin: dict = Depends(get_current_admin)):
    status = body.get("status", "new")
    res = await db.leads.update_one({"id": lead_id}, {"$set": {"status": status}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"status": "updated"}


app.include_router(api_router)

_cors_raw = os.environ.get("CORS_ORIGINS", "https://www.floguardfl.com,https://floguardfl.com").strip()
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=_cors_origins if _cors_origins else ["https://www.floguardfl.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.login_attempts.create_index("identifier")
        await db.files.create_index("storage_path")
        await db.leads.create_index("created_at")
        await db.leads.create_index("source")
        await db.leads.create_index("status")
    except Exception as e:
        logger.warning("index creation: %s", e)
    logger.info("GridFS file storage initialized (using MongoDB)")
    admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "").strip()
    force_reset = os.environ.get("FORCE_ADMIN_PASSWORD_RESET", "").lower() in ("1", "true", "yes")
    if not admin_email or not admin_password:
        logger.warning("ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin seed")
    else:
        existing = await db.users.find_one({"email": admin_email})
        if existing is None:
            await db.users.insert_one({
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "name": "FloGuard Admin",
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            logger.info("Seeded admin %s", admin_email)
        elif force_reset:
            await db.users.update_one(
                {"email": admin_email},
                {"$set": {"password_hash": hash_password(admin_password)}},
            )
            logger.info("Force-reset admin password for %s", admin_email)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
