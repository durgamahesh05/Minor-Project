import re
from datetime import timedelta
from unittest.mock import patch

import mongomock
import pytest
from fastapi.testclient import TestClient

with patch("pymongo.MongoClient"):
    import main

from lib import emails

PASSWORD = "Str0ng!pass"


class FakeOutbox:
    def __init__(self):
        self.sent = []
        self.status = {"sent": 0, "failed": 0, "lastSentAt": None, "lastErrorAt": None, "lastError": None}

    def send(self, recipient, email):
        self.sent.append((recipient, email))

    def code(self, index=-1):
        return re.search(r"code in Synapse AI: (\d{6})", self.sent[index][1].text).group(1)


@pytest.fixture
def env(monkeypatch):
    database = mongomock.MongoClient(tz_aware=True).db
    outbox = FakeOutbox()
    monkeypatch.setattr(main, "db", database)
    monkeypatch.setattr(main.app.state, "db", database, raising=False)
    monkeypatch.setattr(main, "outbox", outbox)
    monkeypatch.setattr(main, "email_configured", lambda: True)
    monkeypatch.setenv("ADMIN_EMAILS", "")
    monkeypatch.setenv("CLIENT_URL", "https://app.example.com")
    return database, outbox, TestClient(main.app)


def register(client, outbox, email="ana@example.com", name="Ana"):
    response = client.post("/api/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()


def test_registration_sends_branded_email_and_returns_timers(env):
    _, outbox, client = env
    body = register(client, outbox)
    assert "otp" not in body  # codes are only shown when no mail server exists
    assert body["expiresIn"] == main.OTP_TTL_SECONDS and body["resendCooldown"] == main.OTP_RESEND_COOLDOWN_SECONDS
    recipient, email = outbox.sent[0]
    assert recipient == "ana@example.com" and email.subject == "Verify your email for Synapse AI"
    assert "Hi Ana," in email.text and "Welcome to Synapse AI!" in email.text and "Intelligence. Innovation. Simplicity." in email.text
    assert "https://app.example.com/register?email=ana%40example.com&code=" in email.text
    assert "Verify My Email" in email.html and "This link will expire in 10 minutes." in email.text
    verified = client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": outbox.code()})
    assert verified.status_code == 201 and verified.json()["user"]["role"] == "user"


def test_registration_code_locks_after_too_many_wrong_attempts(env):
    _, outbox, client = env
    register(client, outbox)
    for _ in range(main.OTP_MAX_ATTEMPTS - 1):
        assert client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": "000000"}).status_code == 400
    assert client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": "000000"}).status_code == 429
    # Even the right code is refused once the limit is reached.
    assert client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": outbox.code()}).status_code == 429


def test_resend_respects_cooldown_and_resubmit_reuses_code(env):
    database, outbox, client = env
    register(client, outbox)
    assert client.post("/api/auth/resend-registration-otp", json={"email": "ana@example.com"}).status_code == 429
    again = register(client, outbox, name="Ana Maria")
    assert len(outbox.sent) == 1 and "already sent" in again["message"]
    assert database.pendingregistrations.find_one({"email": "ana@example.com"})["name"] == "Ana Maria"
    database.pendingregistrations.update_one({}, {"$set": {"lastSentAt": main.now() - timedelta(minutes=5)}})
    assert client.post("/api/auth/resend-registration-otp", json={"email": "ana@example.com"}).status_code == 200
    assert len(outbox.sent) == 2


def test_password_reset_email_and_flow(env):
    _, outbox, client = env
    register(client, outbox)
    client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": outbox.code()})
    assert client.post("/api/auth/forgot-password", json={"email": "ana@example.com"}).status_code == 200
    email = outbox.sent[-1][1]
    assert email.subject == "Reset your Synapse AI password" and "Synapse AI Security Team" in email.text
    assert "/forgot-password?email=ana%40example.com&code=" in email.text
    token = client.post("/api/auth/verify-password-otp", json={"email": "ana@example.com", "otp": outbox.code()}).json()["token"]
    reset = client.post("/api/auth/reset-password", json={"token": token, "password": "N3w!password", "confirmPassword": "N3w!password"})
    assert reset.status_code == 200
    assert client.post("/api/auth/login", json={"email": "ana@example.com", "password": "N3w!password"}).status_code == 200


def test_account_deletion_emails_and_blocks_reuse(env):
    database, outbox, client = env
    register(client, outbox)
    client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": outbox.code()})
    assert client.post("/api/account/delete/request").status_code == 200
    request_email = outbox.sent[-1][1]
    assert request_email.subject == "Confirm your Synapse AI account deletion" and "Confirm Account Deletion" in request_email.html
    assert "/chat?confirmDeletion=" in request_email.text
    assert client.post("/api/account/delete/confirm", json={"otp": "123"}).status_code == 400
    assert client.post("/api/account/delete/confirm", json={"otp": outbox.code()}).status_code == 204
    assert database.users.count_documents({}) == 0
    deleted = outbox.sent[-1][1]
    assert deleted.subject == "Your Synapse AI account has been deleted" and "We're sorry to see you go." in deleted.text
    blocked = client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": PASSWORD})
    assert blocked.status_code == 403


def test_admin_emails_promote_on_login_and_signup(env, monkeypatch):
    database, outbox, client = env
    register(client, outbox)
    client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": outbox.code()})
    monkeypatch.setenv("ADMIN_EMAILS", "Ana@Example.com, boss@example.com")
    assert client.get("/api/auth/me").json()["user"]["role"] == "admin"
    assert database.users.find_one({"email": "ana@example.com"})["role"] == "admin"
    other = TestClient(main.app)
    register(other, outbox, email="boss@example.com", name="Boss")
    assert other.post("/api/auth/verify-registration", json={"email": "boss@example.com", "otp": outbox.code()}).json()["user"]["role"] == "admin"


def make_admin(database, outbox, client, monkeypatch):
    register(client, outbox, email="admin@example.com", name="Admin")
    client.post("/api/auth/verify-registration", json={"email": "admin@example.com", "otp": outbox.code()})
    database.users.update_one({"email": "admin@example.com"}, {"$set": {"role": "admin"}})


def test_admin_roles_lists_and_guards(env, monkeypatch):
    database, outbox, client = env
    make_admin(database, outbox, client, monkeypatch)
    member = TestClient(main.app)
    register(member, outbox, email="sam@example.com", name="Sam")
    member.post("/api/auth/verify-registration", json={"email": "sam@example.com", "otp": outbox.code()})
    sam = database.users.find_one({"email": "sam@example.com"})
    me = database.users.find_one({"email": "admin@example.com"})
    database.quizzes.insert_one({"userId": sam["_id"], "title": "Cells", "questions": [{}, {}], "createdAt": main.now()})
    conversation = database.conversations.insert_one({"userId": sam["_id"], "title": "Biology help", "createdAt": main.now(), "updatedAt": main.now()}).inserted_id
    database.messages.insert_many([{"conversationId": conversation, "text": "hi"}, {"conversationId": conversation, "text": "hello"}])

    assert member.get("/api/admin/users").status_code == 403
    users = client.get("/api/admin/users", params={"q": "sam"}).json()
    assert users["total"] == 1 and users["users"][0]["quizzes"] == 1 and users["users"][0]["conversations"] == 1
    quizzes = client.get("/api/admin/quizzes", params={"q": "sam@example"}).json()["quizzes"]
    assert quizzes[0]["questionCount"] == 2 and quizzes[0]["owner"]["email"] == "sam@example.com"
    conversations = client.get("/api/admin/conversations").json()["conversations"]
    assert conversations[0]["messageCount"] == 2

    assert client.patch(f"/api/admin/users/{me['_id']}", json={"role": "user"}).status_code == 400  # not yourself
    assert client.patch(f"/api/admin/users/{sam['_id']}", json={"role": "admin"}).json()["user"]["role"] == "admin"
    assert member.get("/api/admin/stats").json()["totalAdmins"] == 2
    assert client.patch(f"/api/admin/users/{sam['_id']}", json={"role": "user"}).status_code == 200
    assert client.delete(f"/api/admin/conversations/{conversation}").status_code == 204
    assert database.messages.count_documents({}) == 0

    assert client.delete(f"/api/admin/users/{sam['_id']}").status_code == 204
    assert outbox.sent[-1][0] == "sam@example.com" and "has been deleted" in outbox.sent[-1][1].subject
    assert database.accountdeletions.count_documents({}) == 0  # admin removal does not block re-signup


def test_admins_cannot_remove_themselves_or_configured_admins(env, monkeypatch):
    database, outbox, client = env
    make_admin(database, outbox, client, monkeypatch)
    me = database.users.find_one({"email": "admin@example.com"})
    assert client.delete(f"/api/admin/users/{me['_id']}").status_code == 400
    assert client.patch(f"/api/admin/users/{me['_id']}", json={"role": "user"}).status_code == 400
    assert client.patch(f"/api/admin/users/{me['_id']}", json={"role": "owner"}).status_code == 400
    lee = database.users.insert_one({"name": "Lee", "email": "lee@example.com", "role": "admin", "passwordHash": "x", "createdAt": main.now()}).inserted_id
    monkeypatch.setenv("ADMIN_EMAILS", "lee@example.com")
    # An admin granted by ADMIN_EMAILS would be re-promoted on next login, so demoting is refused.
    assert client.patch(f"/api/admin/users/{lee}", json={"role": "user"}).status_code == 400
    assert database.users.count_documents({"role": "admin"}) == 2


def test_email_html_escapes_user_values():
    email = emails.verification_email("<script>Eve</script>", "eve@example.com", "123456", 600)
    assert "<script>" not in email.html and "&lt;script&gt;" in email.html
    assert "123456" in email.html and email.text.count("123456") >= 2


def test_dev_mode_without_mailer_always_returns_a_usable_code(env, monkeypatch):
    # Without SMTP the code is only ever shown in the app, so resubmitting the
    # form inside the resend cooldown must hand back a fresh code, not nothing.
    database, outbox, client = env
    monkeypatch.setattr(main, "email_configured", lambda: False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    first = client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": PASSWORD}).json()
    again = client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": PASSWORD}).json()
    assert re.fullmatch(r"\d{6}", first["otp"]) and re.fullmatch(r"\d{6}", again["otp"])
    assert client.post("/api/auth/verify-registration", json={"email": "ana@example.com", "otp": again["otp"]}).status_code == 201
    reset = client.post("/api/auth/forgot-password", json={"email": "ana@example.com"}).json()
    reset_again = client.post("/api/auth/forgot-password", json={"email": "ana@example.com"}).json()
    assert re.fullmatch(r"\d{6}", reset["otp"]) and re.fullmatch(r"\d{6}", reset_again["otp"])
    assert client.post("/api/auth/verify-password-otp", json={"email": "ana@example.com", "otp": reset_again["otp"]}).status_code == 200


def test_last_admin_cannot_delete_own_account(env, monkeypatch):
    database, outbox, client = env
    make_admin(database, outbox, client, monkeypatch)
    assert client.post("/api/account/delete/request").status_code == 400
    assert database.users.count_documents({"role": "admin"}) == 1
    database.users.insert_one({"name": "Lee", "email": "lee@example.com", "role": "admin", "passwordHash": "x", "createdAt": main.now()})
    assert client.post("/api/account/delete/request").status_code == 200
    assert client.post("/api/account/delete/confirm", json={"otp": outbox.code()}).status_code == 204


def test_last_admin_guard_also_applies_at_confirmation(env, monkeypatch):
    # The other admin is demoted between requesting and confirming deletion.
    database, outbox, client = env
    make_admin(database, outbox, client, monkeypatch)
    lee = database.users.insert_one({"name": "Lee", "email": "lee@example.com", "role": "admin", "passwordHash": "x", "createdAt": main.now()}).inserted_id
    assert client.post("/api/account/delete/request").status_code == 200
    database.users.update_one({"_id": lee}, {"$set": {"role": "user"}})
    assert client.post("/api/account/delete/confirm", json={"otp": outbox.code()}).status_code == 400
    assert database.users.count_documents({"email": "admin@example.com"}) == 1
