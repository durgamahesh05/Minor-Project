"""Synapse's unified FastAPI backend (API, Mongo persistence, and AI scaffold)."""
import hashlib, os, re, secrets, logging, sys, asyncio, threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
import bcrypt
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from pymongo import DESCENDING
from starlette.middleware.sessions import SessionMiddleware
from db import create_mongo_client, get_database
from lib.document_storage import delete_document, signed_download_url, sync_upload_metadata, delete_upload_metadata
from lib.otp import generate_otp
from lib.emails import account_deleted_email, deletion_request_email, email_configured, outbox, password_reset_email, verification_email
from lib.validate_password import is_valid_password
from middleware.auth import require_admin, require_auth
from ingestion.file_router import FILE_TOO_LARGE, MAX_ATTACHMENTS, MAX_FILE_SIZE, SUPPORTED_EXTENSIONS, supported_formats_message, upload_config
from rag.resources import resources as io_resources
from rag.response_policy import ResponseLevel
from rag.study_materials import StudyMaterialGenerator

# Authentication and health checks do not need the AI/vector-store imports.
def get_rag(*args, **kwargs):
 from rag.pipeline import get_rag as implementation
 return implementation(*args, **kwargs)

def delete_document_artifacts(*args, **kwargs):
 from rag.pipeline import delete_document_artifacts as implementation
 return implementation(*args, **kwargs)

def close_rag_instances():
 pipeline = sys.modules.get("rag.pipeline")
 if pipeline is not None: pipeline.close_rag_instances()

def warm_up_models():
 # Load the embedding model and OCR engine at startup instead of during the first upload.
 try:
  from rag.pipeline import groq_api_keys
  if groq_api_keys():get_rag(db).embedder.embed(["warm up"])
 except Exception as error:logging.warning("Embedding model warm-up skipped (%s)",type(error).__name__)
 try:
  from ingestion.image_reader import ocr_engine
  ocr_engine()
 except Exception as error:logging.warning("OCR engine warm-up skipped (%s: %s)",type(error).__name__,error)

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
 from database_indexes import ensure_indexes
 index_task=asyncio.create_task(asyncio.to_thread(ensure_indexes,db))
 if os.getenv("PRELOAD_MODELS","true").strip().lower() not in ("0","false","no","off"):
  threading.Thread(target=warm_up_models,name="model-warmup",daemon=True).start()
 try:
  yield
 finally:
  await index_task
  try:
   io_resources.close()
   close_rag_instances()
   outbox.close()
   if _vector_status["store"] is not None:_vector_status["store"].close()
  finally:
   mongo_client.close()

logging.basicConfig(level=logging.INFO)
load_dotenv(Path(__file__).resolve().parent / ".env")
app: FastAPI = FastAPI(title="Synapse API", lifespan=lifespan)
is_production = os.getenv("ENVIRONMENT", "development").lower() == "production"
session_secret = os.getenv("SESSION_SECRET", "replace-in-production")
if is_production and session_secret == "replace-in-production":
 raise RuntimeError("Set SESSION_SECRET to a unique random value in production.")
app.add_middleware(
 SessionMiddleware,
 secret_key=session_secret,
 max_age=604800,
 same_site="none" if is_production else "lax",
 https_only=is_production,
)
client_origins = [
 origin.strip().rstrip("/")
 for origin in os.getenv("CLIENT_URL", "http://localhost:5173").split(",")
 if origin.strip()
]
app.add_middleware(
 CORSMiddleware,
 allow_origins=client_origins,
 allow_origin_regex=os.getenv("VERCEL_PREVIEW_ORIGIN_REGEX") or None,
 allow_credentials=True,
 allow_methods=["*"],
 allow_headers=["*"],
)
mongo_client=create_mongo_client()
db=get_database(mongo_client);app.state.db=db; uploads=Path(__file__).parent/"uploads"

@app.exception_handler(HTTPException)
async def handle_http_error(request: Request, error: HTTPException):
 return JSONResponse(status_code=error.status_code,content={"message":error.detail},headers=error.headers)

MAX_DOCUMENT_SIZE=MAX_FILE_SIZE
fallback="I'm Synapse. I can help you understand your documents, generate flashcards, quiz you, and create summaries."
class Data(BaseModel):
 documentIds:list[str]|None=None
 prompt:str|None=None
 sourceMode:str="documents"
 responseLevel:ResponseLevel="simple"
 # UI language code (en, hi, te, es, fr) or "auto" to answer in the user's own language.
 language:str|None=None
 # Admin: role to assign to a user ("user" or "admin").
 role:str|None=None
 name:str|None=None;email:str|None=None;password:str|None=None;confirmPassword:str|None=None;otp:str|None=None;token:str|None=None;title:str|None=None;text:str|None=None;documentId:str|None=None;question:str|None=None;conversation_id:str|None=None
def now(): return datetime.now(timezone.utc)
def dig(v): return hashlib.sha256(v.encode()).hexdigest()
def oid(v):
 try:return ObjectId(v)
 except:raise HTTPException(404,"Resource not found")
def view(d,drop=()):
 r={k:v for k,v in d.items() if k not in set(drop)|{"_id","userId","conversationId","passwordHash","otpHash","otpExpiresAt","resetTokenHash","resetTokenExpiresAt","storedFilename","storagePath","supabaseMetadataId","extractedText","chunks"}};r["id"]=str(d["_id"])
 for k,v in r.items():
  if isinstance(v,(ObjectId,datetime)):r[k]=str(v) if isinstance(v,ObjectId) else v.isoformat()
 return r
user=require_auth
admin=require_admin
def public(x):return {"id":str(x["_id"]),"name":x["name"],"email":x["email"],"role":x.get("role","user")}
def owned(collection,ident,u):
 x=db[collection].find_one({"_id":oid(ident),"userId":u["_id"]})
 if not x:raise HTTPException(404,"Resource not found")
 return x

def chat_document(document_id,u) -> ObjectId | None:
 if document_id:
  document=owned("documents",document_id,u)
  if document.get("status")!="indexed":raise HTTPException(409,"This document is not ready for questions. Wait for indexing to finish, or upload it again if processing failed.")
  return document["_id"]
 if db.documents.find_one({"userId":u["_id"],"status":{"$in":["uploading","processing"]}}):
  raise HTTPException(409,"A document is still being indexed. Please wait before sending your question.")
 return None
def selected_documents(b, u) -> list[ObjectId]:
 ids=list(dict.fromkeys(b.documentIds or ([b.documentId] if b.documentId else [])))
 if len(ids)>MAX_ATTACHMENTS:raise HTTPException(400,f"Attach up to {MAX_ATTACHMENTS} files per message")
 if not ids:
  chat_document(None,u)
  return []
 document_ids: list[ObjectId] = []
 for ident in ids:
  document_id = chat_document(ident,u)
  if document_id is not None:
   document_ids.append(document_id)
 return document_ids

def password_ok(password):return is_valid_password(password or "")

def env_int(name,default,minimum=1):
 try:return max(minimum,int(os.getenv(name,str(default))))
 except ValueError:return default

# OTP rules are configurable and returned to the frontend, which shows matching countdowns.
OTP_TTL_SECONDS=env_int("OTP_TTL_MINUTES",10)*60
OTP_RESEND_COOLDOWN_SECONDS=env_int("OTP_RESEND_COOLDOWN_SECONDS",60,0)
OTP_MAX_ATTEMPTS=env_int("OTP_MAX_ATTEMPTS",5)
OTP_MAX_RESENDS=env_int("OTP_MAX_RESENDS",5)
DELETED_EMAIL_BLOCK_DAYS=30

def is_development():return os.getenv("ENVIRONMENT","development").lower()!="production"

def deliver_email(recipient,email):
 """Queue an email; returns False when no mail server is configured."""
 if not email_configured():return False
 outbox.send(recipient,email)
 return True

def otp_response(message,email,code,sent,expires_in=None):
 # Only expose an OTP when explicitly in local development and no mailer exists.
 result={"message":message if sent else "Email is not configured. Use the development verification code shown in the app.","email":email,
  "expiresIn":expires_in if expires_in is not None else OTP_TTL_SECONDS,"resendCooldown":OTP_RESEND_COOLDOWN_SECONDS}
 if not sent and is_development():result["otp"]=code
 return result

def seconds_since(moment):return (now()-moment).total_seconds() if moment else float("inf")

def enforce_resend_cooldown(last_sent_at,resend_count):
 elapsed=seconds_since(last_sent_at)
 if elapsed<OTP_RESEND_COOLDOWN_SECONDS:raise HTTPException(429,f"Please wait {int(OTP_RESEND_COOLDOWN_SECONDS-elapsed)+1} seconds before requesting another code")
 if resend_count>=OTP_MAX_RESENDS:raise HTTPException(429,"Code resend limit reached. Please try again later.")

def check_otp(collection,record,code,hash_field,attempts_field,expires_field):
 """Constant-time OTP check with a per-code attempt limit."""
 if not record or not record.get(hash_field) or not record.get(expires_field) or record[expires_field]<=now():
  raise HTTPException(400,"That code is invalid or has expired. Request a new one.")
 attempts=record.get(attempts_field,0)
 if attempts>=OTP_MAX_ATTEMPTS:raise HTTPException(429,"Too many incorrect attempts. Request a new code.")
 if not re.fullmatch(r"\d{6}",code or "") or not secrets.compare_digest(record[hash_field],dig(code)):
  attempts+=1;db[collection].update_one({"_id":record["_id"]},{"$set":{attempts_field:attempts}})
  if attempts>=OTP_MAX_ATTEMPTS:raise HTTPException(429,"Too many incorrect attempts. Request a new code.")
  raise HTTPException(400,f"Incorrect code. {OTP_MAX_ATTEMPTS-attempts} attempts remaining.")

def admin_emails():
 return {value.strip().lower() for value in os.getenv("ADMIN_EMAILS","").split(",") if value.strip()}

def sync_admin_role(account):
 """Accounts listed in ADMIN_EMAILS become admins when they sign in."""
 if account and account.get("role")!="admin" and account.get("email","").lower() in admin_emails():
  db.users.update_one({"_id":account["_id"]},{"$set":{"role":"admin","updatedAt":now()}});account["role"]="admin"
 return account

@app.api_route("/",methods=["GET","HEAD"])
def root(): return {"service":"synapse-api","status":"ok"}
@app.api_route("/health",methods=["GET","HEAD"])
def health(): return {"status":"ok"}
@app.get("/health/chroma")
def chroma_health():
 if os.getenv("VECTOR_STORE", "supabase").lower()!="chroma":return {"status":"not active","provider":os.getenv("VECTOR_STORE","supabase")}
 try:
  from vectorstore.chroma import chroma_client
  client=chroma_client()
  collections=[c if isinstance(c,str) else c.name for c in client.list_collections()]
  return {"status":"ok","mode":os.getenv("CHROMA_MODE","local"),"collections":[{"name":c,"count":client.get_collection(c,embedding_function=None).count()} for c in collections]}
 except Exception as error:
  logging.error("Chroma health check failed (%s)",type(error).__name__)
  raise HTTPException(503,"Chroma is unavailable. Check its installation and backend configuration.") from error
@app.post("/api/rag/query")
def rag(body:Data,u=Depends(user)):
 if not body.question or not body.question.strip():raise HTTPException(400,"Question is required")
 document_id=chat_document(body.documentId,u)
 try:result=get_rag(db).answer(body.question.strip(),u["_id"],document_id=document_id,language=body.language);return {"answer":result.answer,"sources":result.sources}
 except Exception as error:raise HTTPException(502,f"RAG query failed: {error}") from error

@app.get("/api/auth/otp-config")
def otp_config():
 return {"expiresIn":OTP_TTL_SECONDS,"resendCooldown":OTP_RESEND_COOLDOWN_SECONDS,"maxAttempts":OTP_MAX_ATTEMPTS,"codeLength":6}

@app.post("/api/auth/register")
def register(b:Data):
 if not b.name or not b.email or not b.password or not password_ok(b.password):raise HTTPException(400,"Name, email and a valid password are required")
 email=b.email.strip().lower();name=b.name.strip()
 if not valid_email(email):raise HTTPException(400,"Enter a valid email address")
 if db.users.find_one({"email":email}):raise HTTPException(409,"An account with this email already exists")
 if db.accountdeletions.find_one({"email":email,"deletedAt":{"$gt":now()-timedelta(days=DELETED_EMAIL_BLOCK_DAYS)}}):
  raise HTTPException(403,f"An account with this email was deleted recently. This email can be used again {DELETED_EMAIL_BLOCK_DAYS} days after deletion.")
 password_hash=bcrypt.hashpw(b.password.encode(),bcrypt.gensalt()).decode()
 pending=db.pendingregistrations.find_one({"email":email})
 if email_configured() and pending and pending.get("otpExpiresAt") and pending["otpExpiresAt"]>now() and seconds_since(pending.get("lastSentAt"))<OTP_RESEND_COOLDOWN_SECONDS:
  # Re-submitting the form right away keeps the code already sent instead of emailing again.
  # Without a mailer the code only exists in the response, so a fresh one is issued instead.
  db.pendingregistrations.update_one({"_id":pending["_id"]},{"$set":{"name":name,"passwordHash":password_hash,"updatedAt":now()}})
  remaining=int((pending["otpExpiresAt"]-now()).total_seconds())
  return {"message":"We already sent a verification code. Check your inbox.","email":email,"expiresIn":remaining,"resendCooldown":int(OTP_RESEND_COOLDOWN_SECONDS-seconds_since(pending.get("lastSentAt")))+1}
 code=generate_otp()
 db.pendingregistrations.update_one({"email":email},{"$set":{"name":name,"email":email,"passwordHash":password_hash,"otpHash":dig(code),"otpExpiresAt":now()+timedelta(seconds=OTP_TTL_SECONDS),"attempts":0,"resendCount":0,"lastSentAt":now(),"updatedAt":now()},"$setOnInsert":{"createdAt":now()}},upsert=True)
 sent=deliver_email(email,verification_email(name,email,code,OTP_TTL_SECONDS))
 return otp_response("Verification code sent.",email,code,sent)

@app.post("/api/auth/verify-registration",status_code=201)
def verify(b:Data,request:Request):
 p=db.pendingregistrations.find_one({"email":(b.email or '').strip().lower()})
 check_otp("pendingregistrations",p,(b.otp or "").strip(),"otpHash","attempts","otpExpiresAt")
 if db.users.find_one({"email":p["email"]}):
  db.pendingregistrations.delete_one({"_id":p["_id"]});raise HTTPException(409,"An account with this email already exists")
 x={"name":p["name"],"email":p["email"],"passwordHash":p["passwordHash"],"role":"admin" if p["email"] in admin_emails() else "user","createdAt":now(),"updatedAt":now()}
 x["_id"]=db.users.insert_one(x).inserted_id;db.pendingregistrations.delete_one({"_id":p["_id"]});request.session["userId"]=str(x["_id"]);return {"user":public(x)}

@app.post("/api/auth/resend-registration-otp")
def resend_registration_otp(b:Data):
 email=(b.email or "").strip().lower();pending=db.pendingregistrations.find_one({"email":email})
 if not pending:raise HTTPException(400,"No pending signup found for this email. Please sign up again.")
 enforce_resend_cooldown(pending.get("lastSentAt"),pending.get("resendCount",0))
 code=generate_otp()
 db.pendingregistrations.update_one({"_id":pending["_id"]},{"$set":{"otpHash":dig(code),"otpExpiresAt":now()+timedelta(seconds=OTP_TTL_SECONDS),"attempts":0,"lastSentAt":now()},"$inc":{"resendCount":1}})
 sent=deliver_email(email,verification_email(pending.get("name",""),email,code,OTP_TTL_SECONDS))
 return otp_response("Verification code sent.",email,code,sent)

@app.post("/api/auth/login")
def login(b:Data,request:Request):
 x=db.users.find_one({"email":(b.email or '').strip().lower()})
 if not x or not b.password or not bcrypt.checkpw(b.password.encode(),x["passwordHash"].encode()):raise HTTPException(401,"Invalid email or password")
 sync_admin_role(x);request.session["userId"]=str(x["_id"]);return {"user":public(x)}
@app.post("/api/auth/logout",status_code=204)
def logout(request:Request):request.session.clear()
@app.get("/api/auth/me")
def me(u=Depends(user)):return {"user":public(sync_admin_role(u))}

def valid_email(value):return bool(value and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",value.strip()))

@app.post("/api/auth/forgot-password")
def forgot_password(b:Data):
 if not b.email or not valid_email(b.email):raise HTTPException(400,"Enter a valid email address")
 email=b.email.strip().lower();x=db.users.find_one({"email":email})
 response={"message":"If an account exists for this email, an OTP has been sent.","expiresIn":OTP_TTL_SECONDS,"resendCooldown":OTP_RESEND_COOLDOWN_SECONDS}
 if not x:return response
 if not email_configured() and not is_development():raise HTTPException(503,"Email delivery is temporarily unavailable. Please try again later.")
 existing=db.passwordresetotps.find_one({"email":email})
 if email_configured() and existing and existing.get("otpHash") and existing.get("expiresAt",now())>now() and seconds_since(existing.get("lastSentAt"))<OTP_RESEND_COOLDOWN_SECONDS:
  # A second click within the cooldown keeps the code already sent (dev mode without a mailer issues a fresh one).
  response["expiresIn"]=int((existing["expiresAt"]-now()).total_seconds())
  response["resendCooldown"]=int(OTP_RESEND_COOLDOWN_SECONDS-seconds_since(existing.get("lastSentAt")))+1
  return response
 code=generate_otp()
 db.passwordresetotps.replace_one({"email":email},{"email":email,"userId":x["_id"],"otpHash":dig(code),"expiresAt":now()+timedelta(seconds=OTP_TTL_SECONDS),"attempts":0,"resendCount":0,"lastSentAt":now(),"createdAt":now()},upsert=True)
 sent=deliver_email(email,password_reset_email(x.get("name",""),email,code,OTP_TTL_SECONDS))
 if not sent and is_development():response["otp"]=code
 return response

@app.post("/api/auth/resend-password-otp")
def resend_password_otp(b:Data):
 if not b.email or not valid_email(b.email):raise HTTPException(400,"Enter a valid email address")
 email=b.email.strip().lower();record=db.passwordresetotps.find_one({"email":email})
 generic={"message":"If an account exists for this email, a new OTP has been sent.","expiresIn":OTP_TTL_SECONDS,"resendCooldown":OTP_RESEND_COOLDOWN_SECONDS}
 if not record:return generic
 enforce_resend_cooldown(record.get("lastSentAt"),record.get("resendCount",0))
 x=db.users.find_one({"_id":record["userId"]})
 if not x:db.passwordresetotps.delete_one({"_id":record["_id"]});return generic
 code=generate_otp()
 db.passwordresetotps.update_one({"_id":record["_id"]},{"$set":{"otpHash":dig(code),"expiresAt":now()+timedelta(seconds=OTP_TTL_SECONDS),"attempts":0,"lastSentAt":now()},"$inc":{"resendCount":1}})
 sent=deliver_email(email,password_reset_email(x.get("name",""),email,code,OTP_TTL_SECONDS))
 if not sent and is_development():generic["otp"]=code
 return generic

@app.post("/api/auth/verify-password-otp")
def verify_password_otp(b:Data):
 if not b.email or not valid_email(b.email) or not b.otp or not re.fullmatch(r"\d{6}",b.otp.strip()):raise HTTPException(400,"Enter a valid 6-digit OTP")
 record=db.passwordresetotps.find_one({"email":b.email.strip().lower()})
 check_otp("passwordresetotps",record,b.otp.strip(),"otpHash","attempts","expiresAt")
 token=secrets.token_urlsafe(32);db.passwordresetotps.update_one({"_id":record["_id"]},{"$set":{"resetTokenHash":dig(token),"expiresAt":now()+timedelta(seconds=OTP_TTL_SECONDS),"verifiedAt":now()},"$unset":{"otpHash":"","attempts":""}})
 return {"message":"OTP verified.","token":token,"expiresIn":OTP_TTL_SECONDS}

@app.post("/api/auth/reset-password")
def reset_password(b:Data):
 if not b.token:raise HTTPException(401,"Verify your OTP before resetting the password")
 if not b.password or not password_ok(b.password):raise HTTPException(400,"Password must be 7 or more characters and include uppercase, lowercase, a number, and a symbol")
 if b.password!=b.confirmPassword:raise HTTPException(400,"Passwords do not match")
 record=db.passwordresetotps.find_one({"resetTokenHash":dig(b.token),"verifiedAt":{"$exists":True},"expiresAt":{"$gt":now()}})
 if not record:raise HTTPException(400,"Your password reset authorization is invalid or has expired")
 result=db.users.update_one({"_id":record["userId"]},{"$set":{"passwordHash":bcrypt.hashpw(b.password.encode(),bcrypt.gensalt()).decode(),"updatedAt":now()}})
 db.passwordresetotps.delete_one({"_id":record["_id"]})
 if not result.matched_count:raise HTTPException(404,"The account no longer exists")
 return {"message":"Password updated. You can now log in."}

def purge_user(account,block_email):
 """Delete a user and everything they own; email them that it happened."""
 conversation_ids=[x["_id"] for x in db.conversations.find({"userId":account["_id"]},{"_id":1})]
 if conversation_ids:db.messages.delete_many({"conversationId":{"$in":conversation_ids}})
 db.conversations.delete_many({"userId":account["_id"]})
 for document in db.documents.find({"userId":account["_id"]}):
  delete_upload_metadata(document["_id"])
  delete_document_artifacts(db,document["_id"])
  if document.get("storageProvider")=="supabase":delete_document(document.get("storagePath"),document.get("supabaseMetadataId"))
  elif document.get("storageProvider")=="local" and document.get("storedFilename"):(uploads/document["storedFilename"]).unlink(missing_ok=True)
 db.documents.delete_many({"userId":account["_id"]});db.quizzes.delete_many({"userId":account["_id"]});db.flashcardsets.delete_many({"userId":account["_id"]})
 deleted_at=now()
 if block_email:db.accountdeletions.insert_one({"email":account["email"],"deletedAt":deleted_at})
 db.users.delete_one({"_id":account["_id"]})
 deliver_email(account["email"],account_deleted_email(account.get("name",""),deleted_at))

@app.post("/api/account/delete/request")
def request_account_deletion(u=Depends(user)):
 if u.get("role")=="admin" and db.users.count_documents({"role":"admin"})<=1:raise HTTPException(400,"You are the only admin. Make another user an admin before deleting your account.")
 if u.get("deleteOtpHash") and u.get("deleteOtpExpiresAt") and u["deleteOtpExpiresAt"]>now():
  elapsed=seconds_since(u.get("deleteOtpSentAt"))
  if elapsed<OTP_RESEND_COOLDOWN_SECONDS:raise HTTPException(429,f"Please wait {int(OTP_RESEND_COOLDOWN_SECONDS-elapsed)+1} seconds before requesting another code")
 code=generate_otp()
 db.users.update_one({"_id":u["_id"]},{"$set":{"deleteOtpHash":dig(code),"deleteOtpExpiresAt":now()+timedelta(seconds=OTP_TTL_SECONDS),"deleteOtpSentAt":now(),"deleteOtpAttempts":0}})
 sent=deliver_email(u["email"],deletion_request_email(u.get("name",""),code,OTP_TTL_SECONDS))
 return otp_response("Verification code sent.",u["email"],code,sent)

@app.post("/api/account/delete/confirm",status_code=204)
def confirm_account_deletion(b:Data,request:Request,u=Depends(user)):
 check_otp("users",u,(b.otp or "").strip(),"deleteOtpHash","deleteOtpAttempts","deleteOtpExpiresAt")
 if u.get("role")=="admin" and db.users.count_documents({"role":"admin"})<=1:raise HTTPException(400,"You are the only admin. Make another user an admin before deleting your account.")
 purge_user(u,block_email=True);request.session.clear()

@app.get("/api/chat/conversations")
def chats(u=Depends(user)):return {"conversations":[view(x) for x in db.conversations.find({"userId":u["_id"]}).sort("updatedAt",DESCENDING)]}
@app.post("/api/chat/conversations",status_code=201)
def new_chat(b:Data,u=Depends(user)):
 x={"userId":u["_id"],"title":(b.title or "New chat")[:80],"createdAt":now(),"updatedAt":now()};x["_id"]=db.conversations.insert_one(x).inserted_id;return {"conversation":view(x)}
@app.get("/api/chat/conversations/{ident}/messages")
def messages(ident:str,u=Depends(user)):
 x=owned("conversations",ident,u);return {"messages":[view(m) for m in db.messages.find({"conversationId":x["_id"]}).sort("createdAt",1)]}
def study_actions(text, document_id=None):
 if not re.search(r"\b(generate|create|make|prepare|build|give|quiz me)\b",text,re.I):return []
 if re.search(r"\b(don't|do not|don't want|do not want)\s+(?:\w+\s+){0,2}(generate|create|make|prepare|build|give)\b",text,re.I):return []
 kinds=[]
 if re.search(r"\b(quiz|quizzes|mcqs?)\b",text,re.I):kinds.append("quiz")
 if re.search(r"\bflash\s*cards?\b",text,re.I):kinds.append("flashcards")
 return [{"kind":kind,"prompt":text,"documentId":str(document_id) if document_id else None} for kind in kinds]

@app.post("/api/chat/conversations/{ident}/messages",status_code=201)
def message(ident:str,b:Data,u=Depends(user)):
 if not b.text or not b.text.strip():raise HTTPException(400,"Message text is required")
 c=owned("conversations",ident,u)
 document_ids=selected_documents(b,u)
 document_id=document_ids[0] if len(document_ids)==1 and document_ids[0] is not None else None
 actions=study_actions(b.text.strip(),document_id)
 try:
  if actions:
   generated=[];failures=[]
   for action in actions:
    kind=action["kind"]
    try:
     material=generate_study_material(Data(prompt=b.text.strip(),language=b.language,documentIds=[str(ident) for ident in document_ids],documentId=action["documentId"],sourceMode="documents" if document_ids or re.search(r"\b(document|documents|file|files|upload|uploaded|chapter|section|notes)\b",b.text,re.I) else "topic"),u,
      "quizzes" if kind=="quiz" else "flashcardsets","questions" if kind=="quiz" else "cards","Quiz" if kind=="quiz" else "Flashcards")
     generated.append({**action,"id":material["id"],"title":material["title"]})
    except HTTPException as error:
     failures.append(f"Could not generate {kind}: {error.detail}")
   actions=generated
   reply=("Your study materials are ready. Open them below to start studying." if generated else "") + ("\n\n" + "\n".join(failures) if failures else "")
  elif len(document_ids)>1:reply=get_rag(db).answer(b.text.strip(),u["_id"],document_ids=[ident for ident in document_ids if ident is not None],response_level=b.responseLevel,language=b.language).answer
  else:reply=get_rag(db).chat(b.text.strip(),u["_id"],document_id=document_id,response_level=b.responseLevel,language=b.language).answer
 except Exception as error:raise HTTPException(502,f"Unable to answer your message: {error}") from error
 a={"conversationId":c["_id"],"role":"user","text":b.text.strip(),"createdAt":now()}
 if document_ids:
  attachments=[]
  for document_object_id in document_ids:
   document=owned("documents",str(document_object_id),u)
   attachments.append({"id":str(document_object_id),"originalName":document.get("originalName","Document"),"mimeType":document.get("mimeType","application/octet-stream"),"size":document.get("size",0),"clientDocumentId":document.get("clientDocumentId"),"storageProvider":document.get("storageProvider")})
  a["attachments"]=attachments
  a["attachment"]=attachments[0]
 a["_id"]=db.messages.insert_one(a).inserted_id
 z={"conversationId":c["_id"],"role":"assistant","text":reply,"createdAt":now()}
 if actions:z["studyActions"]=actions
 z["_id"]=db.messages.insert_one(z).inserted_id;db.conversations.update_one({"_id":c["_id"]},{"$set":{"updatedAt":now()}});return {"userMessage":view(a),"assistantMessage":view(z)}
@app.patch("/api/chat/conversations/{ident}")
def rename_chat(ident:str,b:Data,u=Depends(user)):
 title=(b.title or "").strip()
 if not title or len(title)>80:raise HTTPException(400,"Chat title must contain 1 to 80 characters")
 c=owned("conversations",ident,u)
 db.conversations.update_one({"_id":c["_id"],"userId":u["_id"]},{"$set":{"title":title}})
 c["title"]=title
 return {"conversation":view(c)}

@app.delete("/api/chat/conversations/{ident}",status_code=204)
def remove_chat(ident:str,u=Depends(user)):
 c=owned("conversations",ident,u);db.messages.delete_many({"conversationId":c["_id"]});db.conversations.delete_one({"_id":c["_id"]})

@app.get("/api/documents/config")
def documents_config():return upload_config()
@app.get("/api/documents")
def documents(u=Depends(user)):return {"documents":[view(x) for x in db.documents.find({"userId":u["_id"]}).sort("createdAt",DESCENDING)]}
def mirror_upload_metadata(document):
 # Vector indexing is authoritative; a slow metadata mirror must not discard it.
 try:
  sync_upload_metadata(document)
 except Exception:
  logging.warning("Upload metadata sync failed for %s; indexed content remains available",document["_id"])
  db.documents.update_one({"_id":document["_id"]},{"$set":{"metadataSync":"failed"}})
 else:
  db.documents.update_one({"_id":document["_id"]},{"$set":{"metadataSync":"synced"}})

@app.post("/api/documents",status_code=201)
def upload(background_tasks:BackgroundTasks,file:UploadFile=File(...),client_document_id:str=Form(...),u=Depends(user)):
 original=file.filename or "upload";extension=Path(original).suffix.lower()
 if extension not in SUPPORTED_EXTENSIONS:raise HTTPException(400,supported_formats_message())
 if not re.fullmatch(r"[0-9a-fA-F-]{36}",client_document_id):raise HTTPException(400,"Invalid browser document ID")
 content=file.file.read(MAX_DOCUMENT_SIZE+1)
 if len(content)>MAX_DOCUMENT_SIZE:raise HTTPException(400,FILE_TOO_LARGE)
 x=None
 logging.getLogger(__name__).info("Upload received: %s (%d bytes)",original,len(content))
 try:
  x={"userId":u["_id"],"clientDocumentId":client_document_id,"originalName":original,"storageProvider":"browser-opfs","mimeType":file.content_type or "application/octet-stream","size":len(content),"status":"processing","createdAt":now(),"updatedAt":now()};x["_id"]=db.documents.insert_one(x).inserted_id
  element_count=get_rag(db).ingest(original,content,u["_id"],x["_id"])
  db.documents.update_one({"_id":x["_id"]},{"$set":{"status":"indexed","elementCount":element_count,"updatedAt":now()}});x["status"]="indexed";x["elementCount"]=element_count
  if background_tasks is not None:background_tasks.add_task(mirror_upload_metadata,x)
  else:mirror_upload_metadata(x)
  return {"document":view(x)}
 except Exception as error:
  logging.getLogger(__name__).exception("Document processing failed: %s",original)
  if x:
   try:delete_upload_metadata(x["_id"])
   except Exception:logging.error("Supabase metadata rollback failed")
   # A cleanup failure must not hide the original processing error.
   try:delete_document_artifacts(db,x["_id"])
   except Exception:logging.error("Vector cleanup failed for %s",x["_id"])
   db.documents.delete_one({"_id":x["_id"]})
  raise HTTPException(502,f"Document processing failed: {error}") from error
@app.get("/api/documents/{ident}/download")
def download(ident:str,u=Depends(user)):
 x=owned("documents",ident,u)
 if x.get("storageProvider")=="browser-opfs":raise HTTPException(409,"This file is stored in this browser's private storage")
 if x.get("storageProvider")=="supabase":return RedirectResponse(signed_download_url(x["storagePath"],x["originalName"]))
 if x.get("storageProvider")=="local" and x.get("storedFilename"):return FileResponse(uploads/x["storedFilename"],filename=x["originalName"],media_type=x["mimeType"])
 raise HTTPException(404,"The original file is no longer available")
@app.delete("/api/documents/{ident}",status_code=204)
def delete_doc(ident:str,u=Depends(user)):
 x=owned("documents",ident,u)
 if x.get("storageProvider")=="supabase":delete_document(x.get("storagePath"),x.get("supabaseMetadataId"))
 elif x.get("storageProvider")=="local" and x.get("storedFilename"):(uploads/x["storedFilename"]).unlink(missing_ok=True)
 delete_upload_metadata(x["_id"]);delete_document_artifacts(db,x["_id"]);db.documents.delete_one({"_id":x["_id"]})

ADMIN_LIST_LIMIT=env_int("ADMIN_LIST_LIMIT",200)

def owners_for(items):
 """Look up every owner in one query instead of one query per row."""
 ids=list({item.get("userId") for item in items if item.get("userId")})
 found={x["_id"]:{"id":str(x["_id"]),"name":x.get("name",""),"email":x.get("email","")} for x in db.users.find({"_id":{"$in":ids}},{"name":1,"email":1})} if ids else {}
 return lambda item:found.get(item.get("userId"))

def owner_value(document):return owners_for([document])(document)

def admin_filter(q,fields):
 q=(q or "").strip()
 if not q:return {}
 pattern={"$regex":re.escape(q[:100]),"$options":"i"}
 condition={"$or":[{field:pattern} for field in fields]}
 # Searching by owner name/email also matches content owned by those users.
 owner_ids=[x["_id"] for x in db.users.find({"$or":[{"name":pattern},{"email":pattern}]},{"_id":1}).limit(500)]
 if owner_ids and fields!=["name","email"]:condition["$or"].append({"userId":{"$in":owner_ids}})
 return condition

def list_limit(limit):return max(1,min(int(limit or ADMIN_LIST_LIMIT),1000))
def iso(value):return value.isoformat() if isinstance(value,datetime) else None

def counts_by_user(collection,user_ids):
 return {row["_id"]:row["count"] for row in db[collection].aggregate([{"$match":{"userId":{"$in":user_ids}}},{"$group":{"_id":"$userId","count":{"$sum":1}}}])} if user_ids else {}

@app.get("/api/admin/stats")
def admin_stats(_=Depends(admin)):
 week_ago=now()-timedelta(days=7)
 queries={
  "totalUsers":lambda:db.users.count_documents({}),"totalAdmins":lambda:db.users.count_documents({"role":"admin"}),
  "newUsersThisWeek":lambda:db.users.count_documents({"createdAt":{"$gte":week_ago}}),
  "totalDocuments":lambda:db.documents.count_documents({}),"indexedDocuments":lambda:db.documents.count_documents({"status":"indexed"}),
  "storageBytes":lambda:next(iter(db.documents.aggregate([{"$group":{"_id":None,"bytes":{"$sum":"$size"}}}])),{"bytes":0})["bytes"],
  "totalQuizzes":lambda:db.quizzes.count_documents({}),"totalFlashcardSets":lambda:db.flashcardsets.count_documents({}),
  "totalConversations":lambda:db.conversations.count_documents({}),"totalMessages":lambda:db.messages.estimated_document_count(),
  "pendingRegistrations":lambda:db.pendingregistrations.count_documents({}),
 }
 # The dashboard polls this; running the counts together costs one round trip instead of eleven.
 values=io_resources.map(lambda query:query(),list(queries.values()))
 return {**dict(zip(queries,values)),"generatedAt":now().isoformat()}

@app.get("/api/admin/users")
def admin_users(q:str|None=None,limit:int|None=None,_=Depends(admin)):
 query=admin_filter(q,["name","email"]);rows=list(db.users.find(query,{"passwordHash":0}).sort("createdAt",DESCENDING).limit(list_limit(limit)))
 ids=[x["_id"] for x in rows];counts={name:counts_by_user(name,ids) for name in ("documents","quizzes","flashcardsets","conversations")}
 return {"total":db.users.count_documents(query),"users":[{"id":str(x["_id"]),"name":x.get("name",""),"email":x.get("email",""),"role":x.get("role","user"),
  "createdAt":iso(x.get("createdAt")) or now().isoformat(),"isConfiguredAdmin":x.get("email","").lower() in admin_emails(),
  "documents":counts["documents"].get(x["_id"],0),"quizzes":counts["quizzes"].get(x["_id"],0),"flashcardSets":counts["flashcardsets"].get(x["_id"],0),"conversations":counts["conversations"].get(x["_id"],0)} for x in rows]}

@app.patch("/api/admin/users/{ident}")
def admin_update_user(ident:str,b:Data,request:Request,_=Depends(admin)):
 role=(b.role or "").strip().lower()
 if role not in ("user","admin"):raise HTTPException(400,"Role must be user or admin")
 if request.session.get("userId")==ident:raise HTTPException(400,"You can't change your own role")
 target=db.users.find_one({"_id":oid(ident)})
 if not target:raise HTTPException(404,"User not found")
 if role=="user" and target.get("email","").lower() in admin_emails():raise HTTPException(400,"This admin is listed in ADMIN_EMAILS. Remove it there first.")
 if role=="user" and target.get("role")=="admin" and db.users.count_documents({"role":"admin"})<=1:raise HTTPException(400,"At least one admin is required")
 db.users.update_one({"_id":target["_id"]},{"$set":{"role":role,"updatedAt":now()}})
 return {"user":{**public({**target,"role":role})}}

@app.delete("/api/admin/users/{ident}",status_code=204)
def admin_delete_user(ident:str,request:Request,_=Depends(admin)):
 target=oid(ident)
 if request.session.get("userId")==ident:raise HTTPException(400,"You can't delete your own account while logged in")
 victim=db.users.find_one({"_id":target})
 if not victim:raise HTTPException(404,"User not found")
 if victim.get("role")=="admin" and db.users.count_documents({"role":"admin"})<=1:raise HTTPException(400,"At least one admin is required")
 purge_user(victim,block_email=False)

@app.get("/api/admin/documents")
def admin_documents(q:str|None=None,limit:int|None=None,_=Depends(admin)):
 query=admin_filter(q,["originalName"]);rows=list(db.documents.find(query).sort("createdAt",DESCENDING).limit(list_limit(limit)));owner=owners_for(rows)
 return {"total":db.documents.count_documents(query),"documents":[{"id":str(x["_id"]),"originalName":x.get("originalName",""),"mimeType":x.get("mimeType",""),"size":x.get("size",0),"status":x.get("status",""),
  "elementCount":x.get("elementCount",0),"createdAt":iso(x.get("createdAt")) or now().isoformat(),"owner":owner(x)} for x in rows]}

@app.delete("/api/admin/documents/{ident}",status_code=204)
def admin_delete_document(ident:str,_=Depends(admin)):
 x=db.documents.find_one({"_id":oid(ident)})
 if not x:raise HTTPException(404,"Document not found")
 if x.get("storageProvider")=="supabase":delete_document(x.get("storagePath"),x.get("supabaseMetadataId"))
 elif x.get("storageProvider")=="local" and x.get("storedFilename"):(uploads/x["storedFilename"]).unlink(missing_ok=True)
 delete_upload_metadata(x["_id"]);delete_document_artifacts(db,x["_id"]);db.documents.delete_one({"_id":x["_id"]})

def admin_materials(collection,field,q,limit):
 query=admin_filter(q,["title"])
 rows=list(db[collection].aggregate([{"$match":query},{"$sort":{"createdAt":DESCENDING}},{"$limit":list_limit(limit)},{"$project":{"title":1,"userId":1,"createdAt":1,"count":{"$size":{"$ifNull":["$"+field,[]]}}}}]))
 return db[collection].count_documents(query),rows,owners_for(rows)

@app.get("/api/admin/quizzes")
def admin_quizzes(q:str|None=None,limit:int|None=None,_=Depends(admin)):
 total,rows,owner=admin_materials("quizzes","questions",q,limit)
 return {"total":total,"quizzes":[{"id":str(x["_id"]),"title":x.get("title",""),"questionCount":x["count"],"createdAt":iso(x.get("createdAt")) or now().isoformat(),"owner":owner(x)} for x in rows]}

@app.delete("/api/admin/quizzes/{ident}",status_code=204)
def admin_delete_quiz(ident:str,_=Depends(admin)):
 result=db.quizzes.delete_one({"_id":oid(ident)})
 if not result.deleted_count:raise HTTPException(404,"Quiz not found")

@app.get("/api/admin/flashcards")
def admin_flashcards(q:str|None=None,limit:int|None=None,_=Depends(admin)):
 total,rows,owner=admin_materials("flashcardsets","cards",q,limit)
 return {"total":total,"sets":[{"id":str(x["_id"]),"title":x.get("title",""),"cardCount":x["count"],"createdAt":iso(x.get("createdAt")) or now().isoformat(),"owner":owner(x)} for x in rows]}

@app.delete("/api/admin/flashcards/{ident}",status_code=204)
def admin_delete_flashcards(ident:str,_=Depends(admin)):
 result=db.flashcardsets.delete_one({"_id":oid(ident)})
 if not result.deleted_count:raise HTTPException(404,"Flashcard set not found")

@app.get("/api/admin/conversations")
def admin_conversations(q:str|None=None,limit:int|None=None,_=Depends(admin)):
 query=admin_filter(q,["title"]);rows=list(db.conversations.find(query).sort("updatedAt",DESCENDING).limit(list_limit(limit)));owner=owners_for(rows)
 ids=[x["_id"] for x in rows]
 messages={row["_id"]:row["count"] for row in db.messages.aggregate([{"$match":{"conversationId":{"$in":ids}}},{"$group":{"_id":"$conversationId","count":{"$sum":1}}}])} if ids else {}
 return {"total":db.conversations.count_documents(query),"conversations":[{"id":str(x["_id"]),"title":x.get("title",""),"messageCount":messages.get(x["_id"],0),
  "createdAt":iso(x.get("createdAt")) or now().isoformat(),"updatedAt":iso(x.get("updatedAt")) or now().isoformat(),"owner":owner(x)} for x in rows]}

@app.delete("/api/admin/conversations/{ident}",status_code=204)
def admin_delete_conversation(ident:str,_=Depends(admin)):
 c=db.conversations.find_one({"_id":oid(ident)})
 if not c:raise HTTPException(404,"Conversation not found")
 db.messages.delete_many({"conversationId":c["_id"]});db.conversations.delete_one({"_id":c["_id"]})

_vector_status={"checkedAt":0.0,"value":None,"store":None}

def vector_store_status():
 """Live vector store check, cached for a minute so the dashboard stays fast."""
 import time as clock
 if _vector_status["value"] and clock.monotonic()-_vector_status["checkedAt"]<60:return _vector_status["value"]
 provider=os.getenv("VECTOR_STORE","supabase").lower();started=clock.perf_counter()
 try:
  if provider=="supabase":
   from vectorstore.supabase import SupabaseVectorStore
   # Keep one small connection pool for status checks instead of reconnecting each time.
   if _vector_status["store"] is None:_vector_status["store"]=SupabaseVectorStore(int(os.getenv("SUPABASE_VECTOR_DIMENSIONS","384")))
   rows=_vector_status["store"]._run(lambda cursor:(cursor.execute("SELECT count(*) FROM public.document_vectors"),cursor.fetchone()[0])[1])
   value={"provider":provider,"status":"ok","vectors":rows,"latencyMs":round((clock.perf_counter()-started)*1000)}
  else:value={"provider":provider,"status":"configured"}
 except Exception as error:
  logging.warning("Vector store check failed (%s)",type(error).__name__)
  value={"provider":provider,"status":"error","error":type(error).__name__}
 _vector_status.update(checkedAt=clock.monotonic(),value=value)
 return value

@app.get("/api/admin/system")
def admin_system(_=Depends(admin)):
 import time as clock
 started=clock.perf_counter()
 try:db.command("ping");database={"status":"ok","latencyMs":round((clock.perf_counter()-started)*1000)}
 except Exception as error:database={"status":"error","error":type(error).__name__}
 from rag.pipeline import groq_api_keys, text_model_names
 return {"database":database,"vectorStore":vector_store_status(),
  "ai":{"configured":bool(groq_api_keys()),"keys":len(groq_api_keys()),"model":text_model_names()[0],"fallbacks":text_model_names()[1:]},
  "email":{"configured":email_configured(),**outbox.status},
  "otp":otp_config(),"uploads":upload_config(),"adminEmails":len(admin_emails()),"environment":os.getenv("ENVIRONMENT","development").lower()}

def generate_study_material(b, u, collection, field, prefix):
 title="your documents";docid=None
 custom_title=(b.title or "").strip()
 prompt=(b.prompt or "").strip()
 if len(custom_title)>120 or len(prompt)>2000:raise HTTPException(400,"Use at most 120 characters for the name and 2000 for the request.")
 if b.sourceMode not in ("documents","topic"):raise HTTPException(400,"Invalid source mode")
 if b.sourceMode=="topic" and not prompt:raise HTTPException(400,"Enter a topic or request.")
 if b.sourceMode=="topic":
  document_ids=[];title=prompt[:80]
 elif b.documentIds:
  document_ids=selected_documents(b,u)
  title="selected documents"
  if len(document_ids)==1:docid=document_ids[0]
 elif b.documentId:
  docid=chat_document(b.documentId,u)
  if docid is None:raise HTTPException(404,"Resource not found")
  d=owned("documents",b.documentId,u);title=d["originalName"]
  document_ids=[docid]
 else:
  document_ids=[d["_id"] for d in db.documents.find({"userId":u["_id"],"status":"indexed"}).sort("createdAt",DESCENDING).limit(8)]
 if not document_ids and b.sourceMode!="topic":raise HTTPException(409,"Upload and index a document before generating study materials.")
 try:
  generator=StudyMaterialGenerator(db,get_rag(db).text_model)
  language={"language":b.language} if b.language else {}
  content=generator.generate(u["_id"],document_ids,field,prompt=prompt,topic_only=b.sourceMode=="topic",**language) if prompt else generator.generate(u["_id"],document_ids,field,**language)
 except Exception as error:
  logging.error("Study material generation failed (%s)",type(error).__name__)
  raise HTTPException(502,"Unable to generate study materials. Check that the document has readable content and try again.") from error
 x={"userId":u["_id"],"documentId":docid,"documentIds":[str(ident) for ident in document_ids],"title":custom_title or f"{prefix}: {title}","prompt":prompt,field:content,"createdAt":now(),"updatedAt":now()};x["_id"]=db[collection].insert_one(x).inserted_id;return view(x)

def resources(collection,plural,single,field,prefix):
 def listing(u=Depends(user)):
  # Count items in the database instead of downloading every question/card.
  pipeline=[{"$match":{"userId":u["_id"]}},{"$sort":{"createdAt":DESCENDING}},{"$addFields":{"itemCount":{"$size":{"$ifNull":["$"+field,[]]}}}},{"$project":{field:0}}]
  return {plural:[view(x) for x in db[collection].aggregate(pipeline)]}
 def get(ident:str,u=Depends(user)):return {single:view(owned(collection,ident,u))}
 def make(b:Data,u=Depends(user)):
  return {single:generate_study_material(b,u,collection,field,prefix)}
 def rename(ident:str,b:Data,u=Depends(user)):
  title=(b.title or "").strip()
  if not title or len(title)>120:raise HTTPException(400,"Name must contain 1 to 120 characters")
  item=owned(collection,ident,u)
  db[collection].update_one({"_id":item["_id"],"userId":u["_id"]},{"$set":{"title":title,"updatedAt":now()}})
  item["title"]=title
  return {single:view(item)}
 def remove(ident:str,u=Depends(user)):db[collection].delete_one({"_id":owned(collection,ident,u)["_id"]})
 root=f"/api/{'quizzes' if collection=='quizzes' else 'flashcards'}";app.add_api_route(root,listing,methods=["GET"]);app.add_api_route(root,make,methods=["POST"],status_code=201);app.add_api_route(root+"/{ident}",get,methods=["GET"]);app.add_api_route(root+"/{ident}",rename,methods=["PATCH"]);app.add_api_route(root+"/{ident}",remove,methods=["DELETE"],status_code=204)
resources("quizzes","quizzes","quiz","questions","Quiz");resources("flashcardsets","sets","set","cards","Flashcards")
