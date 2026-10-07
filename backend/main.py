"""Synapse's unified FastAPI backend (API, Mongo persistence, and AI scaffold)."""
import hashlib, os, re, secrets, smtplib, logging, ssl, sys, asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from email.message import EmailMessage
import bcrypt
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from pymongo import DESCENDING, MongoClient
from starlette.middleware.sessions import SessionMiddleware
from document_storage import delete_document, signed_download_url, sync_upload_metadata, delete_upload_metadata
from ingestion.file_router import SUPPORTED_EXTENSIONS
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

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
 from database_indexes import ensure_indexes
 index_task=asyncio.create_task(asyncio.to_thread(ensure_indexes,db))
 try:
  yield
 finally:
  await index_task
  try:
   io_resources.close()
   close_rag_instances()
  finally:
   mongo_client.close()

logging.basicConfig(level=logging.INFO)
load_dotenv(Path(__file__).resolve().parent / ".env")
app: FastAPI = FastAPI(title="Synapse API", lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SESSION_SECRET", "replace-in-production"), max_age=604800)
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("CLIENT_URL", "http://localhost:5173")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
mongo_client=MongoClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017"),tz_aware=True,maxPoolSize=50,minPoolSize=0,waitQueueTimeoutMS=10000)
db=mongo_client.get_database("SynapseAI"); uploads=Path(__file__).parent/"uploads"
MAX_DOCUMENT_SIZE=20*1024*1024
fallback="I'm Synapse. I can help you understand your documents, generate flashcards, quiz you, and create summaries."
class Data(BaseModel):
 documentIds:list[str]|None=None
 prompt:str|None=None
 sourceMode:str="documents"
 responseLevel:ResponseLevel="simple"
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
def user(request:Request):
 x=db.users.find_one({"_id":oid(request.session["userId"])}) if request.session.get("userId") else None
 if not x:raise HTTPException(401,"Not authenticated")
 return x
def admin(u=Depends(user)):
 if u.get("role","user")!="admin":raise HTTPException(403,"Admin access required")
 return u
def public(x):return {"id":str(x["_id"]),"name":x["name"],"email":x["email"],"role":x.get("role","user")}
def owned(collection,ident,u):
 x=db[collection].find_one({"_id":oid(ident),"userId":u["_id"]})
 if not x:raise HTTPException(404,"Resource not found")
 return x

def chat_document(document_id,u):
 if document_id:
  document=owned("documents",document_id,u)
  if document.get("status")!="indexed":raise HTTPException(409,"This document is not ready for questions. Wait for indexing to finish, or upload it again if processing failed.")
  return document["_id"]
 if db.documents.find_one({"userId":u["_id"],"status":{"$in":["uploading","processing"]}}):
  raise HTTPException(409,"A document is still being indexed. Please wait before sending your question.")
 return None
def selected_documents(b, u):
 ids=list(dict.fromkeys(b.documentIds or ([b.documentId] if b.documentId else [])))
 if len(ids)>5:raise HTTPException(400,"Attach up to 5 files per message")
 if not ids:
  chat_document(None,u)
  return []
 return [chat_document(ident,u) for ident in ids]

def password_ok(p):return bool(p and len(p)>=7 and any(x.isupper() for x in p) and any(x.islower() for x in p) and any(x.isdigit() for x in p) and any(not x.isalnum() for x in p))
def send_email(recipient, subject, text):
 host=(os.getenv("SMTP_HOST") or "").strip(); username=(os.getenv("SMTP_USERNAME") or "").strip(); password=os.getenv("SMTP_PASSWORD")
 if not host or not username or not password: return False
 message=EmailMessage();message["Subject"]=subject;message["From"]=os.getenv("SMTP_FROM",username);message["To"]=recipient;message.set_content(text)
 try:
  port=int(os.getenv("SMTP_PORT","465"))
  if not 1 <= port <= 65535: raise ValueError("Invalid SMTP port")
 except ValueError as error:
  raise HTTPException(503,"Email configuration error: SMTP_PORT must be between 1 and 65535.") from error
 stage="connection"
 try:
  context=ssl.create_default_context()
  connection=smtplib.SMTP_SSL(host,port,timeout=20,context=context) if port==465 else smtplib.SMTP(host,port,timeout=20)
  with connection as smtp:
   smtp.ehlo()
   if port!=465:
    stage="STARTTLS"
    smtp.starttls(context=context)
    smtp.ehlo()
   stage="authentication"
   smtp.login(username,password)
   stage="delivery"
   smtp.send_message(message)
  return True
 except smtplib.SMTPAuthenticationError as error:
  logging.error("SMTP authentication rejected (code %s)",error.smtp_code)
  raise HTTPException(502,"Email provider rejected SMTP credentials. Check SMTP_USERNAME and SMTP_PASSWORD; Gmail requires a valid Google app password.") from error
 except (OSError,smtplib.SMTPException) as error:
  # Do not log provider responses, credentials, recipients, or verification codes.
  logging.error("SMTP failed during %s (%s)",stage,type(error).__name__)
  raise HTTPException(502,f"Unable to send email: SMTP {stage} failed. Check the mail server configuration and network connection.") from error

def otp_response(message,email,code,sent):
 # Only expose an OTP when explicitly in local development and no mailer exists.
 result={"message":message if sent else "Email is not configured. Use the development verification code shown in the app.","email":email}
 if not sent and os.getenv("ENVIRONMENT","development").lower()!="production":result["otp"]=code
 return result

@app.get("/health")
def health(): return {"status":"ok"}
@app.get("/health/chroma")
def chroma_health():
 if os.getenv("VECTOR_STORE", "qdrant").lower()!="chroma":return {"status":"not active","provider":os.getenv("VECTOR_STORE","qdrant")}
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
 try:result=get_rag(db).answer(body.question.strip(),u["_id"],document_id=document_id);return {"answer":result.answer,"sources":result.sources}
 except Exception as error:raise HTTPException(502,f"RAG query failed: {error}") from error

@app.post("/api/auth/register")
def register(b:Data):
 if not b.name or not b.email or not b.password or not password_ok(b.password):raise HTTPException(400,"Name, email and a valid password are required")
 email=b.email.lower()
 if db.users.find_one({"email":email}):raise HTTPException(409,"An account with this email already exists")
 code=f"{secrets.randbelow(1000000):06d}";db.pendingregistrations.update_one({"email":email},{"$set":{"name":b.name,"email":email,"passwordHash":bcrypt.hashpw(b.password.encode(),bcrypt.gensalt()).decode(),"otpHash":dig(code),"otpExpiresAt":now()+timedelta(minutes=10),"updatedAt":now()},"$setOnInsert":{"createdAt":now()}},upsert=True);sent=send_email(email,"Your Synapse verification code",f"Your Synapse verification code is {code}. It expires in 10 minutes.");return otp_response("Verification code sent.",email,code,sent)
@app.post("/api/auth/verify-registration",status_code=201)
def verify(b:Data,request:Request):
 p=db.pendingregistrations.find_one({"email":(b.email or '').lower()})
 if not p or p["otpExpiresAt"]<now() or dig(b.otp or '')!=p["otpHash"]:raise HTTPException(400,"That code is invalid or has expired.")
 x={"name":p["name"],"email":p["email"],"passwordHash":p["passwordHash"],"role":"user","createdAt":now(),"updatedAt":now()};x["_id"]=db.users.insert_one(x).inserted_id;db.pendingregistrations.delete_one({"_id":p["_id"]});request.session["userId"]=str(x["_id"]);return {"user":public(x)}
@app.post("/api/auth/resend-registration-otp")
def resend_registration_otp(b:Data):
 email=(b.email or "").lower();pending=db.pendingregistrations.find_one({"email":email})
 if not pending:raise HTTPException(400,"No pending signup found for this email. Please sign up again.")
 code=f"{secrets.randbelow(1000000):06d}";db.pendingregistrations.update_one({"_id":pending["_id"]},{"$set":{"otpHash":dig(code),"otpExpiresAt":now()+timedelta(minutes=10)}});sent=send_email(email,"Your new Synapse verification code",f"Your Synapse verification code is {code}. It expires in 10 minutes.");return otp_response("Verification code sent.",email,code,sent)
@app.post("/api/auth/login")
def login(b:Data,request:Request):
 x=db.users.find_one({"email":(b.email or '').lower()})
 if not x or not b.password or not bcrypt.checkpw(b.password.encode(),x["passwordHash"].encode()):raise HTTPException(401,"Invalid email or password")
 request.session["userId"]=str(x["_id"]);return {"user":public(x)}
@app.post("/api/auth/logout",status_code=204)
def logout(request:Request):request.session.clear()
@app.get("/api/auth/me")
def me(u=Depends(user)):return {"user":public(u)}

RESET_OTP_TTL_SECONDS=10*60
RESET_RESEND_COOLDOWN_SECONDS=60
RESET_MAX_ATTEMPTS=5
RESET_MAX_RESENDS=5

def valid_email(value):return bool(value and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",value))

@app.post("/api/auth/forgot-password")
def forgot_password(b:Data):
 if not b.email or not valid_email(b.email):raise HTTPException(400,"Enter a valid email address")
 email=b.email.strip().lower();x=db.users.find_one({"email":email});response={"message":"If an account exists for this email, an OTP has been sent.","expiresIn":RESET_OTP_TTL_SECONDS,"resendCooldown":RESET_RESEND_COOLDOWN_SECONDS}
 if not x:return response
 code=f"{secrets.randbelow(1000000):06d}";sent=send_email(email,"Your Synapse password reset code",f"Your Synapse password reset code is {code}. It expires in 10 minutes. If you did not request this, ignore this email.")
 if not sent and os.getenv("ENVIRONMENT","development").lower()=="production":raise HTTPException(503,"Email delivery is temporarily unavailable. Please try again later.")
 db.passwordresetotps.create_index("expiresAt",expireAfterSeconds=0)
 db.passwordresetotps.replace_one({"email":email},{"email":email,"userId":x["_id"],"otpHash":dig(code),"expiresAt":now()+timedelta(seconds=RESET_OTP_TTL_SECONDS),"attempts":0,"resendCount":0,"lastSentAt":now(),"createdAt":now()},upsert=True)
 if not sent and os.getenv("ENVIRONMENT","development").lower()!="production":response["otp"]=code
 return response

@app.post("/api/auth/resend-password-otp")
def resend_password_otp(b:Data):
 if not b.email or not valid_email(b.email):raise HTTPException(400,"Enter a valid email address")
 email=b.email.strip().lower();record=db.passwordresetotps.find_one({"email":email});generic={"message":"If an account exists for this email, a new OTP has been sent.","expiresIn":RESET_OTP_TTL_SECONDS,"resendCooldown":RESET_RESEND_COOLDOWN_SECONDS}
 if not record:return generic
 elapsed=(now()-record["lastSentAt"]).total_seconds()
 if elapsed<RESET_RESEND_COOLDOWN_SECONDS:raise HTTPException(429,f"Please wait {int(RESET_RESEND_COOLDOWN_SECONDS-elapsed)+1} seconds before requesting another OTP")
 if record.get("resendCount",0)>=RESET_MAX_RESENDS:raise HTTPException(429,"OTP resend limit reached. Please try again later.")
 x=db.users.find_one({"_id":record["userId"]})
 if not x:db.passwordresetotps.delete_one({"_id":record["_id"]});return generic
 code=f"{secrets.randbelow(1000000):06d}";sent=send_email(email,"Your new Synapse password reset code",f"Your Synapse password reset code is {code}. It expires in 10 minutes. If you did not request this, ignore this email.")
 db.passwordresetotps.update_one({"_id":record["_id"]},{"$set":{"otpHash":dig(code),"expiresAt":now()+timedelta(seconds=RESET_OTP_TTL_SECONDS),"attempts":0,"lastSentAt":now()},"$inc":{"resendCount":1}})
 if not sent and os.getenv("ENVIRONMENT","development").lower()!="production":generic["otp"]=code
 return generic

@app.post("/api/auth/verify-password-otp")
def verify_password_otp(b:Data):
 if not b.email or not valid_email(b.email) or not b.otp or not re.fullmatch(r"\d{6}",b.otp):raise HTTPException(400,"Enter a valid 6-digit OTP")
 record=db.passwordresetotps.find_one({"email":b.email.strip().lower()})
 if not record or record.get("expiresAt",now())<=now():raise HTTPException(400,"That OTP is invalid or has expired. Request a new one.")
 if record.get("attempts",0)>=RESET_MAX_ATTEMPTS:raise HTTPException(429,"Too many incorrect attempts. Request a new OTP.")
 if not secrets.compare_digest(record.get("otpHash",""),dig(b.otp)):
  attempts=record.get("attempts",0)+1;db.passwordresetotps.update_one({"_id":record["_id"]},{"$set":{"attempts":attempts}})
  if attempts>=RESET_MAX_ATTEMPTS:raise HTTPException(429,"Too many incorrect attempts. Request a new OTP.")
  raise HTTPException(400,f"Incorrect OTP. {RESET_MAX_ATTEMPTS-attempts} attempts remaining.")
 token=secrets.token_urlsafe(32);db.passwordresetotps.update_one({"_id":record["_id"]},{"$set":{"resetTokenHash":dig(token),"expiresAt":now()+timedelta(minutes=10),"verifiedAt":now()},"$unset":{"otpHash":"","attempts":""}})
 return {"message":"OTP verified.","token":token,"expiresIn":600}

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

@app.post("/api/account/delete/request")
def request_account_deletion(u=Depends(user)):
 code=f"{secrets.randbelow(1000000):06d}"
 db.users.update_one({"_id":u["_id"]},{"$set":{"deleteOtpHash":dig(code),"deleteOtpExpiresAt":now()+timedelta(minutes=10)}})
 sent=send_email(u["email"],"Confirm your Synapse account deletion",f"Your account deletion verification code is {code}. It expires in 10 minutes. If you did not request this, ignore this email.")
 return otp_response("Verification code sent.",u["email"],code,sent)

@app.post("/api/account/delete/confirm",status_code=204)
def confirm_account_deletion(b:Data,request:Request,u=Depends(user)):
 if not b.otp or u.get("deleteOtpHash")!=dig(b.otp) or not u.get("deleteOtpExpiresAt") or u["deleteOtpExpiresAt"]<now():raise HTTPException(400,"That code is invalid or has expired")
 conversation_ids=[x["_id"] for x in db.conversations.find({"userId":u["_id"]},{"_id":1})]
 if conversation_ids:db.messages.delete_many({"conversationId":{"$in":conversation_ids}})
 db.conversations.delete_many({"userId":u["_id"]})
 for document in db.documents.find({"userId":u["_id"]}):
  delete_upload_metadata(document["_id"])
  delete_document_artifacts(db,document["_id"])
  if document.get("storageProvider")=="supabase":delete_document(document.get("storagePath"),document.get("supabaseMetadataId"))
  elif document.get("storageProvider")=="local" and document.get("storedFilename"):(uploads/document["storedFilename"]).unlink(missing_ok=True)
 db.documents.delete_many({"userId":u["_id"]});db.quizzes.delete_many({"userId":u["_id"]});db.flashcardsets.delete_many({"userId":u["_id"]})
 db.accountdeletions.insert_one({"email":u["email"],"deletedAt":now()});db.users.delete_one({"_id":u["_id"]});request.session.clear()

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
 document_id=document_ids[0] if len(document_ids)==1 else None
 actions=study_actions(b.text.strip(),document_id)
 try:
  if actions:
   generated=[];failures=[]
   for action in actions:
    kind=action["kind"]
    try:
     material=generate_study_material(Data(prompt=b.text.strip(),documentIds=[str(ident) for ident in document_ids],documentId=action["documentId"],sourceMode="documents" if document_ids or re.search(r"\b(document|documents|file|files|upload|uploaded|chapter|section|notes)\b",b.text,re.I) else "topic"),u,
      "quizzes" if kind=="quiz" else "flashcardsets","questions" if kind=="quiz" else "cards","Quiz" if kind=="quiz" else "Flashcards")
     generated.append({**action,"id":material["id"],"title":material["title"]})
    except HTTPException as error:
     failures.append(f"Could not generate {kind}: {error.detail}")
   actions=generated
   reply=("Your study materials are ready. Open them below to start studying." if generated else "") + ("\n\n" + "\n".join(failures) if failures else "")
  elif len(document_ids)>1:reply=get_rag(db).answer(b.text.strip(),u["_id"],document_ids=document_ids,response_level=b.responseLevel).answer
  else:reply=get_rag(db).chat(b.text.strip(),u["_id"],document_id=document_id,response_level=b.responseLevel).answer
 except Exception as error:raise HTTPException(502,f"Unable to answer your message: {error}") from error
 a={"conversationId":c["_id"],"role":"user","text":b.text.strip(),"createdAt":now()}
 if document_ids:
  attachments=[]
  for ident in document_ids:
   document=owned("documents",str(ident),u)
   attachments.append({"id":str(ident),"originalName":document.get("originalName","Document"),"mimeType":document.get("mimeType","application/octet-stream"),"size":document.get("size",0),"clientDocumentId":document.get("clientDocumentId"),"storageProvider":document.get("storageProvider")})
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
def upload(file:UploadFile=File(...),client_document_id:str=Form(...),u=Depends(user),background_tasks:BackgroundTasks=None):
 original=file.filename or "upload";extension=Path(original).suffix.lower()
 if extension not in SUPPORTED_EXTENSIONS:raise HTTPException(400,"Supported files: PDF, DOCX, PPTX, XLSX, text, code, CSV, and common images")
 if not re.fullmatch(r"[0-9a-fA-F-]{36}",client_document_id):raise HTTPException(400,"Invalid browser document ID")
 content=file.file.read(MAX_DOCUMENT_SIZE+1)
 if len(content)>MAX_DOCUMENT_SIZE:raise HTTPException(400,"File too large (20MB maximum)")
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
   delete_document_artifacts(db,x["_id"]);db.documents.delete_one({"_id":x["_id"]})
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

def owner_value(document):
 owner=db.users.find_one({"_id":document.get("userId")},{"name":1,"email":1})
 return {"id":str(owner["_id"]),"name":owner.get("name",""),"email":owner.get("email","")} if owner else None

@app.get("/api/admin/stats")
def admin_stats(_=Depends(admin)):
 return {"totalUsers":db.users.count_documents({}),"totalDocuments":db.documents.count_documents({}),"totalQuizzes":db.quizzes.count_documents({}),"totalFlashcardSets":db.flashcardsets.count_documents({}),"totalConversations":db.conversations.count_documents({})}

@app.get("/api/admin/users")
def admin_users(_=Depends(admin)):
 return {"users":[{"id":str(x["_id"]),"name":x.get("name",""),"email":x.get("email",""),"role":x.get("role","user"),"createdAt":x.get("createdAt",now()).isoformat()} for x in db.users.find().sort("createdAt",DESCENDING)]}

@app.delete("/api/admin/users/{ident}",status_code=204)
def admin_delete_user(ident:str,request:Request,_=Depends(admin)):
 target=oid(ident)
 if request.session.get("userId")==ident:raise HTTPException(400,"You can't delete your own account while logged in")
 victim=db.users.find_one({"_id":target})
 if not victim:raise HTTPException(404,"User not found")
 conversation_ids=[x["_id"] for x in db.conversations.find({"userId":target},{"_id":1})]
 if conversation_ids:db.messages.delete_many({"conversationId":{"$in":conversation_ids}})
 db.conversations.delete_many({"userId":target})
 for document in db.documents.find({"userId":target}):
  delete_upload_metadata(document["_id"])
  delete_document_artifacts(db,document["_id"])
  if document.get("storageProvider")=="supabase":delete_document(document.get("storagePath"),document.get("supabaseMetadataId"))
  elif document.get("storageProvider")=="local" and document.get("storedFilename"):(uploads/document["storedFilename"]).unlink(missing_ok=True)
 db.documents.delete_many({"userId":target});db.quizzes.delete_many({"userId":target});db.flashcardsets.delete_many({"userId":target});db.users.delete_one({"_id":target})

@app.get("/api/admin/documents")
def admin_documents(_=Depends(admin)):
 return {"documents":[{"id":str(x["_id"]),"originalName":x.get("originalName",""),"mimeType":x.get("mimeType",""),"size":x.get("size",0),"createdAt":x.get("createdAt",now()).isoformat(),"owner":owner_value(x)} for x in db.documents.find().sort("createdAt",DESCENDING)]}

@app.delete("/api/admin/documents/{ident}",status_code=204)
def admin_delete_document(ident:str,_=Depends(admin)):
 x=db.documents.find_one({"_id":oid(ident)})
 if not x:raise HTTPException(404,"Document not found")
 if x.get("storageProvider")=="supabase":delete_document(x.get("storagePath"),x.get("supabaseMetadataId"))
 elif x.get("storageProvider")=="local" and x.get("storedFilename"):(uploads/x["storedFilename"]).unlink(missing_ok=True)
 delete_upload_metadata(x["_id"]);delete_document_artifacts(db,x["_id"]);db.documents.delete_one({"_id":x["_id"]})

@app.get("/api/admin/quizzes")
def admin_quizzes(_=Depends(admin)):
 return {"quizzes":[{"id":str(x["_id"]),"title":x.get("title",""),"questionCount":len(x.get("questions",[])),"createdAt":x.get("createdAt",now()).isoformat(),"owner":owner_value(x)} for x in db.quizzes.find().sort("createdAt",DESCENDING)]}

@app.delete("/api/admin/quizzes/{ident}",status_code=204)
def admin_delete_quiz(ident:str,_=Depends(admin)):
 result=db.quizzes.delete_one({"_id":oid(ident)})
 if not result.deleted_count:raise HTTPException(404,"Quiz not found")

@app.get("/api/admin/flashcards")
def admin_flashcards(_=Depends(admin)):
 return {"sets":[{"id":str(x["_id"]),"title":x.get("title",""),"cardCount":len(x.get("cards",[])),"createdAt":x.get("createdAt",now()).isoformat(),"owner":owner_value(x)} for x in db.flashcardsets.find().sort("createdAt",DESCENDING)]}

@app.delete("/api/admin/flashcards/{ident}",status_code=204)
def admin_delete_flashcards(ident:str,_=Depends(admin)):
 result=db.flashcardsets.delete_one({"_id":oid(ident)})
 if not result.deleted_count:raise HTTPException(404,"Flashcard set not found")

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
  d=owned("documents",b.documentId,u);title=d["originalName"]
  document_ids=[docid]
 else:
  document_ids=[d["_id"] for d in db.documents.find({"userId":u["_id"],"status":"indexed"}).sort("createdAt",DESCENDING).limit(8)]
 if not document_ids and b.sourceMode!="topic":raise HTTPException(409,"Upload and index a document before generating study materials.")
 try:
  generator=StudyMaterialGenerator(db,get_rag(db).text_model)
  content=generator.generate(u["_id"],document_ids,field,prompt=prompt,topic_only=b.sourceMode=="topic") if prompt else generator.generate(u["_id"],document_ids,field)
 except Exception as error:
  logging.error("Study material generation failed (%s)",type(error).__name__)
  raise HTTPException(502,"Unable to generate study materials. Check that the document has readable content and try again.") from error
 x={"userId":u["_id"],"documentId":docid,"documentIds":[str(ident) for ident in document_ids],"title":custom_title or f"{prefix}: {title}","prompt":prompt,field:content,"createdAt":now(),"updatedAt":now()};x["_id"]=db[collection].insert_one(x).inserted_id;return view(x)

def resources(collection,plural,single,field,prefix):
 def listing(u=Depends(user)):return {plural:[{**view(x,{field}),"itemCount":len(x.get(field,[]))} for x in db[collection].find({"userId":u["_id"]}).sort("createdAt",DESCENDING)]}
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
