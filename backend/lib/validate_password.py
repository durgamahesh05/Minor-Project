import re

PASSWORD_REQUIREMENTS_MESSAGE = (
    "Password must be more than 6 characters and include an uppercase letter, "
    "a lowercase letter, a number, and a symbol."
)
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{7,}$")


def is_valid_password(password: str) -> bool:
    return bool(PASSWORD_PATTERN.fullmatch(password))
