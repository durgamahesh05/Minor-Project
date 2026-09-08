"""Synapse's unified FastAPI backend (API, Mongo persistence, and AI scaffold)."""
import hashlib, os, re, secrets, shutil, smtplib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from email.message import EmailMessage
import bcrypt
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pymongo import DESCENDING, MongoClient
from starlette.middleware.sessions import SessionMiddleware

load_dotenv(Path(__file__).resolve().parent / ".env"); app=FastAPI(title="Synapse API")
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SESSION_SECRET", "replace-in-production"), max_age=604800)
app.add_middleware(CORSMiddleware, allow_origins=[os.getenv("CLIENT_URL", "http://localhost:5173")], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
db=MongoClient(os.getenv("MONGODB_URI", "mongodb://localhost:27017"),tz_aware=True).get_database("SynapseAI"); uploads=Path(__file__).parent/"uploads"
allowed={"application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-powerpoint","application/vnd.openxmlformats-officedocument.presentationml.presentation"}
fallback="I'm Synapse. I can help you understand your documents, generate flashcards, quiz you, and create summaries."
class Data(BaseModel):
 name:str|None=None;email:str|None=None;password:str|None=None;confirmPassword:str|None=None;otp:str|None=None;token:str|None=None;title:str|None=None;text:str|None=None;documentId:str|None=None;question:str|None=None;conversation_id:str|None=None
def now(): return datetime.now(timezone.utc)
def dig(v): return hashlib.sha256(v.encode()).hexdigest()
def oid(v):
 try:return ObjectId(v)
 except:raise HTTPException(404,"Resource not found")
def view(d,drop=()):
 r={k:v for k,v in d.items() if k not in set(drop)|{"_id","userId","conversationId","passwordHash","otpHash","otpExpiresAt","resetTokenHash","resetTokenExpiresAt","storedFilename","storageProvider","storagePath"}};r["id"]=str(d["_id"])
 for k,v in r.items():
  if isinstance(v,(ObjectId,datetime)):r[k]=str(v) if isinstance(v,ObjectId) else v.isoformat()
 return r
def user(request:Request):
 x=db.users.find_one({"_id":oid(request.session["userId"])}) if request.session.get("userId") else None
 if not x:raise HTTPException(401,"Not authenticated")
 return x
def public(x):return {"id":str(x["_id"]),"name":x["name"],"email":x["email"],"role":x.get("role","user")}
def owned(collection,ident,u):
 x=db[collection].find_one({"_id":oid(ident),"userId":u["_id"]})
 if not x:raise HTTPException(404,"Resource not found")
 return x
def password_ok(p):return bool(p and len(p)>=7 and any(x.isupper() for x in p) and any(x.islower() for x in p) and any(x.isdigit() for x in p) and any(not x.isalnum() for x in p))
def send_email(recipient, subject, text):
 host=os.getenv("SMTP_HOST"); username=os.getenv("SMTP_USERNAME"); password=os.getenv("SMTP_PASSWORD")
 if not all((host,username,password)): return False
 message=EmailMessage();message["Subject"]=subject;message["From"]=os.getenv("SMTP_FROM",username);message["To"]=recipient;message.set_content(text)
 try:
  port=int(os.getenv("SMTP_PORT","465"))
  if port==465:
   with smtplib.SMTP_SSL(host,port,timeout=20) as smtp:smtp.login(username,password);smtp.send_message(message)
  else:
   with smtplib.SMTP(host,port,timeout=20) as smtp:smtp.starttls();smtp.login(username,password);smtp.send_message(message)
  return True
 except (OSError,smtplib.SMTPException) as error: raise HTTPException(502,"Unable to send email. Check the SMTP host, port, username and app password.") from error

def otp_response(message,email,code,sent):
 # Only expose an OTP when explicitly in local development and no mailer exists.
 result={"message":message if sent else "Email is not configured. Use the development verification code shown in the app.","email":email}
 if not sent and os.getenv("ENVIRONMENT","development").lower()!="production":result["otp"]=code
 return result

@app.get("/health")
def health(): return {"status":"ok"}
@app.get("/health/chroma")
def chroma_health():
 k,t,d=os.getenv("CHROMA_API_KEY"),os.getenv("CHROMA_TENANT"),os.getenv("CHROMA_DATABASE")
 if not all((k,t,d)):return {"status":"not configured"}
 try:
  import chromadb  # pyright: ignore[reportMissingImports]
  return {"status":"ok","collections":[x.name for x in chromadb.CloudClient(api_key=k,tenant=t,database=d).list_collections()]}
 except ImportError: return {"status":"not installed","message":"Install the optional AI-service requirements with Python 3.10."}
@app.post("/api/rag/query")
def rag(body:Data):return {"answer":fallback,"sources":[]}

@app.post("/api/auth/register")
def register(b:Data):
 if not b.name or not b.email or not password_ok(b.password):raise HTTPException(400,"Name, email and a valid password are required")
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
 if not valid_email(b.email):raise HTTPException(400,"Enter a valid email address")
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
 if not valid_email(b.email):raise HTTPException(400,"Enter a valid email address")
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
 if not valid_email(b.email) or not b.otp or not re.fullmatch(r"\d{6}",b.otp):raise HTTPException(400,"Enter a valid 6-digit OTP")
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
 if not password_ok(b.password):raise HTTPException(400,"Password must be 7 or more characters and include uppercase, lowercase, a number, and a symbol")
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
  if document.get("storedFilename"):(uploads/document["storedFilename"]).unlink(missing_ok=True)
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
@app.post("/api/chat/conversations/{ident}/messages",status_code=201)
def message(ident:str,b:Data,u=Depends(user)):
 if not b.text or not b.text.strip():raise HTTPException(400,"Message text is required")
 c=owned("conversations",ident,u);a={"conversationId":c["_id"],"role":"user","text":b.text.strip(),"createdAt":now()};a["_id"]=db.messages.insert_one(a).inserted_id;z={"conversationId":c["_id"],"role":"assistant","text":fallback,"createdAt":now()};z["_id"]=db.messages.insert_one(z).inserted_id;db.conversations.update_one({"_id":c["_id"]},{"$set":{"updatedAt":now()}});return {"userMessage":view(a),"assistantMessage":view(z)}
@app.delete("/api/chat/conversations/{ident}",status_code=204)
def remove_chat(ident:str,u=Depends(user)):
 c=owned("conversations",ident,u);db.messages.delete_many({"conversationId":c["_id"]});db.conversations.delete_one({"_id":c["_id"]})

@app.get("/api/documents")
def documents(u=Depends(user)):return {"documents":[view(x) for x in db.documents.find({"userId":u["_id"]}).sort("createdAt",DESCENDING)]}
@app.post("/api/documents",status_code=201)
def upload(file:UploadFile=File(...),u=Depends(user)):
 if file.content_type not in allowed:raise HTTPException(400,"Only PDF, DOC, DOCX, PPT and PPTX files are allowed")
 uploads.mkdir(exist_ok=True);name=secrets.token_hex(16)+Path(file.filename or '').suffix;path=uploads/name
 with path.open("wb") as f:shutil.copyfileobj(file.file,f)
 if path.stat().st_size>20*1024*1024:path.unlink();raise HTTPException(400,"File too large (20MB maximum)")
 x={"userId":u["_id"],"originalName":file.filename,"storedFilename":name,"storageProvider":"local","mimeType":file.content_type,"size":path.stat().st_size,"createdAt":now(),"updatedAt":now()};x["_id"]=db.documents.insert_one(x).inserted_id;return {"document":view(x)}
@app.get("/api/documents/{ident}/download")
def download(ident:str,u=Depends(user)):
 x=owned("documents",ident,u);return FileResponse(uploads/x["storedFilename"],filename=x["originalName"],media_type=x["mimeType"])
@app.delete("/api/documents/{ident}",status_code=204)
def delete_doc(ident:str,u=Depends(user)):
 x=owned("documents",ident,u);(uploads/x["storedFilename"]).unlink(missing_ok=True);db.documents.delete_one({"_id":x["_id"]})

def resources(collection,plural,single,field,prefix):
 def listing(u=Depends(user)):return {plural:[view(x,{field}) for x in db[collection].find({"userId":u["_id"]}).sort("createdAt",DESCENDING)]}
 def get(ident:str,u=Depends(user)):return {single:view(owned(collection,ident,u))}
 def make(b:Data,u=Depends(user)):
  title="your notes";docid=None
  if b.documentId:d=owned("documents",b.documentId,u);title=d["originalName"];docid=d["_id"]
  content=[{"question":f'What is the main topic of "{title}"?',"options":["Connect the AI service","Option B","Option C","Option D"],"correctIndex":0}] if field=="questions" else [{"front":f'What is "{title}" about?',"back":"Connect the AI service to generate an answer."}]
  x={"userId":u["_id"],"documentId":docid,"title":f"{prefix}: {title}",field:content,"createdAt":now(),"updatedAt":now()};x["_id"]=db[collection].insert_one(x).inserted_id;return {single:view(x)}
 def remove(ident:str,u=Depends(user)):db[collection].delete_one({"_id":owned(collection,ident,u)["_id"]})
 root=f"/api/{'quizzes' if collection=='quizzes' else 'flashcards'}";app.add_api_route(root,listing,methods=["GET"]);app.add_api_route(root,make,methods=["POST"],status_code=201);app.add_api_route(root+"/{ident}",get,methods=["GET"]);app.add_api_route(root+"/{ident}",remove,methods=["DELETE"],status_code=204)
resources("quizzes","quizzes","quiz","questions","Quiz");resources("flashcardsets","sets","set","cards","Flashcards")
