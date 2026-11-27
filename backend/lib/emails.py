"""Branded Synapse AI emails, delivered in the background.

OTP endpoints return as soon as the code is stored; the SMTP round trip
(~2-4s to Gmail) happens on a worker thread so users are not kept waiting.
Each email has an HTML version with a button and a plain-text version, and
always includes the code too, so it also works when opened on another device.
"""
import html
import logging
import os
import smtplib
import ssl
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from threading import Lock
from urllib.parse import urlencode

logger = logging.getLogger(__name__)
BRAND = "#7c5af0"


@dataclass(frozen=True)
class Email:
    subject: str
    text: str
    html: str


# ---------------------------------------------------------------- settings

def smtp_settings() -> dict | None:
    host = (os.getenv("SMTP_HOST") or "").strip()
    raw_username = (os.getenv("SMTP_USERNAME") or "").strip()
    password = os.getenv("SMTP_PASSWORD")
    if not host or not raw_username or not password:
        return None
    _, address = parseaddr(raw_username)
    username = address or raw_username
    sender = (os.getenv("SMTP_FROM") or username).strip()
    sender_name, sender_address = parseaddr(sender)
    if sender_address:
        sender = formataddr((sender_name or "Synapse AI", sender_address))
    return {"host": host, "username": username, "password": password, "sender": sender, "port": os.getenv("SMTP_PORT", "465")}


def email_configured() -> bool:
    return smtp_settings() is not None


def app_url() -> str:
    """Public frontend address used in email links."""
    configured = (os.getenv("APP_URL") or "").strip() or (os.getenv("CLIENT_URL") or "http://localhost:5173").split(",")[0].strip()
    return configured.rstrip("/")


def support_email() -> str:
    configured = (os.getenv("SUPPORT_EMAIL") or "").strip()
    if configured:
        return configured
    settings = smtp_settings()
    return parseaddr(settings["sender"])[1] if settings else "support@synapse.ai"


def expiry_text(seconds: int) -> str:
    minutes = max(1, round(seconds / 60))
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def _link(path: str, **params: str) -> str:
    return f"{app_url()}{path}?{urlencode(params)}"


# ---------------------------------------------------------------- rendering

def _render(subject: str, name: str, blocks: list[tuple[str, str]], signature: str, tagline: str | None = None) -> Email:
    """blocks: ("p", text) | ("strong", text) | ("button", "label|url") | ("link", url) | ("code", code)."""
    greeting = f"Hi {name or 'there'},"
    text_lines = [greeting, ""]
    html_parts = [f'<p style="margin:0 0 16px">{html.escape(greeting)}</p>']
    for kind, value in blocks:
        if kind == "p":
            text_lines += [value, ""]
            html_parts.append(f'<p style="margin:0 0 16px">{html.escape(value)}</p>')
        elif kind == "strong":
            text_lines += [value, ""]
            html_parts.append(f'<p style="margin:0 0 16px"><strong>{html.escape(value)}</strong></p>')
        elif kind == "button":
            label, url = value.split("|", 1)
            # Plain-text readers get the URL once, from the link line that follows.
            if not any(other == "link" for other, _ in blocks):
                text_lines += [f"{label}: {url}", ""]
            html_parts.append(
                f'<p style="margin:24px 0"><a href="{html.escape(url, quote=True)}" '
                f'style="background:{BRAND};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;'
                f'font-weight:600;display:inline-block">{html.escape(label)}</a></p>')
        elif kind == "link":
            text_lines += [value, ""]
            html_parts.append(f'<p style="margin:0 0 16px;word-break:break-all"><a href="{html.escape(value, quote=True)}" style="color:{BRAND}">{html.escape(value)}</a></p>')
        elif kind == "code":
            text_lines += [f"Or enter this code in Synapse AI: {value}", ""]
            html_parts.append(
                '<p style="margin:0 0 16px">Or enter this code in Synapse AI:</p>'
                f'<p style="margin:0 0 20px;font-size:26px;font-weight:700;letter-spacing:6px;font-family:monospace">{html.escape(value)}</p>')
    text_lines += ["Best regards,", signature]
    if tagline:
        text_lines.append(tagline)
    sign_off = f'<p style="margin:24px 0 0">Best regards,<br><strong>{html.escape(signature)}</strong>'
    sign_off += f'<br><span style="color:#626b7a">{html.escape(tagline)}</span></p>' if tagline else "</p>"
    body = (
        '<div style="background:#f4f4f6;padding:24px 12px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0d0d0d">'
        '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;line-height:1.6;font-size:15px">'
        f'<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:{BRAND}">Synapse AI</p>'
        + "".join(html_parts) + sign_off + "</div></div>"
    )
    return Email(subject, "\n".join(text_lines).strip() + "\n", body)


def verification_email(name: str, email: str, code: str, expires_in: int) -> Email:
    link = _link("/register", email=email, code=code)
    return _render("Verify your email for Synapse AI", name, [
        ("strong", "Welcome to Synapse AI!"),
        ("p", "Thank you for creating an account. To complete your registration and activate your account, "
              "please verify your email address by clicking the button below."),
        ("button", f"Verify My Email|{link}"),
        ("p", "Or use this verification link:"),
        ("link", link),
        ("code", code),
        ("p", f"This link will expire in {expiry_text(expires_in)}."),
        ("p", "If you did not create a Synapse AI account, you can safely ignore this email."),
    ], "Synapse AI Team", "Intelligence. Innovation. Simplicity.")


def password_reset_email(name: str, email: str, code: str, expires_in: int) -> Email:
    link = _link("/forgot-password", email=email, code=code)
    return _render("Reset your Synapse AI password", name, [
        ("p", "We received a request to reset the password associated with your Synapse AI account."),
        ("p", "Click the button below to create a new password."),
        ("button", f"Reset Password|{link}"),
        ("link", link),
        ("code", code),
        ("p", f"For security reasons, this link will expire in {expiry_text(expires_in)}."),
        ("p", "If you did not request a password reset, please ignore this email. Your password will remain unchanged."),
    ], "Synapse AI Security Team")


def deletion_request_email(name: str, code: str, expires_in: int) -> Email:
    link = _link("/chat", confirmDeletion=code)
    return _render("Confirm your Synapse AI account deletion", name, [
        ("p", "We received a request to delete your Synapse AI account."),
        ("p", "If you wish to proceed, please confirm your decision by clicking below."),
        ("button", f"Confirm Account Deletion|{link}"),
        ("link", link),
        ("code", code),
        ("p", f"This request will expire in {expiry_text(expires_in)}."),
        ("p", "Please note that account deletion may permanently remove your profile, personal information, "
              "and associated data, subject to our data retention policy."),
        ("p", "If you did not request this action, please ignore this email and secure your account."),
    ], "Synapse AI Security Team")


def account_deleted_email(name: str, deleted_at: datetime | None = None) -> Email:
    when = (deleted_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return _render("Your Synapse AI account has been deleted", name, [
        ("p", "Your Synapse AI account has been successfully deleted."),
        ("p", "We're sorry to see you go. Thank you for being part of Synapse AI."),
        ("p", f"Your account deletion was completed on {when.strftime('%d %B %Y, %H:%M UTC')}."),
        ("p", f"If you have any questions, please contact our support team at {support_email()}."),
    ], "Synapse AI Team")


# ---------------------------------------------------------------- delivery

class EmailError(RuntimeError):
    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage


def deliver(recipient: str, email: Email) -> None:
    """Send now (blocking). Raises EmailError with the failing SMTP stage."""
    settings = smtp_settings()
    if settings is None:
        raise EmailError("configuration", "Email is not configured")
    try:
        port = int(settings["port"])
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError as error:
        raise EmailError("configuration", "SMTP_PORT must be between 1 and 65535") from error
    message = EmailMessage()
    message["Subject"], message["From"], message["To"] = email.subject, settings["sender"], recipient
    message.set_content(email.text)
    message.add_alternative(email.html, subtype="html")
    stage = "connection"
    try:
        context = ssl.create_default_context()
        connection = smtplib.SMTP_SSL(settings["host"], port, timeout=20, context=context) if port == 465 else smtplib.SMTP(settings["host"], port, timeout=20)
        with connection as smtp:
            smtp.ehlo()
            if port != 465:
                stage = "STARTTLS"
                smtp.starttls(context=context)
                smtp.ehlo()
            stage = "authentication"
            smtp.login(settings["username"], settings["password"])
            stage = "delivery"
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError as error:
        raise EmailError("authentication", "The email provider rejected the SMTP credentials") from error
    except (OSError, smtplib.SMTPException) as error:
        raise EmailError(stage, f"SMTP {stage} failed ({type(error).__name__})") from error


class EmailOutbox:
    """Background sender with one retry and a status record for the admin dashboard."""

    def __init__(self, workers: int = 2):
        self._executor: ThreadPoolExecutor | None = None
        self._workers = workers
        self._lock = Lock()
        self.status: dict = {"sent": 0, "failed": 0, "lastSentAt": None, "lastErrorAt": None, "lastError": None}

    def _send(self, recipient: str, email: Email) -> None:
        for attempt in range(2):
            try:
                deliver(recipient, email)
                with self._lock:
                    self.status["sent"] += 1
                    self.status["lastSentAt"] = datetime.now(timezone.utc).isoformat()
                return
            except EmailError as error:
                # Never log recipients, codes or provider responses.
                logger.error("Email delivery failed at %s (attempt %d)", error.stage, attempt + 1)
                if error.stage in ("configuration", "authentication") or attempt:
                    with self._lock:
                        self.status["failed"] += 1
                        self.status["lastErrorAt"] = datetime.now(timezone.utc).isoformat()
                        self.status["lastError"] = str(error)
                    return
                time.sleep(1)

    def send(self, recipient: str, email: Email) -> Future:
        with self._lock:
            if self._executor is None:
                self._executor = ThreadPoolExecutor(max_workers=self._workers, thread_name_prefix="email")
            return self._executor.submit(self._send, recipient, email)

    def close(self) -> None:
        with self._lock:
            executor, self._executor = self._executor, None
        if executor is not None:
            executor.shutdown(wait=True)


outbox = EmailOutbox()
