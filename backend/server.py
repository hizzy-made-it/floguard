from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---- Email (Resend) config ----
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')
LEAD_NOTIFICATION_EMAIL = os.environ.get('LEAD_NOTIFICATION_EMAIL', 'info@floguardfl.com')


# ---- Models ----
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


class LeadCreate(BaseModel):
    name: str
    email: EmailStr
    phone: str
    address: Optional[str] = ""
    location: Optional[str] = ""
    property_type: Optional[str] = Field(default="", alias="propertyType")
    issues: List[str] = []
    message: Optional[str] = ""

    model_config = ConfigDict(populate_by_name=True)


class Lead(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: str
    phone: str
    address: str = ""
    location: str = ""
    property_type: str = ""
    issues: List[str] = []
    message: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def build_lead_email(lead: Lead) -> str:
    issues = "".join(f"<li>{i}</li>" for i in lead.issues) or "<li>None specified</li>"
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
      <h2 style="color:#1E2A52;">New FloGuard Assessment Request</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#334155;">
        <tr><td style="padding:6px 0;"><b>Name</b></td><td>{lead.name}</td></tr>
        <tr><td style="padding:6px 0;"><b>Phone</b></td><td>{lead.phone}</td></tr>
        <tr><td style="padding:6px 0;"><b>Email</b></td><td>{lead.email}</td></tr>
        <tr><td style="padding:6px 0;"><b>Property</b></td><td>{lead.property_type}</td></tr>
        <tr><td style="padding:6px 0;"><b>Location</b></td><td>{lead.location}</td></tr>
        <tr><td style="padding:6px 0;"><b>Address</b></td><td>{lead.address or '—'}</td></tr>
      </table>
      <p style="color:#334155;"><b>Issues reported:</b></p>
      <ul style="color:#334155;">{issues}</ul>
      <p style="color:#334155;"><b>Message:</b> {lead.message or '—'}</p>
      <p style="color:#F57C1F;font-size:12px;">Submitted {lead.created_at}</p>
    </div>
    """


async def send_lead_email(lead: Lead):
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping email notification for lead %s", lead.id)
        return
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        params = {
            "from": SENDER_EMAIL,
            "to": [LEAD_NOTIFICATION_EMAIL],
            "subject": f"New drainage assessment — {lead.name} ({lead.location})",
            "html": build_lead_email(lead),
        }
        await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Lead notification email sent for %s", lead.id)
    except Exception as e:
        logger.error("Failed to send lead email: %s", str(e))


# ---- Routes ----
@api_router.get("/")
async def root():
    return {"message": "FloGuard API"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_obj = StatusCheck(**input.model_dump())
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    await db.status_checks.insert_one(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for c in checks:
        if isinstance(c['timestamp'], str):
            c['timestamp'] = datetime.fromisoformat(c['timestamp'])
    return checks


@api_router.post("/leads", response_model=Lead)
async def create_lead(payload: LeadCreate):
    if not payload.name.strip() or not payload.phone.strip():
        raise HTTPException(status_code=422, detail="Name and phone are required.")
    lead = Lead(
        name=payload.name.strip(),
        email=payload.email,
        phone=payload.phone.strip(),
        address=payload.address or "",
        location=payload.location or "",
        property_type=payload.property_type or "",
        issues=payload.issues or [],
        message=payload.message or "",
    )
    await db.leads.insert_one(lead.model_dump())
    # Fire-and-forget email so the response is fast
    asyncio.create_task(send_lead_email(lead))
    return lead


@api_router.get("/leads", response_model=List[Lead])
async def list_leads():
    leads = await db.leads.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return leads


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
