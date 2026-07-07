from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
import io
import asyncio
import logging
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import uuid
import bcrypt
import jwt

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---- Email (Resend) ----
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')
LEAD_NOTIFICATION_EMAIL = os.environ.get('LEAD_NOTIFICATION_EMAIL', 'sales@floguardfl.com')

# ---- Auth config ----
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_HOURS = 8


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
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


async def get_current_admin(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
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
    message: Optional[str] = ""
    source: Optional[str] = "contact"
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
    message: str = ""
    source: str = "contact"
    status: str = "new"
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class GuideRequest(BaseModel):
    name: str = "Homeowner"
    email: EmailStr


def build_lead_email(lead: Lead) -> str:
    issues = "".join(f"<li>{i}</li>" for i in lead.issues) or "<li>None specified</li>"
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#1E2A52;">New FloGuard {('Guide Download' if lead.source=='guide' else 'Assessment Request')}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">
        <tr><td style="padding:6px 0;"><b>Name</b></td><td>{lead.name}</td></tr>
        <tr><td style="padding:6px 0;"><b>Phone</b></td><td>{lead.phone or '—'}</td></tr>
        <tr><td style="padding:6px 0;"><b>Email</b></td><td>{lead.email}</td></tr>
        <tr><td style="padding:6px 0;"><b>Property</b></td><td>{lead.property_type or '—'}</td></tr>
        <tr><td style="padding:6px 0;"><b>Location</b></td><td>{lead.location or '—'}</td></tr>
        <tr><td style="padding:6px 0;"><b>Source</b></td><td>{lead.source}</td></tr>
      </table>
      <p style="color:#334155;"><b>Issues:</b></p><ul style="color:#334155;">{issues}</ul>
      <p style="color:#334155;"><b>Message:</b> {lead.message or '—'}</p>
      <p style="color:#F57C1F;font-size:12px;">Submitted {lead.created_at}</p>
    </div>"""


async def send_lead_email(lead: Lead):
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping email for lead %s", lead.id)
        return
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
        logger.info("Lead email sent for %s", lead.id)
    except Exception as e:
        logger.error("Failed to send lead email: %s", str(e))


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


@api_router.post("/leads", response_model=Lead)
async def create_lead(payload: LeadCreate):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="Name is required.")
    lead = Lead(
        name=payload.name.strip(), email=payload.email, phone=(payload.phone or "").strip(),
        address=payload.address or "", location=payload.location or "",
        property_type=payload.property_type or "", issues=payload.issues or [],
        message=payload.message or "", source=payload.source or "contact",
    )
    await db.leads.insert_one(lead.model_dump())
    asyncio.create_task(send_lead_email(lead))
    return lead


@api_router.post("/guide")
async def request_guide(payload: GuideRequest):
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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.login_attempts.create_index("identifier")
    except Exception as e:
        logger.warning("index creation: %s", e)
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@floguardfl.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_password),
                                   "name": "FloGuard Admin", "role": "admin", "created_at": datetime.now(timezone.utc).isoformat()})
        logger.info("Seeded admin %s", admin_email)
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
        logger.info("Updated admin password for %s", admin_email)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
